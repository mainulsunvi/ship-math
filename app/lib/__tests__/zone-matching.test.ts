/**
 * Table-driven zone/postal matching suite (spec 004 acceptance criteria 1–7
 * and the criterion 9 bench).
 *
 * The tests exercise the WIRE format directly (matchesZone/explainZoneMatch).
 * Stored PARTIAL rules are mirrored as wire mode "C" (see
 * POSTAL_MODE_TO_WIRE in app/lib/function-config.ts), so PARTIAL rows in the
 * tables below use m: "C".
 */

import { describe, expect, it } from "vitest";
import {
  explainZoneMatch,
  findMatchingZones,
  matchesZone,
  normalizePostal,
  type Destination,
  type WirePostalMode,
  type WireZone,
} from "../zone-matching";

function rule(mode: WirePostalMode, value: string, end?: string) {
  return end === undefined ? { m: mode, x: value } : { m: mode, x: value, e: end };
}

function zone(overrides: Partial<WireZone> = {}): WireZone {
  return { i: "z1", c: ["US"], pc: [], ...overrides };
}

function destination(overrides: Partial<Destination> = {}): Destination {
  return { country: "US", province: "CA", postal: "94105", ...overrides };
}

// ---------------------------------------------------------------------------
// Criterion 1 — UK
// ---------------------------------------------------------------------------

