/**
 * Zone matching — pure logic shared by:
 *   - the Delivery Function (compiled into the WASM bundle),
 *   - the simulator and rule UI (spec 004/008).
 *
 * NO imports allowed here: this file is bundled into the Function runtime.
 *
 * Wire-format zones (see app/lib/config-schema.ts) use short keys:
 *   { i: id, c: ["CA","US"], p: ["ON"], pc: [{ m: "E", x: "95100" }, { m: "R", x: "10000", e: "20000" }] }
 * Postal modes: E = EXACT, P = PREFIX, R = RANGE, C = CONTAINS (partial).
 */

export type WirePostalMode = "E" | "P" | "R" | "C";

export interface WirePostalRule {
  m: WirePostalMode;
  x: string;
  e?: string;
}

export interface WireZone {
  i: string;
  c?: string[];
  p?: string[];
  pc?: WirePostalRule[];
}

export interface Destination {
  country?: string | null;
  province?: string | null;
  postal?: string | null;
}

export interface ZoneMatchExplanation {
  matched: boolean;
  countryMatched: boolean;
  provinceMatched: boolean;
  postalMatched: boolean | null; // null = no postal rules constrained
  evaluatedPostal?: string; // normalized postal actually used
}

/** Normalize a postal code for comparison (spec 004 rules). */
export function normalizePostal(country: string | null | undefined, postal: string | null | undefined): string {
  if (!postal) {
    return "";
  }
  const upper = postal.toUpperCase().trim();
  const c = (country || "").toUpperCase();
  if (c === "US") {
    // Strip ZIP+4: 94105-1234 → 94105
    const dash = upper.indexOf("-");
    return dash === 5 ? upper.slice(0, dash) : upper;
  }
  if (c === "CA") {
    // FSA = first three characters ("K7K 2B4" → "K7K")
    const compact = upper.replace(/\s+/g, "");
    return compact.slice(0, 3);
  }
  if (c === "GB") {
    // Normalize internal spacing: "sw1a1aa" → "SW1A 1AA"
    const compact = upper.replace(/\s+/g, "");
    if (compact.length > 3) {
      return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
    }
    return compact;
  }
  return upper.replace(/\s+/g, "");
}

function listMatches(list: string[] | undefined, value: string | null | undefined): boolean {
  if (!list || list.length === 0) {
    return true; // unconstrained
  }
  if (!value) {
    return false;
  }
  const v = value.toUpperCase();
  return list.some((entry) => {
    const e = entry.toUpperCase();
    return e === "*" || e === v;
  });
}

function postalRuleMatches(rule: WirePostalRule, normalized: string): boolean {
  const x = rule.x ? rule.x.toUpperCase() : "";
  const end = rule.e ? rule.e.toUpperCase() : "";
  switch (rule.m) {
    case "E":
      return normalized === x;
    case "P":
      return normalized.startsWith(x);
    case "R": {
      if (!x || !end) {
        return false;
      }
      // Numeric ranges (US ZIP style). Compare numerically when both parse.
      const a = Number(x);
      const b = Number(end);
      const v = Number(normalized);
      if (!Number.isNaN(a) && !Number.isNaN(b) && !Number.isNaN(v)) {
        return v >= a && v <= b;
      }
      return normalized >= x && normalized <= end;
    }
    case "C":
      return normalized.includes(x);
    default:
      return false;
  }
}

/** Full zone match with explanation (used by simulator + tests). */
export function explainZoneMatch(zone: WireZone, destination: Destination): ZoneMatchExplanation {
  const countryMatched = listMatches(zone.c, destination.country);
  const provinceMatched = listMatches(zone.p, destination.province);
  const evaluatedPostal = normalizePostal(destination.country, destination.postal);
  const rules = zone.pc || [];
  let postalMatched: boolean | null = null;
  if (rules.length > 0) {
    postalMatched = evaluatedPostal !== "" && rules.some((rule) => postalRuleMatches(rule, evaluatedPostal));
  }
  return {
    matched: countryMatched && provinceMatched && (postalMatched === null || postalMatched),
    countryMatched,
    provinceMatched,
    postalMatched,
    evaluatedPostal,
  };
}

/** Fast path used by the Function runtime. */
export function matchesZone(zone: WireZone, destination: Destination): boolean {
  return explainZoneMatch(zone, destination).matched;
}
