/**
 * ShipMath delivery customization Function (spec 006 / architecture.md §A1).
 *
 * Config arrives via the delivery customization owner metafield (never the
 * shop), read live on every checkout run:
 *   - `function-configuration` (json): the compact WireConfig
 *   - `function-configuration-1` (string): chunk slot — when the primary
 *     metafield holds a { v:1, chunked:true, parts:n } manifest, the payload
 *     is the concatenation of the chunk values.
 *
 * FAIL-OPEN EVERYWHERE: missing/null/unparseable config, or testMode=1 →
 * NO operations. Checkout must never break because of us.
 *
 * Shared evaluator logic lives in the app and is bundled here at build time
 * (pure modules, no imports beyond siblings) so the simulator parity tests
 * (spec 006 criterion 7) exercise identical code.
 */

import type {
  CartDeliveryOptionsTransformRunInput,
  CartDeliveryOptionsTransformRunResult,
  Operation,
} from "../generated/api";
import {
  evaluateRules,
  optionMatchesTarget,
  type CartFacts,
  type WireConfig,
  type WireCondition,
  type WireConditionGroup,
  type WireRule,
  type WireZone,
} from "../../../app/lib/rule-evaluation";
import type { WirePostalRule } from "../../../app/lib/zone-matching";

const NO_CHANGES: CartDeliveryOptionsTransformRunResult = {
  operations: [],
};

// ---------------------------------------------------------------------------
// Narrow config parsing (no zod in the WASM bundle — every field is guarded)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asCondition(node: unknown): WireCondition | null {
  const record = asRecord(node);
  if (!record) {
    return null;
  }
  const f = typeof record["f"] === "string" ? record["f"] : null;
  const q = typeof record["q"] === "string" ? record["q"] : null;
  if (!f || !q) {
    return null;
  }
  return { f: f as WireCondition["f"], q: q as WireCondition["q"], v: record["v"] };
}

function asGroup(node: unknown): WireConditionGroup | null {
  const record = asRecord(node);
  if (!record || !Array.isArray(record["n"])) {
    return null;
  }
  const nodes: Array<WireCondition | WireConditionGroup> = [];
  for (const child of record["n"]) {
    const group = asGroup(child);
    if (group) {
      nodes.push(group);
      continue;
    }
    const condition = asCondition(child);
    if (condition) {
      nodes.push(condition);
    }
  }
  return { o: record["o"] === "O" ? "O" : "A", n: nodes };
}

function asRule(node: unknown): WireRule | null {
  const record = asRecord(node);
  if (!record) {
    return null;
  }
  const kind = record["k"];
  if (kind !== "H" && kind !== "R" && kind !== "M") {
    return null;
  }
  const action = asRecord(record["a"]);
  const group = asGroup(record["c"]);
  return {
    i: typeof record["i"] === "string" ? record["i"] : "",
    k: kind,
    p: typeof record["p"] === "number" ? record["p"] : 0,
    s: record["s"] === 1 ? 1 : 0,
    ...(typeof record["z"] === "string" ? { z: record["z"] } : {}),
    ...(group && group.n.length > 0 ? { c: group } : {}),
    a: {
      ...(action && typeof action["m"] === "string" ? { m: action["m"] } : {}),
      ...(action && typeof action["tc"] === "string" ? { tc: action["tc"] } : {}),
      ...(action && typeof action["ti"] === "string" ? { ti: action["ti"] } : {}),
      ...(action && typeof action["ix"] === "number" ? { ix: action["ix"] } : {}),
    },
  };
}

function asZone(node: unknown): WireZone | null {
  const record = asRecord(node);
  if (!record) {
    return null;
  }
  const stringArray = function (value: unknown): string[] | undefined {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : undefined;
  };
  const postalRules: WirePostalRule[] = [];
  if (Array.isArray(record["pc"])) {
    for (const entry of record["pc"]) {
      const rule = asRecord(entry);
      if (!rule || typeof rule["x"] !== "string") {
        continue;
      }
      const mode = rule["m"];
      if (mode !== "E" && mode !== "P" && mode !== "R" && mode !== "C") {
        continue;
      }
      postalRules.push({
        m: mode,
        x: rule["x"],
        ...(typeof rule["e"] === "string" ? { e: rule["e"] } : {}),
      });
    }
  }
  return {
    i: typeof record["i"] === "string" ? record["i"] : "",
    c: stringArray(record["c"]),
    p: stringArray(record["p"]),
    pc: postalRules,
  };
}

function validateConfig(candidate: unknown): WireConfig | null {
  const record = asRecord(candidate);
  if (!record || record["v"] !== 1) {
    return null;
  }
  if (record["t"] !== 0 && record["t"] !== 1) {
    return null;
  }
  return {
    v: 1,
    t: record["t"],
    m: record["m"] === "A" ? "A" : "F",
    ...(Array.isArray(record["z"])
      ? { z: record["z"].map(asZone).filter(function (zone: WireZone | null): boolean { return zone !== null; }) as WireZone[] }
      : {}),
    ...(Array.isArray(record["r"])
      ? { r: record["r"].map(asRule).filter(function (rule: WireRule | null): boolean { return rule !== null; }) as WireRule[] }
      : {}),
  };
}

