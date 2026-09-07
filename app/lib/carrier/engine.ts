/**
 * Carrier rate engine (spec 007 / architecture.md §A3) — PURE module.
 *
 * Computes rates for kind = CARRIER_RATE rules over the carrier callback's
 * cart shape. Parity by construction (§A4): conditions are evaluated with
 * the SAME shared evaluators the checkout Function uses
 * (evaluateConditionGroup from rule-evaluation.ts, matchesZone from
 * zone-matching.ts), so the simulator (008) and this engine cannot drift.
 *
 * Rate math pipeline (§A3): base (flat | free | tiered | percentage)
 * → + perItem → + perWeight → + handlingFee → cap clamp → round half-up to
 * cents string. All money is decimal STRINGS — no float arithmetic on money
 * anywhere (app/lib/money.ts does exact digit-string math).
 *
 * Tier bands: inclusive of `from`, exclusive of `to`; the last band is open
 * when `to` is omitted. Weight bands are in KILOGRAMS (the editor sells
 * bands like "0–10"); per-weight amounts are per kg or per lb.
 *
 * Lane capabilities (§A3 matrix): the carrier payload exposes no product
 * tags and no customer identity, so tag/customer conditions are impossible
 * for CARRIER_RATE rules (blocked at save by config-schema's refine). The
 * CartFacts built here carry empty tag lists and loggedIn=false — anything
 * smuggled in evaluates false (fail-closed), never throws.
 */

import {
  type CarrierRateAction,
  type RateTier,
} from "./action-schema";
import {
  addDecimals,
  clampMax,
  isLess,
  multiplyDecimals,
  multiplyDecimal,
  toCentsString,
} from "../money";
import {
  evaluateConditionGroup,
  type CartFacts,
  type WireConditionGroup,
  type WireZone,
} from "../rule-evaluation";
import { explainZoneMatch, type Destination } from "../zone-matching";

/** 1 gram in pounds (decimal factor; lb pricing is inherently approximate). */
const LB_PER_GRAM = "0.0022046226";

export type EvaluationMode = "FIRST_MATCH" | "ALL_MATCH";

/** One stored rule with kind = CARRIER_RATE, conditions/action already parsed. */
export interface CarrierRule {
  id: string;
  priority: number; // lower runs first
  stopOnMatch: boolean;
  zoneId: string | null; // null = applies to every destination
  conditions: WireConditionGroup | null; // null/empty = unconditional
  action: CarrierRateAction;
}

/** The normalized cart the carrier callback gives us (§A3 callback contract). */
export interface CarrierCartContext {
  destination: { country: string; province: string | null; postal: string | null };
  currency: string; // requested presentation currency
  subtotal: string; // decimal string, shop currency
  weightGrams: number;
  quantity: number;
  skus: string[];
  vendors: string[];
}

export interface ComputedRate {
  serviceName: string;
  serviceCode: string;
  priceCents: string;
  description?: string;
}

/** Grams → kilograms as an exact decimal string: 2500 → "2.5" (pure digit shift). */
function gramsToKilograms(grams: number): string {
  const whole = String(Math.max(0, Math.trunc(grams)));
  const padded = whole.padStart(4, "0");
  const intPart = padded.slice(0, padded.length - 3);
  const fracPart = padded.slice(padded.length - 3).replace(/0+$/, "");
  return fracPart === "" ? String(Number(intPart)) : `${Number(intPart)}.${fracPart}`;
}

/** Weight basis value for tier lookup: kilograms as a decimal string. */
function tierBasisValue(basis: RateTier["basis"], cart: CarrierCartContext): string | null {
  switch (basis) {
    case "subtotal":
      return cart.subtotal;
    case "quantity":
      return String(Math.max(0, Math.trunc(cart.quantity)));
    case "weight":
      return gramsToKilograms(cart.weightGrams);
    default:
      return null;
  }
}

/**
 * Find the first stored band (in order) that contains its own basis value.
 * Bands are [from, to); the final band may be open (to omitted). A band
 * whose edges or value are non-numeric never matches; if no band matches
 * the rule fails (plan 007 Task 2).
 */
