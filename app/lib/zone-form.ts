/**
 * Shared zone form parser (plan 003 Task 4 reuses the zones editor's
 * validation; review note: extracted VERBATIM from app/routes/app.zones.tsx
 * so the zones page and the setup wizard's `wizard-zone-create` intent
 * validate byte-identically). Pure input parsing: no Prisma, no network.
 * The CALLER owns the write and the mirror sync.
 */

import { z } from "zod";
import { PostalRuleSchema, type PostalRule } from "./config-schema";
import { formatForDisplay, parseCodeArray, validatePostalRuleForCountries } from "./postal";

export interface ZoneFormValue {
  name: string;
  enabled: boolean;
  countries: string[];
  provinces: string[];
  postalRules: PostalRule[];
}

export function parseZoneForm(formData: FormData): { ok: true; value: ZoneFormValue } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    fieldErrors.name = "Zone name is required.";
  }
  const enabled = formData.get("enabled") === "1";

  const countries = parseCodeArray(String(formData.get("countries") ?? "[]"));
  if (countries.length === 0) {
    fieldErrors.countries = "Select at least one destination country (or worldwide).";
  }
  // Provinces are only meaningful for a single-country zone (spec 004): a
  // multi-country or worldwide zone normalizes to ["*"] on write.
  const provinces =
    countries.length === 1 && countries[0] !== "*" ? parseCodeArray(String(formData.get("provinces") ?? "[]")) : ["*"];

  let postalRules: PostalRule[] = [];
  const postalRaw = String(formData.get("postalRules") ?? "[]");
  try {
    const result = z.array(PostalRuleSchema).safeParse(JSON.parse(postalRaw));
    if (!result.success) {
      fieldErrors.postal = "Postal rules are malformed.";
    } else {
      postalRules = result.data;
    }
  } catch {
    fieldErrors.postal = "Postal rules are malformed.";
  }

  if (fieldErrors.postal === undefined) {
    for (const rule of postalRules) {
      const message = validatePostalRuleForCountries(rule, countries);
      if (message !== null) {
        fieldErrors.postal = `Postal rule “${formatForDisplay(rule.mode, rule)}”: ${message}`;
        break;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, value: { name, enabled, countries, provinces, postalRules } };
}
