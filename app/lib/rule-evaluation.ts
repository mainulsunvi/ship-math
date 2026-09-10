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
  | "total" // cart total (after discounts; carrier lane: line sum)
  | "quantity"
  | "weight"
  | "price" // any line's unit price
  | "sku"
  | "vendor"
  | "ptag" // any cart line's product has this tag
  | "ctag" // the customer has this tag
  | "auth" // customer is logged in
  | "city" // destination city (case-insensitive)
  | "date" // calendar date vs nowLocal (YYYY-MM-DD)
  | "dow" // day of week vs nowLocal (MON..SUN)
  | "tod"; // time of day vs nowLocal (HH:mm)

export type WireOperator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "nin" | "has";

export interface WireCondition {
  f: WireConditionField;
  q: WireOperator;
  v: unknown; // number | string | boolean | string[]
}

export interface WireConditionGroup {
  o: "A" | "O" | "N"; // AND | OR | NONE (NOT(OR) — root only, spec 021)
  n: Array<WireCondition | WireConditionGroup>;
}

/** Action + delivery-option target, combined. */
export interface WireAction {
  m?: string; // deliveryMethodType filter, e.g. "SHIPPING" | "PICK_UP"; omit = any
  tc?: string; // title-contains filter; omit = any
  ti?: string; // RENAME: new title
  ix?: number; // MOVE: target index within the delivery group
  rk?: "C" | "E"; // spec 020: rank selector (cheapest / most expensive option)
  iv?: 0 | 1; // spec 020: invert the match ("hide all EXCEPT the match")
}

export interface WireRule {
  i: string;
  k: WireRuleKind;
  p: number; // priority, lower runs first
  s: 0 | 1; // stopOnMatch
  z?: string; // zone id; omit = no destination constraint
  c?: WireConditionGroup;
  /** Spec 021: THEN branch actions (array order = application order). */
  as?: WireAction[];
  /** Spec 021: ELSE branch actions (fire when the rule does NOT match). */
  ea?: WireAction[];
  /** Legacy single action (pre-021 configs) — reads as one then-action. */
  a?: WireAction;
}

/** THEN actions for any wire shape: as preferred, legacy a wrapped. */
export function wireRuleActions(rule: WireRule): WireAction[] {
  if (rule.as !== undefined) {
    return rule.as;
  }
  return rule.a !== undefined ? [rule.a] : [];
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
  /** Spec 021: cart total after discounts (Function reads totalAmount;
   * carrier/simulator use the line sum). Missing ⇒ `total` fails closed. */
  total?: number;
  /** Spec 021: unit price per line (money granularity). Missing ⇒ `price` fails closed. */
  linePrices?: number[];
  /** Spec 021: destination city; null/undefined ⇒ `city` fails closed. */
  city?: string | null;
  /** Spec 021: wall-clock now in the SHOP timezone as YYYY-MM-DDTHH:mm.
   * Never present in the Function lane (Functions have no clock) — missing
   * ⇒ date/dow/tod fail closed. */
  nowLocal?: string | null;
}

export interface DeliveryOptionFacts {
  handle: string;
  title?: string | null;
  methodType?: string | null;
  /** Spec 020: option price in shop currency (decimal number); null = unknown. */
  cost?: number | null;
}

/** Spec 020: resolved rank handles for one delivery group's ORIGINAL option list. */
export interface OptionRankHandles {
  cheapest: string | null;
  mostExpensive: string | null;
}

/**
 * Resolve the cheapest/most expensive option handles for a delivery group
 * (spec 020). Fail-closed on unknown cost: an option without a usable cost
 * number never ranks (never counts as cheapest OR most expensive); if no
 * option carries a known cost both handles are null, so rank rules match
 * nothing. Ties break to the FIRST occurrence in input order (deterministic
 * across the Function and the simulator). Always call this with the group's
 * ORIGINAL option list — a hidden option must still be able to BE the
 * cheapest, mirroring how the Function sees the untouched checkout list.
 */