describe("004 criterion 1 — UK exact/prefix/partial", function () {
  const table: Array<{
    label: string;
    mode: WirePostalMode;
    value: string;
    postal: string;
    expected: boolean;
  }> = [
    { label: "EXACT 'SW1A 1AA' matches sw1a1aa", mode: "E", value: "SW1A 1AA", postal: "sw1a1aa", expected: true },
    { label: "PREFIX 'SW1A' matches sw1a1aa", mode: "P", value: "SW1A", postal: "sw1a1aa", expected: true },
    { label: "PARTIAL 'SW1A' matches sw1a1aa", mode: "C", value: "SW1A", postal: "sw1a1aa", expected: true },
    { label: "EXACT 'SW1A 1AA' does not match SW1A 2AA", mode: "E", value: "SW1A 1AA", postal: "SW1A 2AA", expected: false },
    { label: "PREFIX 'SW1A' matches SW1A 2AA", mode: "P", value: "SW1A", postal: "SW1A 2AA", expected: true },
    { label: "PARTIAL 'SW1A' matches SW1A 2AA", mode: "C", value: "SW1A", postal: "SW1A 2AA", expected: true },
    { label: "EXACT 'SW1A 1AA' does not match SW1B 1AA", mode: "E", value: "SW1A 1AA", postal: "SW1B 1AA", expected: false },
    { label: "PREFIX 'SW1A' does not match SW1B 1AA", mode: "P", value: "SW1A", postal: "SW1B 1AA", expected: false },
    { label: "PARTIAL 'SW1A' does not match SW1B 1AA", mode: "C", value: "SW1A", postal: "SW1B 1AA", expected: false },
  ];

  for (const row of table) {
    it(row.label, function () {
      const z = zone({ c: ["GB"], pc: [rule(row.mode, row.value)] });
      const result = matchesZone(z, destination({ country: "GB", province: null, postal: row.postal }));
      expect(result).toBe(row.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Criterion 2 — Canada FSAs
// ---------------------------------------------------------------------------

describe("004 criterion 2 — Canada PARTIAL/PREFIX on FSAs", function () {
  const cases: Array<{ mode: WirePostalMode; value: string; postal: string; expected: boolean }> = [
    { mode: "C", value: "K7K", postal: "K7K 5T2", expected: true },
    { mode: "C", value: "K7K", postal: "K7L 5T2", expected: false },
    { mode: "C", value: "K7", postal: "K7K 5T2", expected: true },
    { mode: "C", value: "K7", postal: "K7L 5T2", expected: true },
    { mode: "P", value: "K7K", postal: "K7K 5T2", expected: true },
    { mode: "P", value: "K7K", postal: "K7L 5T2", expected: false },
    { mode: "P", value: "K7", postal: "K7K 5T2", expected: true },
    { mode: "P", value: "K7", postal: "K7L 5T2", expected: true },
  ];

  for (const row of cases) {
    it(`${row.mode === "C" ? "PARTIAL" : "PREFIX"} "${row.value}" vs "${row.postal}" → ${row.expected}`, function () {
      const z = zone({ c: ["CA"], pc: [rule(row.mode, row.value)] });
      const result = matchesZone(z, destination({ country: "CA", province: "ON", postal: row.postal }));
      expect(result).toBe(row.expected);
    });
  }

  it("PREFIX and PARTIAL behave identically for FSAs across a fixture set", function () {
    const postals = ["K7K 5T2", "K7L 5T2", "K7M 9W9", "M5V 2T6", "T6G 2S5"];
    const patterns = ["K7K", "K7", "K", "M5V", "T6G"];
    for (const pattern of patterns) {
      for (const postal of postals) {
        const prefix = matchesZone(
          zone({ c: ["CA"], pc: [rule("P", pattern)] }),
          destination({ country: "CA", province: "ON", postal }),
        );
        const partial = matchesZone(
          zone({ c: ["CA"], pc: [rule("C", pattern)] }),
          destination({ country: "CA", province: "ON", postal }),
        );
        expect({ pattern, postal, prefix, partial }).toEqual({ pattern, postal, prefix, partial: prefix });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 3 — US ranges + ZIP+4
// ---------------------------------------------------------------------------

describe("004 criterion 3 — US RANGE and EXACT", function () {
  const rangeTable: Array<{ postal: string; expected: boolean; note: string }> = [
    { postal: "10001", expected: true, note: "inside range" },
    { postal: "20000", expected: true, note: "range end is inclusive" },
    { postal: "20001", expected: false, note: "one past the end" },
    { postal: "1000", expected: false, note: "below the start (not zero-padded)" },
    { postal: "09999", expected: false, note: "string below the start" },
    { postal: "ABCDE", expected: false, note: "non-numeric never matches a range" },
  ];

  for (const row of rangeTable) {
    it(`RANGE 10000-20000 vs "${row.postal}" (${row.note}) → ${row.expected}`, function () {
      const z = zone({ pc: [rule("R", "10000", "20000")] });
      expect(matchesZone(z, destination({ postal: row.postal }))).toBe(row.expected);
    });
  }

  it("EXACT 90210 matches '90210-1234' (ZIP+4 stripped) and plain '90210'", function () {
    const z = zone({ pc: [rule("E", "90210")] });
    expect(matchesZone(z, destination({ postal: "90210-1234" }))).toBe(true);
    expect(matchesZone(z, destination({ postal: "90210" }))).toBe(true);
    expect(matchesZone(z, destination({ postal: "90211" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Criterion 4 — country gate
// ---------------------------------------------------------------------------

describe("004 criterion 4 — country gate", function () {
  it("a CA zone never matches a US destination even with identical postal strings", function () {
    const z = zone({ c: ["CA"], pc: [rule("E", "90210")] });
    const dest = destination({ country: "US", province: null, postal: "90210" });
    expect(matchesZone(z, dest)).toBe(false);
    const explanation = explainZoneMatch(z, dest);
    expect(explanation.countryMatched).toBe(false);
  });

  it("wildcard country ['*'] matches any destination country", function () {
    const z = zone({ c: ["*"], pc: [] });
    expect(matchesZone(z, destination({ country: "US" }))).toBe(true);
    expect(matchesZone(z, destination({ country: "GB", province: null, postal: "SW1A 1AA" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — province gate
// ---------------------------------------------------------------------------

describe("004 criterion 5 — province gate", function () {
  it("['*'] matches any province", function () {
    const z = zone({ c: ["CA"], p: ["*"], pc: [] });
    expect(matchesZone(z, destination({ country: "CA", province: "BC" }))).toBe(true);
    expect(matchesZone(z, destination({ country: "CA", province: "qc" }))).toBe(true);
  });

  it("['*'] matches a MISSING province (spec: missing province allowed only when zone lists '*')", function () {
    const z = zone({ c: ["GB"], p: ["*"], pc: [] });
    const dest = destination({ country: "GB", province: null, postal: "SW1A 1AA" });
    expect(matchesZone(z, dest)).toBe(true);
  });

  it("['*'] matches an undefined province", function () {
    const z = zone({ c: ["GB"], p: ["*"], pc: [] });
    const dest: Destination = { country: "GB", province: undefined, postal: "SW1A 1AA" };
    expect(matchesZone(z, dest)).toBe(true);
  });

  it("an explicit province list does NOT match a missing province", function () {
    const z = zone({ c: ["US"], p: ["CA", "NY"], pc: [] });
    expect(matchesZone(z, destination({ country: "US", province: null }))).toBe(false);
  });

  it("an explicit province list matches only listed provinces", function () {
    const z = zone({ c: ["CA"], p: ["ON"], pc: [] });
    expect(matchesZone(z, destination({ country: "CA", province: "ON" }))).toBe(true);
    expect(matchesZone(z, destination({ country: "CA", province: "QC" }))).toBe(false);
  });

  it("an empty/absent province list is unconstrained (matches missing province)", function () {
    const zNoKey = zone({ c: ["GB"], pc: [] });
    expect(matchesZone(zNoKey, destination({ country: "GB", province: null }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Criterion 7 — explainZoneMatch gate identification
// ---------------------------------------------------------------------------

describe("004 criterion 7 — explainZoneMatch identifies the failing gate", function () {
  it("flags the country gate when the country does not match", function () {
    const z = zone({ c: ["CA"], p: ["ON"], pc: [rule("E", "K7K")] });
    const explanation = explainZoneMatch(z, destination({ country: "US", province: "ON", postal: "K7K" }));
    expect(explanation.matched).toBe(false);
    expect(explanation.countryMatched).toBe(false);
  });

  it("flags the province gate when the province does not match", function () {
    const z = zone({ c: ["US"], p: ["NY"], pc: [rule("E", "10001")] });
    const explanation = explainZoneMatch(z, destination({ country: "US", province: "CA", postal: "10001" }));
    expect(explanation.matched).toBe(false);
    expect(explanation.countryMatched).toBe(true);
    expect(explanation.provinceMatched).toBe(false);
  });

  it("flags the postal gate when no postal rule matches", function () {
    const z = zone({ c: ["US"], p: ["CA"], pc: [rule("E", "90210")] });
    const explanation = explainZoneMatch(z, destination({ country: "US", province: "CA", postal: "94105" }));
    expect(explanation.matched).toBe(false);
    expect(explanation.countryMatched).toBe(true);
    expect(explanation.provinceMatched).toBe(true);
    expect(explanation.postalMatched).toBe(false);
    expect(explanation.evaluatedPostal).toBe("94105");
  });

  it("reports postalMatched = null when the zone constrains no postal rules", function () {
    const z = zone({ c: ["US"], p: ["*"], pc: [] });
    const explanation = explainZoneMatch(z, destination({ country: "US", province: "CA", postal: "94105" }));
    expect(explanation.postalMatched).toBeNull();
    expect(explanation.matched).toBe(true);
  });

  it("evaluatedPostal carries the normalized input (trace substrate for 008)", function () {
    const z = zone({ c: ["GB"], pc: [rule("E", "SW1A 1AA")] });
    const explanation = explainZoneMatch(z, destination({ country: "GB", province: null, postal: "sw1a1aa" }));
    expect(explanation.evaluatedPostal).toBe("SW1A 1AA");
    expect(explanation.postalMatched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Normalization rules (spec 004 §2)
// ---------------------------------------------------------------------------

describe("normalizePostal (spec 004 normalization rules)", function () {
  it("uppercases and strips hyphens/spaces for comparison", function () {
    expect(normalizePostal("DE", "80331")).toBe("80331");
    expect(normalizePostal("AU", "2 0 00")).toBe("2000");
    expect(normalizePostal("US", "94105-1234")).toBe("94105");
    expect(normalizePostal("CA", "k7k 5t2")).toBe("K7K");
    expect(normalizePostal("GB", "sw1a1aa")).toBe("SW1A 1AA");
    expect(normalizePostal("GB", "SW1A    1AA")).toBe("SW1A 1AA");
    expect(normalizePostal(null, null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — bench: 100 zones × 50 postal rules < 10ms per destination
// ---------------------------------------------------------------------------

describe("004 criterion 9 — bench (100 zones × 50 postal rules)", function () {
  function buildZones(): WireZone[] {
    const zones: WireZone[] = [];
    for (let z = 0; z < 100; z += 1) {
      const pc = [];
      for (let r = 0; r < 50; r += 1) {
        const mode: WirePostalMode = (["E", "P", "R", "C"] as const)[r % 4];
        if (mode === "R") {
          // Ranges deliberately never cover 94105 — only the injected EXACT
          // rules below produce hits, keeping the matched-count sanity check.
          pc.push(rule("R", String(10000 + r), String(10050 + r)));
        } else {
          pc.push(rule(mode, `94${String(r).padStart(3, "0")}`));
        }
      }
      // Every 10th zone has an EXACT hit so real matching work happens.
      if (z % 10 === 0) {
        pc.push(rule("E", "94105"));
      }
      zones.push({ i: `z${z}`, c: ["US"], p: ["*"], pc });
    }
    return zones;
  }

  it("evaluates one destination against 100 zones × 50 rules in < 10ms (median of 20)", function () {
    const zones = buildZones();
    const dest = destination({ country: "US", province: "CA", postal: "94105" });

    function runOnce(): { ms: number; matched: number } {
      const start = performance.now();
      let matched = 0;
      for (const z of zones) {
        if (matchesZone(z, dest)) {
          matched += 1;
        }
      }
      return { ms: performance.now() - start, matched };
    }

    for (let warm = 0; warm < 5; warm += 1) {
      runOnce();
    }
    const samples: number[] = [];
    let lastMatched = -1;
    for (let i = 0; i < 20; i += 1) {
      const run = runOnce();
      samples.push(run.ms);
      lastMatched = run.matched;
    }
    samples.sort(function ascending(a, b) {
      return a - b;
    });
    const median = samples[Math.floor(samples.length / 2)];

    // Sanity: the fixture is not trivially all-miss (10 zones carry a hit).
    expect(lastMatched).toBe(10);
    expect(median).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Criterion 6 (amended 2026-09-06) — findMatchingZones: pure input-order filter
// ---------------------------------------------------------------------------

describe("004 criterion 6 (amended 2026-09-06) — findMatchingZones", function () {
  function ids(zs: WireZone[]): string[] {
    return zs.map(function (z) {
      return z.i;
    });
  }

  it("returns an empty array for empty input", function () {
    expect(findMatchingZones([], destination({}))).toEqual([]);
  });

  it("returns an empty array when no zone matches", function () {
    const zones = [zone({ i: "z1", c: ["CA"], pc: [] }), zone({ i: "z2", c: ["GB"], pc: [] })];
    expect(findMatchingZones(zones, destination({ country: "US" }))).toEqual([]);
  });

  it("preserves input order when multiple zones match (no sorting, no dedup)", function () {
    // Deliberately out of id/creation order: zB before zA; zMid never matches.
    const zones = [
      zone({ i: "zB", c: ["US"], pc: [] }),
      zone({ i: "zA", c: ["US"], pc: [] }),
      zone({ i: "zMid", c: ["CA"], pc: [] }),
    ];
    const result = findMatchingZones(zones, destination({ country: "US", province: "CA", postal: "94105" }));
    expect(ids(result)).toEqual(["zB", "zA"]); // input order…
    expect(ids(result)).not.toEqual(["zA", "zB"]); // …not sorted id order
  });

  it("is stable for equal matches — two identical zones are both returned in place", function () {
    const first = zone({ i: "dup", c: ["US"], pc: [] });
    const second = zone({ i: "dup", c: ["US"], pc: [] });
    const result = findMatchingZones([first, second], destination({}));
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
  });

  it("a ['*'] province zone matches a destination with province null", function () {
    const zones = [
      zone({ i: "wild", c: ["GB"], p: ["*"], pc: [] }),
      zone({ i: "explicit", c: ["GB"], p: ["ENG"], pc: [] }),
    ];
    const result = findMatchingZones(zones, destination({ country: "GB", province: null, postal: "SW1A 1AA" }));
    expect(ids(result)).toEqual(["wild"]);
  });

  it("does not mutate the input and returns a new array", function () {
    const z1 = zone({ i: "z1", c: ["US"], pc: [] });
    const z2 = zone({ i: "z2", c: ["CA"], pc: [] });
    const input = [z1, z2];
    const snapshot = input.slice();

    const result = findMatchingZones(input, destination({ country: "US" }));

    expect(result).not.toBe(input); // new array, never the input reference
    expect(input).toEqual(snapshot); // contents and order unchanged
    expect(input[0]).toBe(z1);
    expect(input[1]).toBe(z2);
    expect(ids(result)).toEqual(["z1"]);
  });

  it("matches non-postal zones when the destination has no postal code", function () {
    const zones = [
      zone({ i: "noPostal", c: ["US"], p: ["*"], pc: [] }),
      zone({ i: "postal", c: ["US"], p: ["*"], pc: [rule("E", "94105")] }),
    ];
    const result = findMatchingZones(zones, destination({ country: "US", province: "CA", postal: null }));
    expect(ids(result)).toEqual(["noPostal"]);
  });
});
