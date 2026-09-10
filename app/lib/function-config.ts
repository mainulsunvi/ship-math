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

import prisma, { updatePrefs } from "../db.server";
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
  normalizeFunctionActions,
  type FunctionRuleActions,
  type RuleAction,
} from "./config-schema";
import { z } from "zod";
import { SET_FUNCTION_METAFIELDS } from "../graphql/metafields";
import { collectTags, MAX_TAGS_PER_LIST, type TagTruncation } from "./tag-collection";
import { SOFT_CAP_BYTES } from "./budget";
import type { WireCondition, WireConditionGroup, WireConditionField, WireOperator, WireZone, WireAction } from "./rule-evaluation";
import type { WirePostalRule } from "./zone-matching";

// ---------------------------------------------------------------------------
// Constants — platform limits (see architecture.md §A1)
// ---------------------------------------------------------------------------

/**
 * Byte cap lives in app/lib/budget.ts — the single pure constant module
 * shared with the UI (review 004/005).
 */
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

const CONDITION_FIELD_TO_WIRE: Record<string, WireConditionField> = {
  subtotal: "subtotal",
  total: "total",
  weight: "weight",
  quantity: "quantity",
  price: "price",
  product_tag: "ptag",
  sku: "sku",
  vendor: "vendor",
  customer_tag: "ctag",
  logged_in: "auth",
  city: "city",
  date: "date",
  day_of_week: "dow",
  time_of_day: "tod",
};