export function resolveRankHandles(options: DeliveryOptionFacts[]): OptionRankHandles {
  let cheapest: DeliveryOptionFacts | null = null;
  let mostExpensive: DeliveryOptionFacts | null = null;
  for (const option of options) {
    const cost = typeof option.cost === "number" && Number.isFinite(option.cost) ? option.cost : null;
    if (cost === null) {
      continue;
    }
    if (cheapest === null || cost < (cheapest.cost as number)) {
      cheapest = option; // strict < keeps the first occurrence on ties
    }
    if (mostExpensive === null || cost > (mostExpensive.cost as number)) {
      mostExpensive = option; // strict > keeps the first occurrence on ties
    }
  }
  return {
    cheapest: cheapest === null ? null : cheapest.handle,
    mostExpensive: mostExpensive === null ? null : mostExpensive.handle,
  };
}

/**
 * Merchant-readable description of a wire action's targeting (spec 020) —
 * used by the simulator's customization report so "show only the cheapest"
 * reads as intent, not as engine internals.
 */
export function describeWireActionTarget(action: WireAction): string {
  const subject =
    action.rk === "C"
      ? "the cheapest rate"
      : action.rk === "E"
        ? "the most expensive rate"
        : action.tc !== undefined
          ? `rates containing "${action.tc}"`
          : action.m !== undefined
            ? `${action.m.toLowerCase()} rates`
            : "every rate";
  return action.iv === 1 ? `all except ${subject}` : subject;
}

export interface RuleDecision {
  ruleId: string;
  kind: WireRuleKind;
  /** Spec 021: branch actions in application order (array order). */
  actions: WireAction[];
  /** Spec 021: 0 = THEN branch (rule matched), 1 = ELSE branch. */
  branch: 0 | 1;
}

