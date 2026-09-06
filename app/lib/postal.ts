/**
 * Postal helpers shared by the editor UI and the server backstop (spec 004)
 * — app-side glue over the wire-format matcher. PURE module: the only
 * runtime import is zone-matching.ts (itself dependency-free and
 * WASM-bundled — single source of truth for normalizePostal); config-schema
 * contributes types only. Also hosts validatePostalRuleForCountries and
 * parseCodeArray so server code never imports from a component file
 * (review 004/005).
 */

import type { PostalMode, PostalRule } from "./config-schema";
import { normalizePostal } from "./zone-matching";

export { normalizePostal };
export type { PostalMode, PostalRule };

/**
 * PARTIAL is a UK/CA-only editor mode (spec 004 OQ-1 default):
 *   UK — outward code: area letters + district digit + optional final
 *        letter/digit ("EC1A", "EC1")
 *   CA — FSA: letter + digit + optional second letter ("K7K", "K7")
 * Any other country rejects PARTIAL at validation time.
 */
const UK_PARTIAL_PATTERN = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const CA_PARTIAL_PATTERN = /^[A-Z]\d[A-Z]?$/;

/**
 * Countries that accept PARTIAL patterns (spec 004 OQ-1 default). Single
 * source shared by the validator below and the editor's mode filtering
 * (moved here from PostalRuleEditor.tsx with the validator).
 */
export const PARTIAL_COUNTRIES: ReadonlyArray<string> = ["GB", "UK", "CA"];

/**
 * Whether `pattern` is a valid PARTIAL fragment for `countryCode`
 * ("GB"/"UK" alias both accepted; every other country is rejected).
 * Input is uppercased and trimmed before matching.
 */
export function validatePartialPattern(countryCode: string, pattern: string): boolean {
  const country = countryCode.trim().toUpperCase();
  const candidate = pattern.trim().toUpperCase();
  if (country === "GB" || country === "UK") {
    return UK_PARTIAL_PATTERN.test(candidate);
  }
  if (country === "CA") {
    return CA_PARTIAL_PATTERN.test(candidate);
  }
  return false;
}

/**
 * Human label for table + diff surfaces, e.g. "Starts with 94" (PARTIAL),
 * "10000–20000" (RANGE), "SW1A 1AA" (EXACT). PREFIX renders "Prefix X" —
 * "Starts with" is reserved for PARTIAL per plan 004/005 Task 1.
 */
export function formatForDisplay(mode: PostalMode, rule: PostalRule): string {
  switch (mode) {
    case "EXACT":
      return rule.value;
    case "PREFIX":
      return `Prefix ${rule.value}`;
    case "RANGE":
      return rule.rangeEnd ? `${rule.value}–${rule.rangeEnd}` : rule.value;
    case "PARTIAL":
      return `Starts with ${rule.value}`;
    default:
      return rule.value;
  }
}

/**
 * Editor- and server-side validation of one postal rule against the zone's
 * current country selection (spec 004 Task 2). Moved here from
 * PostalRuleEditor.tsx (review 004/005: server code must not import from a
 * component file) so the editor, the zone modal, and the zones route
 * backstop share one implementation. Returns null when the rule is valid
 * for the zone's current country selection.
 */
export function validatePostalRuleForCountries(rule: PostalRule, countries: string[]): string | null {
  const value = rule.value.trim();
  if (value === "") {
    return "Value is required.";
  }
  if (rule.mode === "RANGE") {
    if (!/^\d+$/.test(value)) {
      return "Range start must be a whole number.";
    }
    const end = (rule.rangeEnd ?? "").trim();
    if (!/^\d+$/.test(end)) {
      return "Range end must be a whole number.";
    }
    if (Number(end) <= Number(value)) {
      return "Range end must be greater than the range start.";
    }
    return null;
  }
  if (rule.mode === "PARTIAL") {
    if (countries.length !== 1) {
      return "PARTIAL requires exactly one selected country.";
    }
    if (!PARTIAL_COUNTRIES.includes(countries[0].trim().toUpperCase())) {
      return "PARTIAL is only available for United Kingdom and Canada.";
    }
    if (!validatePartialPattern(countries[0], value)) {
      return `“${value}” is not a valid partial code for ${countries[0]}.`;
    }
    return null;
  }
  return null; // EXACT / PREFIX — any non-empty string
}

/**
 * Canonical parser for the JSON string[] columns on Zone (countries /
 * provinces): single source of the byte-identical parseStringArray (loader)
 * and normalizeCodeArray (action) helpers that lived inline in
 * app/routes/app.zones.tsx (review 004/005: collapse duplicated form-array
 * helpers; route call sites re-point in the Frontend pass). Malformed JSON,
 * a non-array, or any non-string entry yields []; entries are trimmed +
 * uppercased, empties dropped, and "*" collapses the list to exactly ["*"]
 * (worldwide). Written without zod — all-or-nothing validation matches
 * z.array(z.string()) semantics exactly — so postal.ts stays inside the
 * purity-guard import allowlist.
 */
export function parseCodeArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(function isString(entry) {
      return typeof entry === "string";
    })) {
      return [];
    }
    const values = (parsed as string[])
      .map(function clean(entry) {
        return entry.trim().toUpperCase();
      })
      .filter(function keep(entry) {
        return entry.length > 0;
      });
    return values.includes("*") ? ["*"] : values;
  } catch {
    return [];
  }
}