function parseConfig(input: CartDeliveryOptionsTransformRunInput): WireConfig | null {
  const owner = input?.deliveryCustomization;
  const primary = asRecord(owner?.metafield?.jsonValue);

  if (primary && primary["chunked"] === true) {
    const chunk = owner?.c1?.value;
    if (typeof chunk !== "string" || chunk.length === 0) {
      return null;
    }
    try {
      return validateConfig(JSON.parse(chunk));
    } catch {
      return null;
    }
  }

  return validateConfig(primary);
}

// ---------------------------------------------------------------------------
// Input → CartFacts
// ---------------------------------------------------------------------------

const WEIGHT_TO_GRAMS: Record<string, number> = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  POUNDS: 453.592,
  OUNCES: 28.3495,
};

function tagsFrom(hasTags: Array<{ hasTag: boolean; tag: string }> | null | undefined): string[] {
  if (!hasTags) {
    return [];
  }
  return hasTags.filter(function (entry) { return entry.hasTag; }).map(function (entry) { return entry.tag; });
}

function buildFacts(input: CartDeliveryOptionsTransformRunInput): CartFacts {
  const cart = input?.cart;
  let quantity = 0;
  let weight = 0;
  const skus: string[] = [];
  const vendors: string[] = [];
  const productTags: string[] = [];

  for (const line of cart?.lines ?? []) {
    quantity += line.quantity;
    const merchandise = line.merchandise as
      | {
          sku?: string | null;
          weight?: number | null;
          weightUnit?: string | null;
          product?: { vendor?: string | null; hasTags?: Array<{ hasTag: boolean; tag: string }> | null } | null;
        }
      | null;
    if (merchandise?.weight != null) {
      const factor = WEIGHT_TO_GRAMS[merchandise.weightUnit || ""] ?? 1;
      weight += merchandise.weight * factor * line.quantity;
    }
    if (merchandise?.sku) {
      skus.push(merchandise.sku);
    }
    if (merchandise?.product?.vendor) {
      vendors.push(merchandise.product.vendor);
    }
    for (const tag of tagsFrom(merchandise?.product?.hasTags)) {
      if (!productTags.includes(tag)) {
        productTags.push(tag);
      }
    }
  }

  return {
    subtotal: Number(cart?.cost?.subtotalAmount?.amount) || 0,
    quantity,
    weight,
    skus,
    vendors,
    productTags,
    customerTags: tagsFrom(cart?.buyerIdentity?.customer?.hasTags),
    loggedIn: cart?.buyerIdentity?.isAuthenticated === true,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export function cartDeliveryOptionsTransformRun(
  input: CartDeliveryOptionsTransformRunInput,
): CartDeliveryOptionsTransformRunResult {
  const config = parseConfig(input);

  // Fail-open: unreadable/missing config, or test mode → pass-through checkout.
  if (!config) {
    console.log("[shipmath] no readable function configuration — pass-through");
    return NO_CHANGES;
  }
  if (config.t === 1) {
    console.log("[shipmath] test mode — pass-through");
    return NO_CHANGES;
  }

  const facts = buildFacts(input);
  const operations: Operation[] = [];

  for (const group of input?.cart?.deliveryGroups ?? []) {
    const destination = {
      country: group.deliveryAddress?.countryCode ?? null,
      province: group.deliveryAddress?.provinceCode ?? null,
      postal: group.deliveryAddress?.zip ?? null,
    };
    const decisions = evaluateRules(config, facts, destination);

    for (const decision of decisions) {
      for (const option of group.deliveryOptions) {
        const optionFacts = {
          handle: option.handle,
          title: option.title,
          methodType: option.deliveryMethodType,
        };
        if (!optionMatchesTarget(decision.action, optionFacts)) {
          continue;
        }
        if (decision.kind === "H") {
          operations.push({
            deliveryOptionHide: { deliveryOptionHandle: option.handle },
          });
        } else if (decision.kind === "R" && decision.action.ti) {
          operations.push({
            deliveryOptionRename: {
              deliveryOptionHandle: option.handle,
              title: decision.action.ti,
            },
          });
        } else if (decision.kind === "M" && typeof decision.action.ix === "number") {
          // Note: Shopify requires the cheapest shipping option to remain first-selected;
          // MOVE reorders the list only — never selection.
          const maxIndex = Math.max(0, group.deliveryOptions.length - 1);
          operations.push({
            deliveryOptionMove: {
              deliveryOptionHandle: option.handle,
              index: Math.min(decision.action.ix, maxIndex),
            },
          });
        }
      }
    }
  }

  return { operations };
}