function selectTierBand(tiers: RateTier[], cart: CarrierCartContext): string | null {
  for (const tier of tiers) {
    const value = tierBasisValue(tier.basis, cart);
    if (value === null || value.trim() === "") {
      continue; // non-numeric basis value never matches a numeric band
    }
    const from = tier.from;
    const to = tier.to;
    if (typeof from !== "number" || Number.isNaN(from)) {
      continue; // non-numeric band edge never matches
    }
    if (isLess(value, String(from))) {
      continue; // below the band start (from is inclusive)
    }
    if (to !== undefined) {
      if (typeof to !== "number" || Number.isNaN(to)) {
        continue;
      }
      if (!isLess(value, String(to))) {
        continue; // to is exclusive
      }
    }
    return tier.amount; // first matching band in stored order wins
  }
  return null;
}

/**
 * Compute one rate from a parsed action. Returns null when the rule cannot
 * produce a rate (tiered mode with no matching band) — the caller treats
 * that as a non-match and continues the pipeline.
 */
function computeRateForAction(action: CarrierRateAction, cart: CarrierCartContext): string | null {
  let total = "0";

  // 1. Base
  switch (action.mode) {
    case "flat":
      total = action.amount ?? "0";
      break;
    case "free":
      total = "0";
      break;
    case "tiered": {
      const bands = action.tiers ?? [];
      const matched = selectTierBand(bands, cart);
      if (matched === null) {
        return null; // rule fails: no band covers this cart
      }
      total = matched;
      break;
    }
    case "percentage": {
      const pct = action.percentage ?? 0;
      // subtotal × pct / 100, all decimal-string math (× "0.01" = ÷ 100).
      const scaled = multiplyDecimals(cart.subtotal, String(pct));
      total = multiplyDecimals(scaled, "0.01");
      break;
    }
  }

  // 2. Per item (max(0, qty − freeItems) units)
  if (action.perItem !== undefined) {
    const billable = Math.max(0, cart.quantity - (action.perItem.freeItems ?? 0));
    total = addDecimals(total, multiplyDecimal(action.perItem.amount, String(billable)));
  }

  // 3. Per weight — kg is an exact digit shift; lb uses the fixed gram factor.
  if (action.perWeight !== undefined) {
    const grams = String(Math.max(0, Math.trunc(cart.weightGrams)));
    const weightCost =
      action.perWeight.per === "lb"
        ? multiplyDecimals(multiplyDecimals(action.perWeight.amount, grams), LB_PER_GRAM)
        : multiplyDecimals(action.perWeight.amount, gramsToKilograms(cart.weightGrams));
    total = addDecimals(total, weightCost);
  }

  // 4. Handling fee
  if (action.handlingFee !== undefined) {
    total = addDecimals(total, action.handlingFee);
  }

  // 5. Cap clamp, BEFORE rounding to cents (§A3 pipeline order)
  if (action.cap !== undefined) {
    total = clampMax(total, action.cap);
  }

  // 6. Round half-up to cents (response boundary)
  return toCentsString(total);
}

/** CartFacts for the shared condition evaluator. Carrier lane: no tags, no login. */
export function toCartFacts(cart: CarrierCartContext): CartFacts {
  return {
    subtotal: Number(cart.subtotal),
    quantity: cart.quantity,
    weight: cart.weightGrams,
    skus: cart.skus,
    vendors: cart.vendors,
    productTags: [],
    customerTags: [],
    loggedIn: false,
  };
}

/**
 * Per-rule outcome of the carrier pipeline (spec 008 traces). `matched` is
 * conditions AND zone; `zoneGate` names the gate that failed (or that the
 * zone row is missing/disabled — fail-closed); `producedRate` is false when
 * the rule matched but no tier band covered the cart.
 */
export interface CarrierRuleOutcome {
  ruleId: string;
  matched: boolean;
  zoneGate?: "country" | "province" | "postal" | "missing-zone";
  producedRate: boolean;
}

