/**
 * Rule evaluation semantics over the wire config (spec 005 criterion 8, plus
 * the FIRST_MATCH/ALL_MATCH/stopOnMatch ordering contract the rules table
 * and the 008 simulator rely on).
 *
 * Spec 005 §6 names an `orderRules(rules, evaluationMode)` helper; the
 * shipping implementation folds those semantics into `evaluateRules`
 * (app/lib/rule-evaluation.ts — WASM-bundled, read-only here), per plan
 * 004-005 Task 6. These tests pin the semantics, not the helper name.
 */

import { describe, expect, it } from "vitest";
import { evaluateConditionGroup, evaluateRules, type CartFacts, type WireConfig, type WireRule } from "../rule-evaluation";

function facts(overrides: Partial<CartFacts> = {}): CartFacts {
  return {
    subtotal: 100,
    quantity: 2,
    weight: 1000,
    skus: ["SKU-1"],
    vendors: ["Acme"],
    productTags: ["heavy"],
    customerTags: [],
    loggedIn: false,
    ...overrides,
  };
}

function unconditional(id: string, priority: number, extra: Partial<WireRule> = {}): WireRule {
  return { i: id, k: "H", p: priority, s: 0, a: {}, ...extra };
}

function subtotalAtLeast(id: string, priority: number, threshold: number, extra: Partial<WireRule> = {}): WireRule {
  return {
    i: id,
    k: "H",
    p: priority,
    s: 0,
    a: {},
    c: { o: "A", n: [{ f: "subtotal", q: ">=", v: threshold }] },
    ...extra,
  };
}

function config(rules: WireRule[], mode: "F" | "A" = "A", zones?: WireConfig["z"]): WireConfig {
  return { v: 1, t: 0, m: mode, ...(zones ? { z: zones } : {}), r: rules };
}

function ids(decisions: ReturnType<typeof evaluateRules>): string[] {
  return decisions.map(function idOf(decision) {
    return decision.ruleId;
  });
}

describe("005 criterion 8 — stopOnMatch short-circuits lower-priority rules in ALL_MATCH", function () {
  it("a matching stopOnMatch rule excludes every lower-priority rule", function () {
    const stopper = subtotalAtLeast("r-stop", 10, 50, { s: 1 });
    const alsoMatching = subtotalAtLeast("r-lower", 20, 50);
    const decisions = evaluateRules(config([stopper, alsoMatching], "A"), facts({ subtotal: 100 }), {
      country: "US",
      province: "CA",
      postal: "94105",
    });
    expect(ids(decisions)).toEqual(["r-stop"]);
  });

  it("stopOnMatch on a NON-matching rule halts nothing", function () {
    const stopper = subtotalAtLeast("r-stop", 10, 999, { s: 1 });
    const alsoMatching = subtotalAtLeast("r-lower", 20, 50);
    const decisions = evaluateRules(config([stopper, alsoMatching], "A"), facts({ subtotal: 100 }), {
      country: "US",
    });
    expect(ids(decisions)).toEqual(["r-lower"]);
  });

  it("ALL_MATCH without stopOnMatch applies every matching rule", function () {
    const decisions = evaluateRules(
      config([subtotalAtLeast("r1", 10, 50), subtotalAtLeast("r2", 20, 60), subtotalAtLeast("r3", 30, 999)], "A"),
      facts({ subtotal: 100 }),
      { country: "US" },
    );
    expect(ids(decisions)).toEqual(["r1", "r2"]);
  });

  it("FIRST_MATCH returns only the first matching rule", function () {
    const decisions = evaluateRules(
      config([subtotalAtLeast("r1", 10, 50), subtotalAtLeast("r2", 20, 50)], "F"),
      facts({ subtotal: 100 }),
      { country: "US" },
    );
    expect(ids(decisions)).toEqual(["r1"]);
  });

  it("FIRST_MATCH + stopOnMatch still returns just the first match", function () {
    const decisions = evaluateRules(
      config([subtotalAtLeast("r1", 10, 50, { s: 1 }), subtotalAtLeast("r2", 20, 50)], "F"),
      facts({ subtotal: 100 }),
      { country: "US" },
    );
    expect(ids(decisions)).toEqual(["r1"]);
  });
});

