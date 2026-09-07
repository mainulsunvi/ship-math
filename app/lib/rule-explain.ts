/**
 * Explain traces (spec 008 / architecture.md §A4) — PURE, app-side only.
 *
 * Never imported by the Function entry (the WASM bundle stays lean); the
 * simulator (app/lib/simulate.ts) and future AI debugging (018) consume it.
 *
 * Zero-drift by construction: every pass/fail decision here is produced by
 * calling the SAME exported evaluators the production lanes call —
 * `evaluateConditionGroup` (rule-evaluation.ts) for conditions and
 * `explainZoneMatch` (zone-matching.ts) for zone gates — plus
 * `computeRatesDetailed` (carrier/engine.ts) for the carrier pipeline. This
 * module only wraps and annotates; it never re-implements matching.
 *
 * A failed condition is pinpointed with a wire path like `c.n[2].n[0]`
 * (root group → child index → nested child index). Leaf pass/fail is
 * evaluated by wrapping the single condition in a one-node AND group, so
 * even leaf semantics come from the shared evaluator.
 */

import {
  evaluateConditionGroup,
  type CartFacts,
  type WireCondition,
  type WireConditionGroup,
  type WireConfig,
  type WireRule,
  type WireZone,
  type Destination,
} from "./rule-evaluation";
import { explainZoneMatch } from "./zone-matching";
import {
  computeRatesDetailed,
  toCartFacts,
  type CarrierCartContext,
  type CarrierRule,
  type CarrierRuleOutcome,
  type DetailedCarrierResult,
  type EvaluationMode,
} from "./carrier/engine";

/** The zone gate that stopped a rule (or that its zone row is missing). */
export type ZoneGate = "country" | "province" | "postal" | "missing-zone";

export interface RuleTrace {
  /** Function lane: short wire id (`r1`); carrier lane: Prisma rule id. */
  ruleId: string;
  /** Populated by the simulator from Prisma (the wire config carries no names). */
  ruleName?: string;
  matched: boolean;
  /** Wire path to the representative failing condition, e.g. `c.n[2].n[0]`. */
  failedConditionPath?: string;
  /** The failing condition itself, for human-readable rendering. */
  failedCondition?: WireCondition;
  /** Named only when conditions passed and the zone stopped the rule. */
  zoneGate?: ZoneGate;
  /** Function lane: the rule's action applies for this cart (per evaluation mode). */
  winner?: boolean;
  /** Carrier lane: the rule matched AND produced a rate. */
  producedRate?: boolean;
}

interface ConditionFailure {
  path: string;
  condition: WireCondition;
}

function isGroup(node: WireCondition | WireConditionGroup): node is WireConditionGroup {
  const candidate = node as WireConditionGroup;
  return candidate.o === "A" || candidate.o === "O";
}

/** Leaf pass/fail via the shared evaluator: one condition wrapped in an AND group. */
function conditionPasses(condition: WireCondition, facts: CartFacts): boolean {
  return evaluateConditionGroup({ o: "A", n: [condition] }, facts);
}

/**
 * Walk a group KNOWN to fail and return the first failing leaf. AND reports
 * its first failing child; OR fails only when every child fails, so the
 * first child is the representative. Nested groups recurse. A failing group
 * always contains at least one failing descendant (AND) or failing first
 * child (OR), so the recursive walk always terminates at a leaf; the
 * trailing return is a defensive fallback for the (impossible) empty case.
 */
function explainGroupFailure(group: WireConditionGroup, path: string, facts: CartFacts): ConditionFailure | undefined {
  for (let index = 0; index < group.n.length; index++) {
    const node = group.n[index];
    const childPath = `${path}.n[${index}]`;
    if (isGroup(node)) {
      if (!evaluateConditionGroup(node, facts)) {
        const nested = explainGroupFailure(node, childPath, facts);
        if (nested) {
          return nested;
        }
      }
    } else if (!conditionPasses(node, facts)) {
      return { path: childPath, condition: node };
    }
  }
  return undefined;
}

