/**
 * money.ts unit tests (spec 007, plan Task 2 verification): exact decimal
 * string arithmetic — no float drift anywhere.
 */

import { describe, expect, it } from "vitest";
import {
  addDecimals,
  clampMax,
  isAtMost,
  isLess,
  multiplyDecimal,
  multiplyDecimals,
  toCentsString,
} from "../money";

describe("007 — addDecimals (exact string addition)", function () {
  const cases: Array<{ a: string; b: string; want: string }> = [
    { a: "0", b: "0", want: "0" },
    { a: "12.5", b: "0.25", want: "12.75" },
    { a: "0.1", b: "0.2", want: "0.3" }, // the classic float case — must stay exact
    { a: "1.005", b: "0.005", want: "1.01" },
    { a: "999", b: "1", want: "1000" },
    { a: "0.99", b: "0.01", want: "1" },
    { a: "12.5", b: "3", want: "15.5" },
    { a: "0.001", b: "0.002", want: "0.003" },
  ];
  for (const { a, b, want } of cases) {
    it(`addDecimals(${a}, ${b}) → ${want}`, function () {
      expect(addDecimals(a, b)).toBe(want);
    });
  }
});

describe("007 — multiplication (exact string products)", function () {
  const cases: Array<{ value: string; multiplier: string; want: string }> = [
    { value: "12.5", multiplier: "3", want: "37.5" },
    { value: "0.99", multiplier: "7", want: "6.93" },
    { value: "2.5", multiplier: "0", want: "0" },
    { value: "1.99", multiplier: "100", want: "199" },
  ];
  for (const { value, multiplier, want } of cases) {
    it(`multiplyDecimal(${value}, ${multiplier}) → ${want}`, function () {
      expect(multiplyDecimal(value, multiplier)).toBe(want);
    });
  }

  const decimalCases: Array<{ a: string; b: string; want: string }> = [
    { a: "12.5", b: "12.5", want: "156.25" },
    { a: "1200", b: "12.5", want: "15000" }, // percentage-style product
    { a: "15000", b: "0.01", want: "150" }, // ÷ 100 via × 0.01
    { a: "0.1", b: "0.1", want: "0.01" },
    { a: "5", b: "453.59237", want: "2267.96185" },
    { a: "453.59237", b: "0.0022046226", want: "0.999999990089562" }, // grams→lb factor
  ];
  for (const { a, b, want } of decimalCases) {
    it(`multiplyDecimals(${a}, ${b}) → ${want}`, function () {
      expect(multiplyDecimals(a, b)).toBe(want);
    });
  }
});

describe("007 — comparisons and clamping", function () {
  it("isAtMost orders decimals", function () {
    expect(isAtMost("12.5", "12.75")).toBe(true);
    expect(isAtMost("2.5", "10")).toBe(true);
    expect(isAtMost("10", "2.5")).toBe(false);
    expect(isAtMost("5", "5")).toBe(true);
    expect(isAtMost("5.00", "5")).toBe(true);
  });

  it("isLess is strict", function () {
    expect(isLess("9.99", "10")).toBe(true);
    expect(isLess("10", "10")).toBe(false);
    expect(isLess("10.01", "10")).toBe(false);
    expect(isLess("2.5", "10")).toBe(true);
  });

  it("clampMax keeps the smaller", function () {
    expect(clampMax("20", "12.5")).toBe("12.5");
    expect(clampMax("5", "12.5")).toBe("5");
    expect(clampMax("12.5", "12.5")).toBe("12.5");
  });
});

describe("007 — toCentsString (round half-up at the response boundary)", function () {
  const cases: Array<{ value: string; want: string }> = [
    { value: "12.5", want: "1250" },
    { value: "0", want: "0" },
    { value: "0.01", want: "1" },
    { value: "199", want: "19900" },
    { value: "0.005", want: "1" }, // half a cent rounds up
    { value: "0.004", want: "0" },
    { value: "1.999", want: "200" }, // second fraction digit 9 rounds up
    { value: "12.345", want: "1235" }, // 1234.5 → half-up → 1235
  ];
  for (const { value, want } of cases) {
    it(`toCentsString(${value}) → ${want}`, function () {
      expect(toCentsString(value)).toBe(want);
    });
  }
});