const OPERATOR_TO_WIRE: Record<string, WireOperator> = {
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
const ZONE_HANDLED_FIELDS = new Set([
  "destination_country",
  "destination_province",
  "destination_postal",
]);

/**
 * Spec 021 §9.3: checkout Functions are pure (no clock), so date and time
 * conditions can never evaluate in the Function lane. Rules using them are
 * excluded from the mirror with an explicit reason; they still run in the
 * carrier lane and the simulator (both have a server clock + shop timezone).
 */
const CLOCK_ONLY_FIELDS = new Set(["date", "day_of_week", "time_of_day"]);

function toWireConditionGroup(raw: string): WireConditionGroup | undefined {
  const group = parseStoredJson(raw, ConditionGroupSchema);
  const converted = convertGroup(group as unknown as ConditionGroup);
  if (!converted || converted.n.length === 0) {
    return undefined;
  }
  return converted;
}
export { toWireConditionGroup };

function convertGroup(group: ConditionGroup): WireConditionGroup | undefined {
  const nodes: (WireCondition | WireConditionGroup)[] = [];
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
  return nodes.length > 0 ? { o: group.combinator === "OR" ? "O" : group.combinator === "NONE" ? "N" : "A", n: nodes } : undefined;
}

function groupUsesFields(group: ConditionGroup, fields: Set<string>): boolean {
  return group.conditions.some((node) =>
    "combinator" in node
      ? groupUsesFields(node as ConditionGroup, fields)
      : fields.has((node as Condition).field),
  );
}

/** Minimal zone-row shape both lanes convert (Prisma Zone subset). */
export interface ZoneRowLike {
  id: string;
  countries: string;
  provinces: string;
  postalRules: string;
}

/**
 * Stored zones → wire zones + prismaId→shortId map. SHARED by the Function
 * mirror and the carrier callback lane (spec 007) — one implementation, so
 * the two lanes can never drift (architecture §A4).
 */
export function buildWireZones(
  zones: ZoneRowLike[],
  referencedZoneIds: Set<string>,
): { wireZones: WireZone[]; idMap: Map<string, string> } {
  const wireZones: WireZone[] = [];
  const idMap = new Map<string, string>();
  for (const zone of zones) {
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
    idMap.set(zone.id, shortId);
    wireZones.push({
      i: shortId,
      ...(zone.countries && zone.countries !== "null" ? { c: safeJsonArray(zone.countries) } : {}),
      ...(zone.provinces && zone.provinces !== "null" ? { p: safeJsonArray(zone.provinces) } : {}),
      ...(postalRules.length > 0
        ? {
            pc: postalRules.map((rule) => {
              const wire: WirePostalRule = { m: POSTAL_MODE_TO_WIRE[rule.mode] || "E", x: rule.value };
              if (rule.mode === "RANGE" && rule.rangeEnd) {
                wire.e = rule.rangeEnd;
              }
              return wire;
            }),
          }
        : {}),
    });
  }
  return { wireZones, idMap };
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
  /** Lists that hit the ≤100-tag platform cap and dropped at least one new tag. */
  variablesTruncated: { pt: boolean; ct: boolean };
  /** Rule ids excluded from the mirror and why (surfaced in UI). */
  excluded: Array<{ ruleId: string; reason: string }>;
  /** Wire id → Prisma id for every mirrored rule (simulator trace naming, 008). */
  mirrored: Array<{ wireId: string; ruleId: string }>;
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
  const mirrored: BuiltFunctionConfig["mirrored"] = [];
  const referencedZoneIds = new Set(
    shop.rules.map((rule) => rule.zoneId).filter((id): id is string => Boolean(id)),
  );
  const { wireZones, idMap: zoneIdToIndex } = buildWireZones(shop.zones, referencedZoneIds);

  const wireRules: unknown[] = [];
  const productTags = new Set<string>();
  const customerTags = new Set<string>();
  const tagTruncation: TagTruncation = { pt: false, ct: false };

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
    if (groupUsesFields(conditions, ZONE_HANDLED_FIELDS)) {
      excluded.push({ ruleId: rule.id, reason: "uses destination/collection conditions not supported by the Function lane" });
      continue;
    }
    if (groupUsesFields(conditions, CLOCK_ONLY_FIELDS)) {
      excluded.push({
        ruleId: rule.id,
        reason:
          "uses date and time conditions that the checkout Function cannot evaluate (no clock); the rule still runs in the carrier lane and the simulator",
      });
      continue;
    }
    let actions: FunctionRuleActions;
    try {
      // Accepts the spec 021 wrapper AND legacy single-action rows.
      actions = normalizeFunctionActions(JSON.parse(rule.action));
    } catch {
      excluded.push({ ruleId: rule.id, reason: "action failed schema validation" });
      continue;
    }
    if (actions.actions.length === 0) {
      excluded.push({ ruleId: rule.id, reason: "action failed schema validation" });
      continue;
    }
    const wireGroup = toWireConditionGroup(rule.conditions);
    if (rule.kind !== "HIDE" && rule.kind !== "RENAME" && rule.kind !== "MOVE") {
      continue;
    }

    // Collect tag values referenced by this rule for the input-query variables.
    const collected = collectTags(conditions, productTags, customerTags);
    tagTruncation.pt = tagTruncation.pt || collected.truncated.pt;
    tagTruncation.ct = tagTruncation.ct || collected.truncated.ct;

    const kind = rule.kind === "HIDE" ? "H" : rule.kind === "RENAME" ? "R" : "M";
    const zoneRef = rule.zoneId ? zoneIdToIndex.get(rule.zoneId) : undefined;
    const wireId = `r${wireRules.length + 1}`;

    const wireThen = actions.actions.map(function toWire(action) {
      return toWireAction(action, rule.kind);
    });
    const wireElse = actions.elseActions.map(function toWire(action) {
      return toWireAction(action, rule.kind);
    });

    wireRules.push({
      i: wireId,
      k: kind,
      p: rule.priority,
      s: rule.stopOnMatch ? 1 : 0,
      ...(zoneRef ? { z: zoneRef } : {}),
      ...(wireGroup ? { c: wireGroup } : {}),
      as: wireThen,
      ...(wireElse.length > 0 ? { ea: wireElse } : {}),
    });
    mirrored.push({ wireId, ruleId: rule.id });
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

  // The cap is enforced during collection (Set insertion order = deterministic
  // condition-then-value order); the slice is a defensive no-op backstop.
  const variables: BuiltFunctionConfig["variables"] = {
    ...(productTags.size > 0 ? { pt: Array.from(productTags).slice(0, MAX_TAGS_PER_LIST) } : {}),
    ...(customerTags.size > 0 ? { ct: Array.from(customerTags).slice(0, MAX_TAGS_PER_LIST) } : {}),
  };

  return {
    payload,
    bytes,
    chunked: false,
    metafieldValues: [{ key: CONFIG_KEY, type: "json", value: payload }],
    variables,
    variablesTruncated: tagTruncation,
    excluded,
    mirrored,
  };
}

/** Stored function action → compact wire action (spec 020 rank/invert + 021 branches). */
function toWireAction(action: RuleAction, kind: string): WireAction {
  return {
    ...(action.target?.method ? { m: action.target.method } : {}),
    ...(action.target?.titleContains ? { tc: action.target.titleContains } : {}),
    ...(kind === "RENAME" && action.title ? { ti: action.title } : {}),
    ...(kind === "MOVE" && typeof action.position === "number" ? { ix: action.position } : {}),
    ...(action.target?.rank === "CHEAPEST"
      ? { rk: "C" as const }
      : action.target?.rank === "MOST_EXPENSIVE"
        ? { rk: "E" as const }
        : {}),
    ...(action.target?.invert ? { iv: 1 as const } : {}),
  };
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
  variablesTruncated: BuiltFunctionConfig["variablesTruncated"];
  syncedAt: string;
}

/** Shop timezone for date/time conditions (spec 021 §9.3) — one field read. */
const SHOP_TIMEZONE_QUERY = `
  query ShopTimezone {
    shop {
      ianaTimezone
    }
  }
`;

/** Wall-clock "now" in a shop timezone as YYYY-MM-DDTHH:mm (no seconds). */
export function nowLocalIn(timezone: string | null | undefined): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone && timezone.trim() !== "" ? timezone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Read parts BY TYPE — Node's en-CA keeps the date as one token when the
  // formatted string is split, so index-based parsing is not portable.
  const parts = formatter.formatToParts(new Date());
  function part(type: Intl.DateTimeFormatPartTypes): string {
    return parts.find(function byType(entry) {
      return entry.type === type;
    })?.value ?? "";
  }
  const hour = part("hour") === "24" ? "00" : part("hour");
  return `${part("year")}-${part("month")}-${part("day")}T${hour}:${part("minute")}`;
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

  // Spec 021 §9.3: refresh the shop timezone so date/time conditions in the
  // carrier lane and simulator stay aligned with the shop's setting.
  try {
    const tzResponse = await admin.graphql(SHOP_TIMEZONE_QUERY);
    const tzJson = (await tzResponse.json()) as { data?: { shop?: { ianaTimezone?: string | null } } };
    const ianaTimezone = tzJson.data?.shop?.ianaTimezone ?? null;
    await updatePrefs(shopId, { ianaTimezone: ianaTimezone ?? "" });
  } catch {
    // Non-fatal: lanes fall back to the stored value, then UTC.
  }

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

  return {
    bytes: built.bytes,
    chunked: built.chunked,
    excluded: built.excluded,
    variablesTruncated: built.variablesTruncated,
    syncedAt: syncedAt.toISOString(),
  };
}
