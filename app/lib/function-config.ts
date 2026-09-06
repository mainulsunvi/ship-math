/**
 * Function config pipeline (spec 002 / architecture.md §A1):
 *
 *   Prisma (source of truth)
 *     → buildFunctionConfig(): compact wire JSON, function-kind rules only,
 *       ≤ SOFT_CAP bytes per metafield (platform: Functions receive `null`
 *       for metafield values > 10,000 bytes)
 *     → pushFunctionConfig(): metafieldsSet on the delivery customization
 *       FUNCTION OWNER (never the shop).
 *
 * Write happens on every config mutation; the Function reads it live at each
 * checkout run — no redeploy needed for config changes.
 */

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  type Condition,
  type ConditionGroup,
  type PostalRule,
  parseStoredJson,
} from "./config-schema";
/**
 * The package does not re-export its admin client type; derive it from
 * `authenticate.admin` so callers pass exactly what the Remix SDK returns.
 */
type AdminApiClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];
import {
  PostalRuleSchema,
  ConditionGroupSchema,
  ActionSchema,
  type RuleAction,
} from "./config-schema";
import { z } from "zod";
import { SET_FUNCTION_METAFIELDS } from "../graphql/metafields";

// ---------------------------------------------------------------------------
// Constants — platform limits (see architecture.md §A1)
// ---------------------------------------------------------------------------

/** Functions receive `null` above 10,000 bytes; keep headroom. */
export const SOFT_CAP_BYTES = 9500;
/** Chunk slot for future capacity expansion (input-query cost budget allows one). */
export const CHUNK_KEY = "function-configuration-1";

export const CONFIG_NAMESPACE = "$app:delivery-customization";
export const CONFIG_KEY = "function-configuration";
export const VARIABLES_KEY = "input-variables";

export class ConfigTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(
      `Function configuration is ${bytes} bytes; the checkout Function can only read configurations up to ${SOFT_CAP_BYTES} bytes. ` +
        `Disable or simplify rules (postal lists are the usual culprit) and try again.`,
    );
    this.name = "ConfigTooLargeError";
    this.bytes = bytes;
  }
}

// ---------------------------------------------------------------------------
// Stored → wire conversion
// ---------------------------------------------------------------------------

const POSTAL_MODE_TO_WIRE: Record<string, "E" | "P" | "R" | "C"> = {
  EXACT: "E",
  PREFIX: "P",
  RANGE: "R",
  PARTIAL: "C",
};

const CONDITION_FIELD_TO_WIRE: Record<string, string> = {
  subtotal: "subtotal",
  weight: "weight",
  quantity: "quantity",
  product_tag: "ptag",
  sku: "sku",
  vendor: "vendor",
  customer_tag: "ctag",
  logged_in: "auth",
};

const OPERATOR_TO_WIRE: Record<string, string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "in",
  not_in: "nin",
  contains: "has",
};

/**
 * Destination-* conditions are zone concerns: destination_country/province/
 * postal are NOT mirrored as line conditions; merchants bind a zone to the
 * rule instead. Collection conditions are deferred (spec 006 open question 3).
 */
const FUNCTION_UNSUPPORTED_FIELDS = new Set([
  "destination_country",
  "destination_province",
  "destination_postal",
]);

function toWireConditionGroup(raw: string): { o: "A" | "O"; n: unknown[] } | undefined {
  const group = parseStoredJson(raw, ConditionGroupSchema);
  const converted = convertGroup(group as unknown as ConditionGroup);
  if (!converted || converted.n.length === 0) {
    return undefined;
  }
  return converted;
}

function convertGroup(group: ConditionGroup): { o: "A" | "O"; n: unknown[] } | undefined {
  const nodes: unknown[] = [];
  for (const node of group.conditions) {
    if ("combinator" in node) {
      const nested = convertGroup(node as ConditionGroup);
      if (nested && nested.n.length > 0) {
        nodes.push(nested);
      }
      continue;
    }
    const condition = node as Condition;
    const field = CONDITION_FIELD_TO_WIRE[condition.field];
    const operator = OPERATOR_TO_WIRE[condition.operator];
    if (!field || !operator) {
      return undefined; // unsupported condition anywhere in the tree → rule excluded
    }
    nodes.push({ f: field, q: operator, v: condition.value });
  }
  return nodes.length > 0 ? { o: group.combinator === "OR" ? "O" : "A", n: nodes } : undefined;
}

