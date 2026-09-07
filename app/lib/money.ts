/**
 * Decimal money helpers (architecture.md §A3 rate math) — PURE module.
 *
 * All money in ShipMath is a decimal STRING. Floats are never used for
 * arithmetic; these helpers do schoolbook addition/multiplication on the
 * digit strings so results stay exact (plan 007 Task 2: "No Number()
 * arithmetic on money anywhere").
 *
 * Scope: non-negative values only. The carrier engine never produces
 * negative amounts (zod schema forbids them; clamping floors at zero).
 */

/** Split "12.5" → ["12", "5"]. Assumes MONEY_STRING_PATTERN-valid input. */
function splitDecimal(value: string): [string, string] {
  const dot = value.indexOf(".");
  if (dot === -1) {
    return [value, ""];
  }
  return [value.slice(0, dot), value.slice(dot + 1)];
}

/** Trim leading zeros ("007" → "7"); keep a single zero ("000" → "0"). */
function trimInt(intPart: string): string {
  const trimmed = intPart.replace(/^0+(?=\d)/, "");
  return trimmed === "" ? "0" : trimmed;
}

/** Pad the shorter fraction with trailing zeros so both have equal length. */
function alignFractions(a: string, b: string): [string, string] {
  const len = Math.max(a.length, b.length);
  return [a.padEnd(len, "0"), b.padEnd(len, "0")];
}

/** Add two non-negative decimal strings: addDecimals("12.5", "0.25") → "12.75". */
export function addDecimals(a: string, b: string): string {
  const [intA, fracA] = splitDecimal(a);
  const [intB, fracB] = splitDecimal(b);
  const [fa, fb] = alignFractions(fracA, fracB);

  // Fraction addition (right to left; fraction lengths are now equal)
  let carry = 0;
  let fracOut = "";
  for (let i = fa.length - 1; i >= 0; i--) {
    const sum = (fa.charCodeAt(i) - 48) + (fb.charCodeAt(i) - 48) + carry;
    fracOut = String(sum % 10) + fracOut;
    carry = sum > 9 ? 1 : 0;
  }

  // Integer addition
  const ia = trimInt(intA);
  const ib = trimInt(intB);
  const width = Math.max(ia.length, ib.length);
  let intOut = "";
  for (let i = 0; i < width; i++) {
    const da = i < ia.length ? ia.charCodeAt(ia.length - 1 - i) - 48 : 0;
    const db = i < ib.length ? ib.charCodeAt(ib.length - 1 - i) - 48 : 0;
    const sum = da + db + carry;
    intOut = String(sum % 10) + intOut;
    carry = sum > 9 ? 1 : 0;
  }
  if (carry > 0) {
    intOut = "1" + intOut;
  }

  const trimmedFrac = fracOut.replace(/0+$/, "");
  return trimmedFrac === "" ? trimInt(intOut) : `${trimInt(intOut)}.${trimmedFrac}`;
}

/**
 * Multiply two non-negative decimal strings exactly:
 * multiplyDecimals("12.5", "12.5") → "156.25". Long multiplication over the
 * digit strings; the result scale is the sum of the operand scales.
 */
export function multiplyDecimals(a: string, b: string): string {
  const [intA, fracA] = splitDecimal(a);
  const [intB, fracB] = splitDecimal(b);
  const digitsA = (trimInt(intA) + fracA).replace(/^0+(?=\d)/, "") || "0";
  const digitsB = (trimInt(intB) + fracB).replace(/^0+(?=\d)/, "") || "0";

  if (digitsA === "0" || digitsB === "0") {
    return "0";
  }

  // Schoolbook long multiplication, LSB-first digit arrays.
  const result = new Array<number>(digitsA.length + digitsB.length).fill(0);
  for (let i = digitsA.length - 1; i >= 0; i--) {
    const da = digitsA.charCodeAt(i) - 48;
    if (da === 0) {
      continue;
    }
    for (let j = digitsB.length - 1; j >= 0; j--) {
      const db = digitsB.charCodeAt(j) - 48;
      const pos = i + j + 1;
      const sum = result[pos] + da * db;
      result[pos] = sum % 10;
      result[pos - 1] += Math.floor(sum / 10);
    }
  }
  for (let i = result.length - 1; i > 0; i--) {
    if (result[i] > 9) {
      result[i - 1] += Math.floor(result[i] / 10);
      result[i] %= 10;
    }
  }

  const joined = result.join("").replace(/^0+(?=\d)/, "");
  const scale = fracA.length + fracB.length;
  if (scale === 0) {
    return trimInt(joined);
  }
  const cut = joined.length - scale;
  const intOut = cut <= 0 ? "0" : trimInt(joined.slice(0, cut));
  const fracOut = joined.slice(Math.max(0, cut)).padStart(scale, "0");
  const trimmedFrac = fracOut.replace(/0+$/, "");
  return trimmedFrac === "" ? intOut : `${intOut}.${trimmedFrac}`;
}

/**
 * Multiply a decimal string by a non-negative integer represented as a
 * string: multiplyDecimal("12.5", "3") → "37.5". The multiplier stays a
 * string so the call sites never touch Number on money.
 */
export function multiplyDecimal(value: string, integerMultiplier: string): string {
  return multiplyDecimals(value, trimInt(integerMultiplier));
}

/** Is a <= b for decimal strings: isAtMost("12.5", "12.75") → true. */
export function isAtMost(a: string, b: string): boolean {
  const [intA, fracA] = splitDecimal(a);
  const [intB, fracB] = splitDecimal(b);
  const ia = trimInt(intA);
  const ib = trimInt(intB);
  const width = Math.max(ia.length, ib.length);
  const na = ia.padStart(width, "0");
  const nb = ib.padStart(width, "0");
  if (na !== nb) {
    return na < nb;
  }
  const [fa, fb] = alignFractions(fracA, fracB);
  return fa <= fb;
}

/** Strictly less: isLess("2.5", "10") → true; isLess("5", "5") → false. */
export function isLess(a: string, b: string): boolean {
  return isAtMost(a, b) && !isAtMost(b, a);
}

/** Clamp to a maximum: clampMax("20", "12.5") → "12.5"; clampMax("5", "12.5") → "5". */
export function clampMax(value: string, max: string): string {
  return isAtMost(value, max) ? value : max;
}

/** Add one to a non-negative integer string: "99" → "100", "1250" → "1251". */
function incrementInteger(value: string): string {
  const digits = value.split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] !== "9") {
      digits[i] = String(digits[i].charCodeAt(0) - 48 + 1);
      return trimInt(digits.join(""));
    }
    digits[i] = "0";
  }
  return "1" + digits.join("");
}

/**
 * Round half-up to cents and render as a cents string: toCentsString("12.5")
 * → "1250"; toCentsString("0.005") → "1". The rounding happens on digit
 * strings — never via Number arithmetic.
 */
export function toCentsString(value: string): string {
  const [intPart, fracPart] = splitDecimal(value);
  const firstTwo = (fracPart + "00").slice(0, 2); // exactly two fraction digits
  const rest = fracPart.slice(2);
  // int digits + two fraction digits IS the cents digit string (12 + "50" → "1250").
  let cents = trimInt(trimInt(intPart) + firstTwo);
  if (rest.length > 0 && rest.charCodeAt(0) - 48 >= 5) {
    cents = incrementInteger(cents); // round half-up on the remaining fraction
  }
  return cents;
}
