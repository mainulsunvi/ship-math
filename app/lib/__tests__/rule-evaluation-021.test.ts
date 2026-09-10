/**
 * Spec 021 evaluator semantics (§9 addendum):
 *   - NONE root combinator (NOT-OR; vacuous empty group matches)
 *   - ELSE actions (branch 1 emission, never stops, never wins FIRST_MATCH)
 *   - multi-action THEN (order preserved) + legacy single-action compat
 *   - new condition fields: total, price, city, date, day_of_week, time_of_day
 *     (including fail-closed behavior when the lane provides no facts)
 *
 * nowLocalIn sanity lives here too (function-config import is safe: db.server
 * is vi.mock'ed below so no Prisma client is constructed).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateConditionGroup,
  evaluateRules,
  type CartFacts,
  type WireConfig,
  type WireRule,
} from "../rule-evaluation";

vi.mock("../../db.server", function mockDbServer() {
  return { default: {}, updatePrefs: vi.fn() };
});

import { nowLocalIn } from "../function-config";

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

function rule(id: string, priority: number, extra: Partial<WireRule> = {}): WireRule {
  return { i: id, k: "H", p: priority, s: 0, a: {}, ...extra };
}

function config(rules: WireRule[], mode: "F" | "A" = "A"): WireConfig {
  return { v: 1, t: 0, m: mode, r: rules };
}

const DESTINATION = { country: "US", province: "CA", postal: "94105" };

describe("021 — NONE root combinator (NOT over OR)", function () {
  it("matches when no child matches", function () {
    const group = {
      o: "N" as const,
      n: [
        { f: "subtotal" as const, q: ">=" as const, v: 999 },
        { f: "weight" as const, q: ">=" as const, v: 99999 },
      ],
    };
    expect(evaluateConditionGroup(group, facts())).toBe(true);
  });

  it("fails when any child matches", function () {
    const group = {
      o: "N" as const,
      n: [
        { f: "subtotal" as const, q: ">=" as const, v: 999 },
        { f: "weight" as const, q: ">=" as const, v: 500 },
      ],
    };
    expect(evaluateConditionGroup(group, facts({ weight: 1000 }))).toBe(false);
  });

  it("vacuous NONE group (no children) matches like every empty group", function () {
    expect(evaluateConditionGroup({ o: "N", n: [] }, facts())).toBe(true);
  });

  it("NONE works through evaluateRules (rule fires only when nothing matches)", function () {
    const noneRule = rule("r-none", 10, {
      c: { o: "N", n: [{ f: "subtotal", q: ">=", v: 500 }] },
    });
    const decisions = evaluateRules(config([noneRule]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions.map(function idOf(decision) {
      return decision.ruleId;
    })).toEqual(["r-none"]);

    const blocked = evaluateRules(config([noneRule]), facts({ subtotal: 600 }), DESTINATION);
    expect(blocked).toEqual([]);
  });
});

describe("021 — ELSE actions (branch 1)", function () {
  it("fires ELSE when the conditions do not match", function () {
    const elseRule = rule("r-else", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 500 }] },
      ea: [{ m: "SHIPPING" }],
    });
    const decisions = evaluateRules(config([elseRule]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions).toEqual([
      { ruleId: "r-else", kind: "H", actions: [{ m: "SHIPPING" }], branch: 1 },
    ]);
  });

  it("does NOT fire ELSE when the rule matches (THEN wins)", function () {
    const elseRule = rule("r-else", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=" as const, v: 50 }] },
      as: [{ m: "SHIPPING" }],
      ea: [{ m: "LOCAL" }],
    });
    const decisions = evaluateRules(config([elseRule]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions).toEqual([
      { ruleId: "r-else", kind: "H", actions: [{ m: "SHIPPING" }], branch: 0 },
    ]);
  });

  it("ELSE never stops the pipeline (stopOnMatch halts only on a match)", function () {
    const elseStopper = rule("r-stop", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 500 }] },
      s: 1,
      ea: [{ m: "LOCAL" }],
    });
    const later = rule("r-later", 20, { c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 50 }] } });
    const decisions = evaluateRules(config([elseStopper, later]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions.map(function idOf(decision) {
      return decision.ruleId;
    })).toEqual(["r-stop", "r-later"]);
    expect(decisions[0].branch).toBe(1);
  });

  it("ELSE cannot win FIRST_MATCH (a later matching rule still applies)", function () {
    const elseRule = rule("r-else", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 500 }] },
      ea: [{ m: "LOCAL" }],
    });
    const match = rule("r-match", 20, { c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 50 }] } });
    const decisions = evaluateRules(config([elseRule, match], "F"), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions.map(function idOf(decision) {
      return decision.ruleId;
    })).toEqual(["r-else", "r-match"]);
  });

  it("a rule with empty THEN actions and no ELSE never emits a decision", function () {
    const quiet = rule("r-quiet", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 50 }] },
      as: [],
      ea: [],
    });
    expect(evaluateRules(config([quiet]), facts({ subtotal: 100 }), DESTINATION)).toEqual([]);
  });
});

describe("021 — multi-action THEN + legacy compat", function () {
  it("preserves THEN action order across decisions", function () {
    const multi = rule("r-multi", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 50 }] },
      as: [{ m: "SHIPPING" }, { tc: "Express" }, { tc: "Priority" }],
    });
    const decisions = evaluateRules(config([multi]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].actions).toEqual([{ m: "SHIPPING" }, { tc: "Express" }, { tc: "Priority" }]);
  });

  it("legacy single `a` payloads still evaluate (backward compat)", function () {
    const legacy = rule("r-legacy", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 50 }] },
      a: { tc: "Express" },
    });
    const decisions = evaluateRules(config([legacy]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].branch).toBe(0);
    expect(decisions[0].actions).toEqual([{ tc: "Express" }]);
  });

  it("legacy rule with no action keys still emits one (empty) applyable action", function () {
    const legacy = rule("r-empty", 10, {
      c: { o: "A", n: [{ f: "subtotal", q: ">=", v: 50 }] },
      a: {},
    });
    const decisions = evaluateRules(config([legacy]), facts({ subtotal: 100 }), DESTINATION);
    expect(decisions.map(function idOf(decision) {
      return decision.ruleId;
    })).toEqual(["r-empty"]);
  });
});

describe("021 — new condition fields", function () {
  it("total compares cart.total when present", function () {
    const ctx = facts({ total: 120 });
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "total", q: ">=", v: 120 }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "total", q: ">", v: 120 }] }, ctx)).toBe(false);
  });

  it("total fails closed when the lane provides no total", function () {
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "total", q: ">=", v: 0 }] }, facts()),
    ).toBe(false);
  });

  it("price matches when ANY line satisfies the operator", function () {
    const ctx = facts({ linePrices: [10, 25, 40] });
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "price", q: ">=", v: 25 }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "price", q: ">", v: 40 }] }, ctx)).toBe(false);
  });

  it('price "!=" means NO line equals the value', function () {
    const ctx = facts({ linePrices: [10, 25] });
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "price", q: "!=", v: 30 }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "price", q: "!=", v: 25 }] }, ctx)).toBe(false);
  });

  it("price fails closed without linePrices", function () {
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "price", q: "<", v: 999 }] }, facts())).toBe(false);
  });

  it("city matches case-insensitively (equals, contains, one of)", function () {
    const ctx = facts({ city: "San Francisco" });
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "=", v: "san francisco" }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "has", v: "francis" }] }, ctx)).toBe(true);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "in", v: ["oakland", "san francisco"] }] }, ctx),
    ).toBe(true);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "nin", v: ["oakland"] }] }, ctx),
    ).toBe(true);
  });

  it("city fails closed when the destination has no city", function () {
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "=", v: "sf" }] }, facts())).toBe(false);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "=", v: "sf" }] }, facts({ city: null })),
    ).toBe(false);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "city", q: "=", v: "sf" }] }, facts({ city: "  " })),
    ).toBe(false);
  });

  it("date compares lexicographic ISO dates", function () {
    const ctx = facts({ nowLocal: "2026-09-09T14:30" });
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "date", q: "=", v: "2026-09-09" }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "date", q: ">=", v: "2026-01-01" }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "date", q: "<", v: "2026-01-01" }] }, ctx)).toBe(false);
  });

  it("date fails closed without nowLocal (Function lane)", function () {
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "date", q: "=", v: "2026-09-09" }] }, facts())).toBe(false);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "date", q: "=", v: "2026-09-09" }] }, facts({ nowLocal: null })),
    ).toBe(false);
  });

  it("day_of_week matches the weekday of nowLocal (values normalize)", function () {
    // 2026-09-09 is a Wednesday.
    const ctx = facts({ nowLocal: "2026-09-09T08:00" });
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "dow", q: "in", v: ["mon", "wed", "fri"] }] }, ctx),
    ).toBe(true);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "dow", q: "in", v: ["Mon", "Fri"] }] }, ctx),
    ).toBe(false);
    expect(
      evaluateConditionGroup({ o: "A", n: [{ f: "dow", q: "nin", v: ["sat", "sun"] }] }, ctx),
    ).toBe(true);
  });

  it("time_of_day compares zero-padded HH:mm strings", function () {
    const ctx = facts({ nowLocal: "2026-09-09T14:30" });
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "tod", q: ">=", v: "09:00" }] }, ctx)).toBe(true);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "tod", q: "<", v: "09:00" }] }, ctx)).toBe(false);
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "tod", q: "=", v: "14:30" }] }, ctx)).toBe(true);
  });

  it("time_of_day fails closed without nowLocal", function () {
    expect(evaluateConditionGroup({ o: "A", n: [{ f: "tod", q: ">=", v: "09:00" }] }, facts())).toBe(false);
  });
});

describe("021 — nowLocalIn sanity", function () {
  it("formats UTC instants without relying on the host clock (fixed offset zone)", function () {
    // Areas with fixed offsets and no DST make the expectation deterministic:
    // 10:30Z is 16:00 at UTC+5:30 regardless of date.
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 9, 10, 30));
    try {
      expect(nowLocalIn("Asia/Kolkata")).toBe("2026-09-09T16:00");
      expect(nowLocalIn("UTC")).toBe("2026-09-09T10:30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("zero-pads single-digit hours", function () {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 2, 3, 5)); // 03:05Z
    try {
      expect(nowLocalIn("UTC")).toBe("2026-01-02T03:05");
    } finally {
      vi.useRealTimers();
    }
  });
});