/**
 * Why did this condition group fail? Returns undefined when the group passes
 * (or is empty — an empty group is unconditional and always passes).
 */
export function explainConditionFailure(
  group: WireConditionGroup | undefined,
  facts: CartFacts,
): ConditionFailure | undefined {
  if (!group || group.n.length === 0) {
    return undefined;
  }
  if (evaluateConditionGroup(group, facts)) {
    return undefined;
  }
  return explainGroupFailure(group, "c", facts);
}

function zoneGateFrom(explanation: { countryMatched: boolean; provinceMatched: boolean; matched: boolean }): ZoneGate {
  return !explanation.countryMatched ? "country" : !explanation.provinceMatched ? "province" : "postal";
}

/**
 * Per-rule traces for the FUNCTION lane (HIDE/RENAME/MOVE wire rules).
 * Reports EVERY rule's conditions/zone outcome — no FIRST_MATCH/stop
 * short-circuiting — so the UI can show why each rule passed or failed.
 * Winners (what the Function would actually emit, per evaluation mode) are
 * marked by the caller via `evaluateRules`, the production decision walk.
 */
export function explainRules(config: WireConfig, facts: CartFacts, destination: Destination): RuleTrace[] {
  const rules: WireRule[] = (config.r || []).slice().sort(function byPriority(a, b) {
    return a.p - b.p;
  });
  const zoneMap = new Map<string, WireZone>();
  for (const zone of config.z || []) {
    zoneMap.set(zone.i, zone);
  }

  return rules.map(function traceRule(rule) {
    const conditionsOk = evaluateConditionGroup(rule.c, facts);
    const failure = conditionsOk ? undefined : explainConditionFailure(rule.c, facts);
    let zoneOk = true;
    let zoneGate: ZoneGate | undefined;
    if (conditionsOk && rule.z) {
      const zone = zoneMap.get(rule.z);
      if (!zone) {
        zoneOk = false; // mirror evaluateRules: missing zone = no match (fail-closed)
        zoneGate = "missing-zone";
      } else {
        const explanation = explainZoneMatch(zone, destination);
        zoneOk = explanation.matched;
        if (!explanation.matched) {
          zoneGate = zoneGateFrom(explanation);
        }
      }
    }
    return {
      ruleId: rule.i,
      matched: conditionsOk && zoneOk,
      ...(failure ? { failedConditionPath: failure.path, failedCondition: failure.condition } : {}),
      ...(zoneGate !== undefined ? { zoneGate } : {}),
    };
  });
}

/**
 * Traces for the CARRIER lane from an already-computed detailed result.
 * Same evaluator re-check for the failing condition path — identical inputs,
 * so the explanation can never disagree with the production decision.
 */
export function carrierTracesFromDetailed(
  rules: CarrierRule[],
  detailed: DetailedCarrierResult,
  cart: CarrierCartContext,
): RuleTrace[] {
  const facts = toCartFacts(cart);
  const ruleById = new Map<string, CarrierRule>();
  for (const rule of rules) {
    ruleById.set(rule.id, rule);
  }
  return detailed.outcomes.map(function traceOutcome(outcome: CarrierRuleOutcome) {
    const rule = ruleById.get(outcome.ruleId);
    const failure =
      outcome.matched || !rule ? undefined : explainConditionFailure(rule.conditions ?? undefined, facts);
    return {
      ruleId: outcome.ruleId,
      matched: outcome.matched,
      ...(failure ? { failedConditionPath: failure.path, failedCondition: failure.condition } : {}),
      ...(outcome.zoneGate !== undefined ? { zoneGate: outcome.zoneGate } : {}),
      ...(outcome.producedRate ? { producedRate: true } : {}),
    };
  });
}

/** One-call carrier trace helper (compute + annotate). */
export function traceCarrierRules(
  rules: CarrierRule[],
  zones: WireZone[],
  cart: CarrierCartContext,
  evaluationMode: EvaluationMode = "FIRST_MATCH",
): RuleTrace[] {
  return carrierTracesFromDetailed(rules, computeRatesDetailed(rules, zones, cart, evaluationMode), cart);
}