function compareStrings(actual: string, expected: string, q: WireOperator): boolean {
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

function isGroup(node: WireCondition | WireConditionGroup): node is WireConditionGroup {
  const candidate = node as WireConditionGroup;
  return candidate.o === "A" || candidate.o === "O" || candidate.o === "N";
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Compare two numbers with the wire operator (=, !=, >, >=, <, <=). */
function compareNumbers(actual: number, expected: number, q: WireOperator): boolean {
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

/** Monday-first weekday codes for `dow`. */
const WEEKDAY_CODES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normalizeWeekday(value: string): string {
  const trimmed = value.trim().slice(0, 3).toLowerCase();
  const found = WEEKDAY_CODES.find(function find(code) {
    return code.toLowerCase() === trimmed;
  });
  return found ?? trimmed;
}

/** Weekday (Mon..Sun) of a YYYY-MM-DD string, computed via UTC (pure). */
function weekdayOfDate(dateText: string): string | null {
  const parts = dateText.split("-");
  if (parts.length !== 3) {
    return null;
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  const mondayFirst = (utcDay + 6) % 7;
  return WEEKDAY_CODES[mondayFirst] ?? null;
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
      return compareNumbers(actual, expected, q);
    }
    case "total": {
      // Fail closed when the lane provides no total (older callers).
      if (typeof facts.total !== "number") {
        return false;
      }
      const expected = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(expected)) {
        return false;
      }
      return compareNumbers(facts.total, expected, q);
    }
    case "price": {
      // ANY-line semantics: matches when at least one line price satisfies
      // the operator; "!=" means NO line equals the value (sku/vendor style).
      if (facts.linePrices === undefined) {
        return false;
      }
      const expected = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(expected)) {
        return false;
      }
      if (q === "!=") {
        return !facts.linePrices.some(function anyLine(price) {
          return price === expected;
        });
      }
      return facts.linePrices.some(function anyLine(price) {
        return compareNumbers(price, expected, q);
      });
    }
    case "city": {
      // Case-insensitive destination-city matching; missing city fails closed.
      if (facts.city === undefined || facts.city === null) {
        return false;
      }
      const actual = facts.city.trim().toLowerCase();
      if (actual === "") {
        return false;
      }
      if (q === "in" || q === "nin") {
        const list = toStringArray(v).map(function lower(entry) {
          return entry.trim().toLowerCase();
        });
        const hit = list.includes(actual);
        return q === "in" ? hit : !hit;
      }
      const expected = typeof v === "string" ? v.trim().toLowerCase() : "";
      if (q === "=") {
        return actual === expected;
      }
      if (q === "!=") {
        return actual !== expected;
      }
      if (q === "has") {
        return expected !== "" && actual.includes(expected);
      }
      return false;
    }
    case "date": {
      // ISO dates compare lexicographically (YYYY-MM-DD is ordered).
      const nowDate = facts.nowLocal !== undefined && facts.nowLocal !== null ? facts.nowLocal.slice(0, 10) : null;
      if (nowDate === null) {
        return false;
      }
      const expected = typeof v === "string" ? v : "";
      if (expected === "") {
        return false;
      }
      return compareStrings(nowDate, expected, q);
    }
    case "dow": {
      const nowDate = facts.nowLocal !== undefined && facts.nowLocal !== null ? facts.nowLocal.slice(0, 10) : null;
      const today = nowDate === null ? null : weekdayOfDate(nowDate);
      if (today === null) {
        return false;
      }
      const list = toStringArray(v)
        .map(normalizeWeekday)
        .filter(function nonEmpty(entry) {
          return entry !== "";
        });
      const hit = list.includes(today);
      return q === "nin" ? !hit : q === "in" ? hit : false;
    }
    case "tod": {
      // Zero-padded HH:mm strings compare lexicographically.
      const nowTod = facts.nowLocal !== undefined && facts.nowLocal !== null ? facts.nowLocal.slice(11, 16) : null;
      if (nowTod === null || nowTod.length !== 5) {
        return false;
      }
      const expected = typeof v === "string" ? v : "";
      if (expected.length !== 5) {
        return false;
      }
      return compareStrings(nowTod, expected, q);
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
  if (group.o === "O") {
    return results.some(Boolean);
  }
  if (group.o === "N") {
    // Spec 021: NONE = NOT(OR over children); empty group handled above
    // (vacuous match, NOT(false) = true).
    return !results.some(Boolean);
  }
  return results.every(Boolean);
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
    if (matched) {
      const actions = wireRuleActions(rule);
      if (actions.length > 0) {
        decisions.push({ ruleId: rule.i, kind: rule.k, actions, branch: 0 });
      }
      if (rule.s === 1) {
        break; // stopOnMatch halts the whole pipeline (a MATCH only, spec 021)
      }
      if (config.m === "F") {
        break; // FIRST_MATCH: only the first MATCHING rule applies; ELSE
        // decisions from earlier non-matching rules stay in the list.
      }
    } else if (rule.ea !== undefined && rule.ea.length > 0) {
      // Spec 021: a non-matching rule contributes its ELSE actions; an ELSE
      // application never stops the pipeline and never wins FIRST_MATCH.
      decisions.push({ ruleId: rule.i, kind: rule.k, actions: rule.ea, branch: 1 });
    }
  }
  return decisions;
}

/**
 * Does a delivery option fall within an action's target filter?
 *
 * Spec 020 additions (both optional so older two-arg calls keep working):
 *   - ranks: the delivery group's resolved rank handles. A rank action
 *     (rk) matches ONLY the resolved handle; without a ranks argument (or
 *     with a null handle) it matches nothing — fail-closed, mirroring the
 *     missing-zone rule. Rank is exclusive with m/tc at save time; if a
 *     smuggled wire action carries both, rank wins (defensive).
 *   - iv: inverts the final verdict ("show only" = hide everything else).
 */
export function optionMatchesTarget(
  action: WireAction,
  option: DeliveryOptionFacts,
  ranks?: OptionRankHandles,
): boolean {
  let verdict = true;
  if (action.rk !== undefined) {
    const wanted = action.rk === "C" ? (ranks?.cheapest ?? null) : (ranks?.mostExpensive ?? null);
    verdict = wanted !== null && option.handle === wanted;
  } else {
    if (action.m && (option.methodType || "").toUpperCase() !== action.m.toUpperCase()) {
      verdict = false;
    }
    if (verdict && action.tc && !(option.title || "").toLowerCase().includes(action.tc.toLowerCase())) {
      verdict = false;
    }
  }
  if (action.iv === 1) {
    verdict = !verdict;
  }
  return verdict;
}