export interface DetailedCarrierResult {
  rates: ComputedRate[];
  outcomes: CarrierRuleOutcome[];
}

/**
 * Evaluate CARRIER_RATE rules against the cart WITH per-rule traces.
 *
 * This is THE production loop — computeRates() below is a thin projection of
 * it, so the simulator (008) and the live callback (007) cannot drift
 * (§A4). Rules run in priority order (lower first); FIRST_MATCH stops after
 * the first producing rule; ALL_MATCH applies every matching rule unless one
 * has stopOnMatch. A rule whose tier bands don't cover the cart produces no
 * rate and the pipeline continues (it never short-circuits the modes).
 */
export function computeRatesDetailed(
  rules: CarrierRule[],
  zones: WireZone[],
  cart: CarrierCartContext,
  evaluationMode: EvaluationMode = "FIRST_MATCH",
): DetailedCarrierResult {
  const ordered = rules.slice().sort(function byPriority(a, b) {
    return a.priority - b.priority;
  });
  const zoneMap = new Map<string, WireZone>();
  for (const zone of zones) {
    zoneMap.set(zone.i, zone);
  }
  const facts = toCartFacts(cart);
  const destination: Destination = {
    country: cart.destination.country,
    province: cart.destination.province,
    postal: cart.destination.postal,
  };

  const rates: ComputedRate[] = [];
  const outcomes: CarrierRuleOutcome[] = [];
  for (const rule of ordered) {
    let matched = evaluateConditionGroup(rule.conditions ?? undefined, facts);
    let zoneGate: CarrierRuleOutcome["zoneGate"];
    if (matched && rule.zoneId !== null) {
      const zone = zoneMap.get(rule.zoneId);
      if (!zone) {
        matched = false;
        zoneGate = "missing-zone"; // missing/disabled zone = no match (fail-closed)
      } else {
        // Same walk matchesZone performs — the explanation is derived from
        // the identical boolean, so traces can never disagree with rates.
        const explanation = explainZoneMatch(zone, destination);
        matched = explanation.matched;
        if (!explanation.matched) {
          zoneGate = !explanation.countryMatched
            ? "country"
            : !explanation.provinceMatched
              ? "province"
              : "postal";
        }
      }
    }
    let producedRate = false;
    if (matched) {
      const priceCents = computeRateForAction(rule.action, cart);
      if (priceCents !== null) {
        producedRate = true;
        rates.push({
          serviceName: rule.action.serviceName,
          serviceCode: rule.action.serviceCode,
          priceCents,
          ...(rule.action.description !== undefined ? { description: rule.action.description } : {}),
        });
        outcomes.push({
          ruleId: rule.id,
          matched: true,
          ...(zoneGate !== undefined ? { zoneGate } : {}),
          producedRate,
        });
        if (rule.stopOnMatch) {
          break;
        }
        if (evaluationMode === "FIRST_MATCH" && rates.length >= 1) {
          break;
        }
        continue;
      }
      // no band covered the cart → the rule matched but produces no rate and
      // the pipeline continues (never short-circuits)
    }
    outcomes.push({
      ruleId: rule.id,
      matched,
      ...(zoneGate !== undefined ? { zoneGate } : {}),
      producedRate,
    });
  }
  return { rates, outcomes };
}

/**
 * Evaluate CARRIER_RATE rules against the cart (live callback path). Rules
 * run in priority order (lower first); FIRST_MATCH stops after the first
 * producing rule; ALL_MATCH applies every matching rule unless one has
 * stopOnMatch. A rule whose tier bands don't cover the cart produces no rate
 * and the pipeline continues.
 */
export function computeRates(
  rules: CarrierRule[],
  zones: WireZone[],
  cart: CarrierCartContext,
  evaluationMode: EvaluationMode = "FIRST_MATCH",
): ComputedRate[] {
  return computeRatesDetailed(rules, zones, cart, evaluationMode).rates;
}
