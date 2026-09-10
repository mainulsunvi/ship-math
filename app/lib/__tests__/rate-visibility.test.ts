/**
 * Spec 020 — rate visibility selectors: rank resolution + invert matching in
 * the SHARED evaluator (rule-evaluation.ts is bundled into the Function WASM
 * and reused by the simulator, so these tests cover both lanes at once).
 */

import { describe, expect, it } from "vitest";
import {
  describeWireActionTarget,
  optionMatchesTarget,
  resolveRankHandles,
  type DeliveryOptionFacts,
} from "../rule-evaluation";

function option(handle: string, cost: number | null, title = handle): DeliveryOptionFacts {
  return { handle, title, methodType: "SHIPPING", cost };
}

const GROUP: DeliveryOptionFacts[] = [
  option("std", 8, "Standard"),
  option("eco", 5, "Economy"),
  option("exp", 15, "Express"),
];

describe("020 — resolveRankHandles", function () {
  it("picks the cheapest and most expensive by cost", function () {
    const ranks = resolveRankHandles(GROUP);
    expect(ranks.cheapest).toBe("eco");
    expect(ranks.mostExpensive).toBe("exp");
  });

  it("ties break to the FIRST occurrence in input order", function () {
    const ranks = resolveRankHandles([option("a", 5), option("b", 5), option("c", 9)]);
    expect(ranks.cheapest).toBe("a");
    expect(ranks.mostExpensive).toBe("c");
    expect(resolveRankHandles([option("x", 7), option("y", 7)]).mostExpensive).toBe("x");
  });

  it("unknown-cost options never rank (fail-closed)", function () {
    const ranks = resolveRankHandles([option("unknown", null), option("known", 12)]);
    expect(ranks.cheapest).toBe("known");
    expect(ranks.mostExpensive).toBe("known");
  });

  it("all-unknown costs yield null handles, so rank actions match nothing", function () {
    const ranks = resolveRankHandles([option("a", null), option("b", null)]);
    expect(ranks.cheapest).toBeNull();
    expect(ranks.mostExpensive).toBeNull();
    expect(optionMatchesTarget({ rk: "C", iv: 1 }, option("a", null), ranks)).toBe(true); // invert of nothing = everything
    expect(optionMatchesTarget({ rk: "C" }, option("a", null), ranks)).toBe(false);
  });
});

describe("020 — optionMatchesTarget rank + invert", function () {
  it("show-only-cheapest (rk C + invert) matches every option EXCEPT the cheapest", function () {
    const ranks = resolveRankHandles(GROUP);
    const action = { rk: "C" as const, iv: 1 as const };
    expect(GROUP.map(function match(o) { return optionMatchesTarget(action, o, ranks); })).toEqual([
      true, // std hidden
      false, // eco survives
      true, // exp hidden
    ]);
  });

  it("show-only-most-expensive (rk E + invert) keeps only the most expensive", function () {
    const ranks = resolveRankHandles(GROUP);
    const action = { rk: "E" as const, iv: 1 as const };
    // matches() = the HIDE applies: everything except exp gets hidden.
    expect(GROUP.filter(function match(o) { return optionMatchesTarget(action, o, ranks); }).map(function id(o) { return o.handle; })).toEqual(["std", "eco"]);
  });

  it("hide-the-cheapest (rk C, no invert) matches only the cheapest", function () {
    const ranks = resolveRankHandles(GROUP);
    const action = { rk: "C" as const };
    expect(GROUP.filter(function match(o) { return optionMatchesTarget(action, o, ranks); }).map(function id(o) { return o.handle; })).toEqual(["eco"]);
  });

  it("rank without a ranks argument matches nothing (fail-closed, mirrors missing-zone)", function () {
    expect(optionMatchesTarget({ rk: "C" }, option("eco", 5))).toBe(false);
  });

  it("invert works with title matching: show only rates containing Standard", function () {
    const action = { tc: "standard", iv: 1 as const };
    // HIDE applies where matches() is true: non-matching options get hidden,
    // "Standard" itself survives.
    const verdicts = GROUP.map(function match(o) { return optionMatchesTarget(action, o); });
    expect(verdicts).toEqual([false, true, true]);
  });

  it("method/title filters unchanged when no rank/invert present (backward compat)", function () {
    expect(optionMatchesTarget({ m: "PICK_UP" }, { handle: "p", title: "Pick up", methodType: "PICK_UP" })).toBe(true);
    expect(optionMatchesTarget({ m: "PICK_UP" }, { handle: "s", title: "Std", methodType: "SHIPPING" })).toBe(false);
    expect(optionMatchesTarget({ tc: "express" }, { handle: "e", title: "Express", methodType: "SHIPPING" })).toBe(true);
    expect(optionMatchesTarget({}, { handle: "x", title: "Any", methodType: "SHIPPING" })).toBe(true);
  });
});

describe("020 — describeWireActionTarget (merchant language)", function () {
  it("names the intent for every selector shape", function () {
    expect(describeWireActionTarget({ rk: "C", iv: 1 })).toBe("all except the cheapest rate");
    expect(describeWireActionTarget({ rk: "E", iv: 1 })).toBe("all except the most expensive rate");
    expect(describeWireActionTarget({ rk: "C" })).toBe("the cheapest rate");
    expect(describeWireActionTarget({ tc: "Express" })).toBe('rates containing "Express"');
    expect(describeWireActionTarget({ tc: "Standard", iv: 1 })).toBe('all except rates containing "Standard"');
    expect(describeWireActionTarget({ m: "PICK_UP" })).toBe("pick_up rates");
    expect(describeWireActionTarget({})).toBe("every rate");
  });
});