function groupUsesUnsupportedFields(group: ConditionGroup): boolean {
  return group.conditions.some((node) =>
    "combinator" in node
      ? groupUsesUnsupportedFields(node as ConditionGroup)
      : FUNCTION_UNSUPPORTED_FIELDS.has((node as Condition).field),
  );
}

export interface BuiltFunctionConfig {
  /** Full compact JSON payload (what the Function parses). */
  payload: string;
  bytes: number;
  chunked: boolean;
  /** Metafields to write: primary json (+ chunk slot when used). */
  metafieldValues: Array<{ key: string; type: string; value: string }>;
  /** Input-query variables (distinct product/customer tags). */
  variables: { pt?: string[]; ct?: string[] };
  /** Rule ids excluded from the mirror and why (surfaced in UI). */
  excluded: Array<{ ruleId: string; reason: string }>;
}

export async function buildFunctionConfig(
  shopId: string,
): Promise<BuiltFunctionConfig> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: {
      zones: { where: { enabled: true } },
      rules: { where: { enabled: true }, orderBy: { priority: "asc" } },
    },
  });

  const excluded: BuiltFunctionConfig["excluded"] = [];
  const wireZones: unknown[] = [];
  const zoneIdToIndex = new Map<string, string>();
  const referencedZoneIds = new Set(
    shop.rules.map((rule) => rule.zoneId).filter((id): id is string => Boolean(id)),
  );

  for (const zone of shop.zones) {
    if (!referencedZoneIds.has(zone.id)) {
      continue; // don't mirror zones no rule uses — bytes are precious
    }
    let postalRules: PostalRule[];
    try {
      postalRules = z.array(PostalRuleSchema).parse(JSON.parse(zone.postalRules));
    } catch {
      postalRules = [];
    }
    const shortId = `z${wireZones.length + 1}`;
    zoneIdToIndex.set(zone.id, shortId);
    wireZones.push({
      i: shortId,
      ...(zone.countries && zone.countries !== "null" ? { c: safeJsonArray(zone.countries) } : {}),
      ...(zone.provinces && zone.provinces !== "null" ? { p: safeJsonArray(zone.provinces) } : {}),
      ...(postalRules.length > 0
        ? {
            pc: postalRules.map((rule) => {
              const wire: Record<string, string> = { m: POSTAL_MODE_TO_WIRE[rule.mode] || "E", x: rule.value };
              if (rule.mode === "RANGE" && rule.rangeEnd) {
                wire.e = rule.rangeEnd;
              }
              return wire;
            }),
          }
        : {}),
    });
  }

  const wireRules: unknown[] = [];
  const productTags = new Set<string>();
  const customerTags = new Set<string>();

  for (const rule of shop.rules) {
    if (rule.kind === "CARRIER_RATE") {
      continue; // carrier lane — never mirrored (spec 007 reads Prisma directly)
    }
    let conditions: ConditionGroup;
    try {
      conditions = parseStoredJson(rule.conditions, ConditionGroupSchema) as unknown as ConditionGroup;
    } catch {
      excluded.push({ ruleId: rule.id, reason: "conditions failed schema validation" });
      continue;
    }
    if (groupUsesUnsupportedFields(conditions)) {
      excluded.push({ ruleId: rule.id, reason: "uses destination/collection conditions not supported by the Function lane" });
      continue;
    }
    let action: RuleAction;
    try {
      action = parseStoredJson(rule.action, ActionSchema);
    } catch {
      excluded.push({ ruleId: rule.id, reason: "action failed schema validation" });
      continue;
    }
    const wireGroup = toWireConditionGroup(rule.conditions);
    if (rule.kind !== "HIDE" && rule.kind !== "RENAME" && rule.kind !== "MOVE") {
      continue;
    }

    // Collect tag values referenced by this rule for the input-query variables.
    collectTags(conditions, productTags, customerTags);

    const kind = rule.kind === "HIDE" ? "H" : rule.kind === "RENAME" ? "R" : "M";
    const zoneRef = rule.zoneId ? zoneIdToIndex.get(rule.zoneId) : undefined;

    wireRules.push({
      i: `r${wireRules.length + 1}`,
      k: kind,
      p: rule.priority,
      s: rule.stopOnMatch ? 1 : 0,
      ...(zoneRef ? { z: zoneRef } : {}),
      ...(wireGroup ? { c: wireGroup } : {}),
      a: {
        ...(action.target?.method ? { m: action.target.method } : {}),
        ...(action.target?.titleContains ? { tc: action.target.titleContains } : {}),
        ...(rule.kind === "RENAME" && action.title ? { ti: action.title } : {}),
        ...(rule.kind === "MOVE" && typeof action.position === "number" ? { ix: action.position } : {}),
      },
    });
  }

  const config = {
    v: 1,
    t: shop.testMode ? 1 : 0,
    m: shop.evaluationMode === "ALL_MATCH" ? "A" : "F",
    ...(wireZones.length > 0 ? { z: wireZones } : {}),
    ...(wireRules.length > 0 ? { r: wireRules } : {}),
  };
  const payload = JSON.stringify(config);
  const bytes = Buffer.byteLength(payload, "utf8");

  if (bytes > SOFT_CAP_BYTES) {
    // One chunk slot exists in the input query, but a single 9.5KB chunk adds
    // no capacity beyond the primary slot — so overflow is a hard error for
    // now (CONFIG_TOO_LARGE per spec 002). The Function still understands the
    // chunk manifest protocol if we ever budget more query cost for slots.
    throw new ConfigTooLargeError(bytes);
  }

  const variables: BuiltFunctionConfig["variables"] = {
    ...(productTags.size > 0 ? { pt: Array.from(productTags).slice(0, 100) } : {}),
    ...(customerTags.size > 0 ? { ct: Array.from(customerTags).slice(0, 100) } : {}),
  };

  return {
    payload,
    bytes,
    chunked: false,
    metafieldValues: [{ key: CONFIG_KEY, type: "json", value: payload }],
    variables,
    excluded,
  };
}

