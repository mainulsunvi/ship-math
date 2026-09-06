import { describe, expect, it } from "vitest";
import { formatForDisplay, normalizePostal, validatePartialPattern } from "../postal";
import type { PostalRule } from "../config-schema";

describe("validatePartialPattern", function () {
  it("accepts valid UK outward fragments", function () {
    expect(validatePartialPattern("GB", "EC1A")).toBe(true);
    expect(validatePartialPattern("GB", "EC1")).toBe(true);
    expect(validatePartialPattern("GB", "E1")).toBe(true);
  });

  it("uppercases and trims input before matching", function () {
    expect(validatePartialPattern("gb", "  ec1a ")).toBe(true);
    expect(validatePartialPattern("ca", " k7k")).toBe(true);
  });

  it("accepts 'UK' as an alias for 'GB'", function () {
    expect(validatePartialPattern("UK", "EC1A")).toBe(true);
  });

  it("rejects invalid UK fragments", function () {
    expect(validatePartialPattern("GB", "")).toBe(false); // empty
    expect(validatePartialPattern("GB", "SW1A 1AA")).toBe(false); // full code, not a fragment
    expect(validatePartialPattern("GB", "ABC1")).toBe(false); // three area letters
    expect(validatePartialPattern("GB", "EC1AA")).toBe(false); // too long
    expect(validatePartialPattern("GB", "1EC")).toBe(false); // starts with digit
    expect(validatePartialPattern("GB", "K7 K")).toBe(false); // internal space
  });

  it("accepts valid Canadian FSAs", function () {
    expect(validatePartialPattern("CA", "K7K")).toBe(true);
    expect(validatePartialPattern("CA", "K7")).toBe(true);
    expect(validatePartialPattern("CA", "k7k")).toBe(true);
  });

  it("rejects invalid Canadian fragments", function () {
    expect(validatePartialPattern("CA", "K7K 5T2")).toBe(false); // full code
    expect(validatePartialPattern("CA", "5T2")).toBe(false); // starts with digit
    expect(validatePartialPattern("CA", "KK7")).toBe(false); // two letters up front
    expect(validatePartialPattern("CA", "")).toBe(false);
  });

  it("rejects PARTIAL for every other country (US included)", function () {
    expect(validatePartialPattern("US", "94")).toBe(false);
    expect(validatePartialPattern("US", "K7K")).toBe(false);
    expect(validatePartialPattern("DE", "10")).toBe(false);
    expect(validatePartialPattern("FR", "75")).toBe(false);
  });
});

describe("formatForDisplay", function () {
  it("renders PARTIAL as 'Starts with X'", function () {
    const rule: PostalRule = { id: "p1", mode: "PARTIAL", value: "94" };
    expect(formatForDisplay("PARTIAL", rule)).toBe("Starts with 94");
  });

  it("renders RANGE as 'start–end' with an en dash", function () {
    const rule: PostalRule = { id: "p2", mode: "RANGE", value: "10000", rangeEnd: "20000" };
    expect(formatForDisplay("RANGE", rule)).toBe("10000–20000");
  });

  it("renders a RANGE without an end as the start value", function () {
    const rule: PostalRule = { id: "p3", mode: "RANGE", value: "10000" };
    expect(formatForDisplay("RANGE", rule)).toBe("10000");
  });

  it("renders EXACT as the stored value", function () {
    const rule: PostalRule = { id: "p4", mode: "EXACT", value: "SW1A 1AA" };
    expect(formatForDisplay("EXACT", rule)).toBe("SW1A 1AA");
  });

  it("renders PREFIX distinctly from PARTIAL", function () {
    const rule: PostalRule = { id: "p5", mode: "PREFIX", value: "SW1A" };
    expect(formatForDisplay("PREFIX", rule)).toBe("Prefix SW1A");
  });
});

describe("normalizePostal (re-export single source of truth)", function () {
  it("re-exports the zone-matching normalizer", function () {
    expect(normalizePostal("GB", "sw1a1aa")).toBe("SW1A 1AA");
    expect(normalizePostal("US", "94105-1234")).toBe("94105");
    expect(normalizePostal("CA", "K7K 5T2")).toBe("K7K");
  });
});
