/**
 * Explain traces (spec 008 Task 1 / architecture §A4): failing AND paths
 * identify the exact condition; zone misses name the gate; carrier traces
 * mirror the production pipeline's outcomes.
 */

import { describe, expect, it } from "vitest";
import {
  carrierTracesFromDetailed,
  explainConditionFailure,
  explainRules,
  traceCarrierRules,
} from "../rule-explain";
import { computeRatesDetailed, type CarrierRule, type CarrierCartContext } from "../carrier/engine";
import type {
  CartFacts,
  WireCondition,
  WireConditionGroup,
  WireConfig,
  WireZone,
} from "../rule-evaluation";
import type { Destination } from "../zone-matching";

function facts(overrides: Partial<CartFacts> = {}): CartFacts {
  return {
    subtotal: 150,
    quantity: 2,
    weight: 3000,
    skus: ["SKU-1"],
    vendors: ["Acme"],
    productTags: ["vip"],
    customerTags: [],
    loggedIn: true,
    ...overrides,
  };
}

// The explain layer works on the WIRE format; these helpers build wire nodes
// from plain strings (tests name fields/operators legibly).
function wireGroup(o: "A" | "O", n: WireConditionGroup["n"]): WireConditionGroup {
  return { o, n };
}

function wireCondition(f: string, q: string, v: unknown): WireCondition {
  return { f, q, v } as WireCondition;
}

const DESTINATION: Destination = { country: "US", province: "CA", postal: "94105" };

const ZONE_US_CA: WireZone = { i: "z1", c: ["US"], p: ["CA"] };

describe("008 explainConditionFailure — exact failed condition paths", function () {
  it("returns undefined for a passing or empty group", function () {
    const group = wireGroup("A", [wireCondition("subtotal", ">=", 100)]);
    expect(explainConditionFailure(group, facts())).toBeUndefined();
    expect(explainConditionFailure(undefined, facts())).toBeUndefined();
    expect(explainConditionFailure(wireGroup("A", []), facts())).toBeUndefined();
  });

  it("a failing AND group identifies the exact failing condition", function () {
    const group = wireGroup("A", [
      wireCondition("subtotal", ">=", 100), // passes (150)
      wireCondition("weight", "<", 1000), // fails (3000)
    ]);
    const failure = explainConditionFailure(group, facts());
    expect(failure?.path).toBe("c.n[1]");
    expect(failure?.condition).toEqual(wireCondition("weight", "<", 1000));
  });

  it("a failing nested group pinpoints the leaf inside it", function () {
    const group = wireGroup("A", [
      wireCondition("subtotal", ">=", 100), // passes
      wireGroup("O", [
        wireCondition("sku", "has", "GONE"), // fails — first failing child of the OR
        wireCondition("vendor", "=", "Nobody"), // fails
      ]), // the OR group fails
    ]);
    const failure = explainConditionFailure(group, facts());
    expect(failure?.path).toBe("c.n[1].n[0]");
    expect(failure?.condition).toEqual(wireCondition("sku", "has", "GONE"));
  });

  it("a failing OR group reports its first failing child", function () {
    const group = wireGroup("O", [
      wireCondition("subtotal", ">=", 500), // fails
      wireCondition("quantity", ">", 10), // fails too — OR fails only when ALL fail
    ]);
    const failure = explainConditionFailure(group, facts());
    expect(failure?.path).toBe("c.n[0]");
    expect(failure?.condition).toEqual(wireCondition("subtotal", ">=", 500));
  });
});