describe("evaluation order (the orderRules contract)", function () {
  it("rules run in priority order regardless of array order", function () {
    const decisions = evaluateRules(
      config([unconditional("r30", 30), unconditional("r10", 10), unconditional("r20", 20)], "A"),
      facts(),
      { country: "US" },
    );
    expect(ids(decisions)).toEqual(["r10", "r20", "r30"]);
  });

  it("equal priorities are stable (insertion order preserved)", function () {
    const decisions = evaluateRules(
      config([unconditional("a", 5), unconditional("b", 5), unconditional("c", 5)], "A"),
      facts(),
      { country: "US" },
    );
    expect(ids(decisions)).toEqual(["a", "b", "c"]);
  });

  it("an empty condition group is unconditional", function () {
    const decisions = evaluateRules(config([unconditional("always", 1)], "A"), facts({ subtotal: 0 }), {
      country: "US",
    });
    expect(ids(decisions)).toEqual(["always"]);
  });
});

describe("zone-gated rules (matchesZone integration)", function () {
  const zones = [
    { i: "z-us", c: ["US"], pc: [] },
    { i: "z-ca", c: ["CA"], pc: [] },
  ];

  it("a rule bound to a matching zone applies", function () {
    const decisions = evaluateRules(
      config([unconditional("r1", 10, { z: "z-us" })], "A", zones),
      facts(),
      { country: "US", province: "CA", postal: "94105" },
    );
    expect(ids(decisions)).toEqual(["r1"]);
  });

  it("a rule bound to a non-matching zone is skipped", function () {
    const decisions = evaluateRules(
      config([unconditional("r1", 10, { z: "z-ca" })], "A", zones),
      facts(),
      { country: "US", province: "CA", postal: "94105" },
    );
    expect(ids(decisions)).toEqual([]);
  });

  it("a rule bound to a MISSING zone id is fail-closed (no match)", function () {
    const decisions = evaluateRules(
      config([unconditional("r1", 10, { z: "z-gone" })], "A", zones),
      facts(),
      { country: "US" },
    );
    expect(ids(decisions)).toEqual([]);
  });
});

describe("evaluateConditionGroup — nested AND/OR", function () {
  it("AND requires every leaf, OR requires one", function () {
    const ctx = facts({ subtotal: 100, productTags: ["heavy"] });
    const andGroup = { o: "A" as const, n: [{ f: "subtotal" as const, q: ">=" as const, v: 50 }, { f: "ptag" as const, q: "has" as const, v: "heavy" }] };
    const orGroup = { o: "O" as const, n: [{ f: "subtotal" as const, q: ">=" as const, v: 999 }, { f: "ptag" as const, q: "has" as const, v: "heavy" }] };
    expect(evaluateConditionGroup(andGroup, ctx)).toBe(true);
    expect(evaluateConditionGroup(orGroup, ctx)).toBe(true);
    expect(evaluateConditionGroup(andGroup, facts({ subtotal: 10 }))).toBe(false);
  });

  it("evaluates nested groups recursively", function () {
    const group = {
      o: "A" as const,
      n: [
        { f: "subtotal" as const, q: ">=" as const, v: 50 },
        {
          o: "O" as const,
          n: [
            { f: "vendor" as const, q: "=" as const, v: "Acme" },
            { o: "A" as const, n: [{ f: "quantity" as const, q: ">" as const, v: 5 }] },
          ],
        },
      ],
    };
    expect(evaluateConditionGroup(group, facts({ subtotal: 100, vendors: ["Acme"], quantity: 1 }))).toBe(true);
    expect(evaluateConditionGroup(group, facts({ subtotal: 100, vendors: ["Other"], quantity: 1 }))).toBe(false);
    expect(evaluateConditionGroup(group, facts({ subtotal: 100, vendors: ["Other"], quantity: 10 }))).toBe(true);
  });
});