function collectTags(group: ConditionGroup, productTags: Set<string>, customerTags: Set<string>): void {
  for (const node of group.conditions) {
    if ("combinator" in node) {
      collectTags(node as ConditionGroup, productTags, customerTags);
      continue;
    }
    const condition = node as Condition;
    if (condition.field === "product_tag" && typeof condition.value === "string") {
      productTags.add(condition.value);
    }
    if (condition.field === "customer_tag" && typeof condition.value === "string") {
      customerTags.add(condition.value);
    }
  }
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Push to the function owner
// ---------------------------------------------------------------------------

interface MetafieldsSetResult {
  metafieldsSet?: {
    metafields?: Array<{ id: string }>;
    userErrors?: Array<{ field?: string[]; message: string }>;
  };
}

export interface SyncResult {
  bytes: number;
  chunked: boolean;
  excluded: BuiltFunctionConfig["excluded"];
  syncedAt: string;
}

export async function pushFunctionConfig(
  admin: AdminApiClient,
  shopId: string,
): Promise<SyncResult> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (!shop.functionOwnerId) {
    throw new Error("Shop has no delivery customization owner yet — run ensureFunctionOwner() first.");
  }

  const built = await buildFunctionConfig(shopId);
  const metafields = [
    ...built.metafieldValues.map((entry) => ({
      ownerId: shop.functionOwnerId!,
      namespace: CONFIG_NAMESPACE,
      key: entry.key,
      type: entry.type,
      value: entry.value,
    })),
    // Always (re)write the input-query variables metafield so stale tags vanish.
    {
      ownerId: shop.functionOwnerId!,
      namespace: CONFIG_NAMESPACE,
      key: VARIABLES_KEY,
      type: "json",
      value: JSON.stringify(built.variables),
    },
  ];

  const response = await admin.graphql(SET_FUNCTION_METAFIELDS, { variables: { metafields } });
  const json = (await response.json()) as { data?: MetafieldsSetResult; errors?: unknown };
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0 || json.errors) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(userErrors.length ? userErrors : json.errors)}`);
  }

  const syncedAt = new Date();
  await prisma.shop.update({
    where: { id: shopId },
    data: { functionSyncedAt: syncedAt },
  });

  return { bytes: built.bytes, chunked: built.chunked, excluded: built.excluded, syncedAt: syncedAt.toISOString() };
}