describe("008 explainRules — function lane traces", function () {
  const config: WireConfig = {
    v: 1,
    t: 0,
    m: "A",
    z: [ZONE_US_CA, { i: "z2", c: ["GB"] }],
    r: [
      { i: "r1", k: "H", p: 10, s: 0, c: wireGroup("A", [wireCondition("subtotal", ">=", 100)]), a: { m: "PICK_UP" } },
      {
        i: "r2",
        k: "R",
        p: 20,
        s: 0,
        z: "z1",
        c: wireGroup("A", [wireCondition("quantity", ">=", 5)]),
        a: { ti: "Slow boat" },
      },
      { i: "r3", k: "M", p: 30, s: 0, z: "z2", a: { ix: 0 } }, // GB zone — gate: country
      { i: "r4", k: "M", p: 40, s: 0, z: "z99", a: { ix: 1 } }, // missing zone — fail closed
    ],
  };

  it("reports every rule with matched flags and failure reasons", function () {
    const traces = explainRules(config, facts(), DESTINATION);
    expect(traces).toHaveLength(4);

    expect(traces[0]).toMatchObject({ ruleId: "r1", matched: true });
    expect(traces[0]?.zoneGate).toBeUndefined();

    // Conditions fail (quantity 2 < 5) BEFORE the zone is even considered.
    expect(traces[1]).toMatchObject({ ruleId: "r2", matched: false });
    expect(traces[1]?.failedConditionPath).toBe("c.n[0]");
    expect(traces[1]?.zoneGate).toBeUndefined();

    // Conditions pass; the zone's country gate stops the rule.
    expect(traces[2]).toMatchObject({ ruleId: "r3", matched: false, zoneGate: "country" });

    // Missing zone row = fail-closed, named as such.
    expect(traces[3]).toMatchObject({ ruleId: "r4", matched: false, zoneGate: "missing-zone" });
  });

  it("names the province gate when the country passes but the province list rejects", function () {
    const config2: WireConfig = {
      v: 1,
      t: 0,
      m: "F",
      z: [{ i: "z1", c: ["US"], p: ["NY"] }],
      r: [{ i: "r1", k: "H", p: 1, s: 0, z: "z1", a: { m: "PICK_UP" } }],
    };
    const traces = explainRules(config2, facts(), DESTINATION); // destination province CA
    expect(traces[0]).toMatchObject({ matched: false, zoneGate: "province" });
  });

  it("names the postal gate when only postal rules reject", function () {
    const config2: WireConfig = {
      v: 1,
      t: 0,
      m: "F",
      z: [{ i: "z1", c: ["US"], pc: [{ m: "P", x: "100" }] }],
      r: [{ i: "r1", k: "H", p: 1, s: 0, z: "z1", a: { m: "PICK_UP" } }],
    };
    const traces = explainRules(config2, facts(), DESTINATION); // postal 94105 vs prefix 100
    expect(traces[0]).toMatchObject({ matched: false, zoneGate: "postal" });
  });
});

describe("008 carrier traces — mirror of the production pipeline", function () {
  const cart: CarrierCartContext = {
    destination: { country: "US", province: "CA", postal: "94105" },
    currency: "USD",
    subtotal: "150.00",
    weightGrams: 3000,
    quantity: 2,
    skus: ["SKU-1"],
    vendors: ["Acme"],
  };

  function rule(overrides: Partial<CarrierRule> & { id: string }): CarrierRule {
    return {
      priority: 10,
      stopOnMatch: false,
      zoneId: null,
      conditions: null,
      action: {
        mode: "flat",
        amount: "5.00",
        serviceName: `Rate ${overrides.id}`,
        serviceCode: `code_${overrides.id}`,
      },
      ...overrides,
    };
  }

  it("traces match computeRatesDetailed outcomes exactly", function () {
    const rules = [
      rule({ id: "a" }),
      rule({ id: "b", conditions: wireGroup("A", [wireCondition("subtotal", ">=", 500)]) }),
      rule({ id: "c", priority: 5 }),
    ];
    const zones: WireZone[] = [];
    const detailed = computeRatesDetailed(rules, zones, cart, "ALL_MATCH");
    const traces = traceCarrierRules(rules, zones, cart, "ALL_MATCH");

    expect(traces.map(function id(trace) {
      return trace.ruleId;
    })).toEqual(detailed.outcomes.map(function id(outcome) {
      return outcome.ruleId;
    }));
    // c (priority 5) produces first, then a; b's condition (subtotal >= 500) fails.
    const loser = traces.find(function find(trace) {
      return trace.ruleId === "b";
    });
    expect(loser).toMatchObject({ matched: false, failedConditionPath: "c.n[0]" });
    expect(loser?.producedRate).toBeUndefined();
    expect(traces.filter(function produced(trace) {
      return trace.producedRate;
    }).map(function id(trace) {
      return trace.ruleId;
    })).toEqual(["c", "a"]);
  });

  it("names the zone gate and keeps producedRate undefined on zone misses", function () {
    const rules = [rule({ id: "gb", zoneId: "z1" })];
    const zones: WireZone[] = [{ i: "z1", c: ["GB"] }];
    const traces = traceCarrierRules(rules, zones, cart, "ALL_MATCH");
    expect(traces[0]).toMatchObject({ matched: false, zoneGate: "country" });
    expect(traces[0]?.failedConditionPath).toBeUndefined();
  });

  it("carrierTracesFromDetailed agrees with traceCarrierRules for the same run", function () {
    const rules = [
      rule({ id: "a" }),
      rule({ id: "tiered", action: { mode: "tiered", tiers: [{ basis: "weight", from: 100, to: 200, amount: "9.00" }], serviceName: "T", serviceCode: "t" } }),
    ];
    const detailed = computeRatesDetailed(rules, [], cart, "ALL_MATCH");
    const viaHelper = carrierTracesFromDetailed(rules, detailed, cart);
    const viaOneCall = traceCarrierRules(rules, [], cart, "ALL_MATCH");
    expect(viaHelper).toEqual(viaOneCall);
    // The tiered rule matched (no conditions/zone) but no band covers 3 kg.
    const tiered = viaHelper.find(function find(trace) {
      return trace.ruleId === "tiered";
    });
    expect(tiered).toMatchObject({ matched: true });
    expect(tiered?.producedRate).toBeUndefined();
  });
});
