/**
 * Rule evaluation over the compact wire config — pure logic shared by:
 *   - the Delivery Function (compiled into the WASM bundle),
 *   - the simulator and parity tests (spec 006/008).
 *
 * Only relative imports of sibling pure modules are allowed here:
 * this file is bundled into the Function runtime.
 */

import { matchesZone, type Destination, type WireZone } from "./zone-matching";

// Re-exported for consumers (the checkout Function) that want the wire types
// from a single import site.
export type { Destination, WireZone };

// ---------------------------------------------------------------------------
// Wire format v1 (compact; see app/lib/config-schema.ts for construction)
// ---------------------------------------------------------------------------

export type WireRuleKind = "H" | "R" | "M"; // HIDE | RENAME | MOVE

export type WireConditionField =
  | "subtotal"
  | "quantity"
  | "weight"
  | "sku"
  | "vendor"
  | "ptag" // any cart line's product has this tag
  | "ctag" // the customer has this tag
  | "auth"; // customer is logged in

export type WireOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "nin" | "has";

export interface WireCondition {
  f: WireConditionField;
  q: WireOperator;
  v: unknown; // number | string | boolean | string[]
}

export interface WireConditionGroup {
  o: "A" | "O"; // AND | OR
  n: Array<WireCondition | WireConditionGroup>;
}

/** Action + delivery-option target, combined. */
export interface WireAction {
  m?: string; // deliveryMethodType filter, e.g. "SHIPPING" | "PICK_UP"; omit = any
  tc?: string; // title-contains filter; omit = any
  ti?: string; // RENAME: new title
  ix?: number; // MOVE: target index within the delivery group
}

export interface WireRule {
  i: string;
  k: WireRuleKind;
  p: number; // priority, lower runs first
  s: 0 | 1; // stopOnMatch
  z?: string; // zone id; omit = no destination constraint
  c?: WireConditionGroup;
  a: WireAction;
}

export interface WireConfig {
  v: 1;
  t: 0 | 1; // testMode
  m: "F" | "A"; // evaluationMode: FIRST_MATCH | ALL_MATCH
  z?: WireZone[];
  r?: WireRule[];
}

/** Manifest written to the primary slot when the payload is chunked. */
export interface WireChunkManifest {
  v: 1;
  chunked: true;
  parts: number;
}

// ---------------------------------------------------------------------------
// Cart facts — normalized context each caller builds from its own input shape
// ---------------------------------------------------------------------------

export interface CartFacts {
  subtotal: number; // shop currency, decimal
  quantity: number; // total units
  weight: number; // grams
  skus: string[];
  vendors: string[];
  productTags: string[]; // union of tags present on cart lines
  customerTags: string[];
  loggedIn: boolean;
}

export interface DeliveryOptionFacts {
  handle: string;
  title?: string | null;
  methodType?: string | null;
}

export interface RuleDecision {
  ruleId: string;
  kind: WireRuleKind;
  action: WireAction;
}

function isGroup(node: WireCondition | WireConditionGroup): node is WireConditionGroup {
  const candidate = node as WireConditionGroup;
  return candidate.o === "A" || candidate.o === "O";
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function evaluateCondition(condition: WireCondition, facts: CartFacts): boolean {
  const { f, q, v } = condition;
  switch (f) {
    case "subtotal":
    case "quantity":
    case "weight": {
      const actual = facts[f];
      const expected = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(expected)) {
        return false;
      }
      switch (q) {
        case "=":
          return actual === expected;
        case "!=":
          return actual !== expected;
        case ">":
          return actual > expected;
        case ">=":
          return actual >= expected;
        case "<":
          return actual < expected;
        case "<=":
          return actual <= expected;
        default:
          return false;
      }
    }
    case "sku":
    case "vendor": {
      const list = f === "sku" ? facts.skus : facts.vendors;
      switch (q) {
        case "=":
          return typeof v === "string" && list.includes(v);
        case "!=":
          return typeof v === "string" && !list.includes(v);
        case "in":
          return list.some((entry) => toStringArray(v).includes(entry));
        case "nin":
          return !list.some((entry) => toStringArray(v).includes(entry));
        case "has":
          return typeof v === "string" && list.some((entry) => entry.includes(v));
        default:
          return false;
      }
    }
    case "ptag": {
      const has = typeof v === "string" && facts.productTags.includes(v);
      const inList = toStringArray(v).some((tag) => facts.productTags.includes(tag));
      return q === "!=" ? !(has || inList) : has || inList;
    }
    case "ctag": {
      const has = typeof v === "string" && facts.customerTags.includes(v);
      const inList = toStringArray(v).some((tag) => facts.customerTags.includes(tag));
      return q === "!=" ? !(has || inList) : has || inList;
    }
    case "auth": {
      const expected = v === true || v === "true";
      return q === "!=" ? facts.loggedIn !== expected : facts.loggedIn === expected;
    }
    default:
      return false;
  }
}

export function evaluateConditionGroup(group: WireConditionGroup | undefined, facts: CartFacts): boolean {
  if (!group || group.n.length === 0) {
    return true; // empty condition group = unconditional rule
  }
  const results = group.n.map((node) => (isGroup(node) ? evaluateConditionGroup(node, facts) : evaluateCondition(node, facts)));
  return group.o === "O" ? results.some(Boolean) : results.every(Boolean);
}

function zonesById(zones: WireZone[] | undefined): Map<string, WireZone> {
  const map = new Map<string, WireZone>();
  if (zones) {
    for (const zone of zones) {
      map.set(zone.i, zone);
    }
  }
  return map;
}

/**
 * Evaluate the rule set against cart facts + one delivery group's destination.
 * Returns the ordered decisions whose actions should apply to that group.
 */
export function evaluateRules(
  config: WireConfig,
  facts: CartFacts,
  destination: Destination,
): RuleDecision[] {
  const rules = (config.r || []).slice().sort((a, b) => a.p - b.p);
  const zoneMap = zonesById(config.z);
  const decisions: RuleDecision[] = [];

  for (const rule of rules) {
    let matched = evaluateConditionGroup(rule.c, facts);
    if (matched && rule.z) {
      const zone = zoneMap.get(rule.z);
      matched = zone ? matchesZone(zone, destination) : false; // missing zone = no match (fail-closed per rule)
    }
    if (!matched) {
      continue;
    }
    decisions.push({ ruleId: rule.i, kind: rule.k, action: rule.a });
    if (rule.s === 1) {
      break; // stopOnMatch halts the whole pipeline
    }
    if (config.m === "F" && decisions.length >= 1) {
      break; // FIRST_MATCH: only the first matching rule applies
    }
  }
  return decisions;
}

/** Does a delivery option fall within an action's target filter? */
export function optionMatchesTarget(action: WireAction, option: DeliveryOptionFacts): boolean {
  if (action.m && (option.methodType || "").toUpperCase() !== action.m.toUpperCase()) {
    return false;
  }
  if (action.tc && !(option.title || "").toLowerCase().includes(action.tc.toLowerCase())) {
    return false;
  }
  return true;
}
