/**
 * parseZoneForm unit tests (spec 003, plan Task 4): the shared zone form
 * parser extracted verbatim from app/routes/app.zones.tsx — the zones page
 * and the setup wizard's `wizard-zone-create` intent validate byte-
 * identically through this one function. Pure: FormData in, value or
 * fieldErrors out; no Prisma, no network (route-level wiring is covered by
 * wizard-intents.test.ts against the fixture DB).
 *
 * Previously this logic had NO direct coverage: the zones route has no route
 * test, and the wizard reuses the same parser — this suite pins it.
 */

import { describe, expect, it } from "vitest";
import { parseZoneForm } from "../zone-form";

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const key of Object.keys(entries)) {
    formData.append(key, entries[key]);
  }
  return formData;
}

describe("003 — parseZoneForm valid forms", function () {
  it("parses a full single-country form: codes uppercased + trimmed, postal rules preserved", function () {
    const result = parseZoneForm(
      form({
        name: "  California metro  ",
        enabled: "1",
        countries: '[" us "]',
        provinces: '["ca", "NY"]',
        postalRules: '[{"id":"p1","mode":"PREFIX","value":"94"}]',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("California metro"); // trimmed
      expect(result.value.enabled).toBe(true);
      expect(result.value.countries).toEqual(["US"]);
      expect(result.value.provinces).toEqual(["CA", "NY"]);
      expect(result.value.postalRules).toEqual([{ id: "p1", mode: "PREFIX", value: "94" }]);
    }
  });

  it("defaults enabled to false when the flag is absent", function () {
    const result = parseZoneForm(
      form({ name: "Z", countries: '["US"]', provinces: "[]", postalRules: "[]" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(false);
    }
  });

  it("normalizes provinces to [\"*\"] for a multi-country zone (spec 004: provinces are single-country only)", function () {
    const result = parseZoneForm(
      form({
        name: "EU",
        countries: '["de","fr"]',
        provinces: '["bay"]', // must be ignored, not stored
        postalRules: "[]",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.countries).toEqual(["DE", "FR"]);
      expect(result.value.provinces).toEqual(["*"]);
    }
  });

  it("normalizes provinces to [\"*\"] for a worldwide zone, collapsing mixed input", function () {
    const result = parseZoneForm(
      form({
        name: "Everywhere",
        countries: '["*","us"]', // parseCodeArray collapses to ["*"]
        provinces: '["ca"]',
        postalRules: "[]",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.countries).toEqual(["*"]);
      expect(result.value.provinces).toEqual(["*"]);
    }
  });

  it("preserves a valid UK PARTIAL rule", function () {
    const result = parseZoneForm(
      form({
        name: "London",
        countries: '["GB"]',
        provinces: '["*"]',
        postalRules: '[{"id":"p1","mode":"PARTIAL","value":"EC1A"}]',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.postalRules).toEqual([{ id: "p1", mode: "PARTIAL", value: "EC1A" }]);
    }
  });
});

describe("003 — parseZoneForm field errors", function () {
  it("missing name AND empty countries report BOTH field errors", function () {
    const result = parseZoneForm(form({ name: "   ", countries: "[]", provinces: "[]", postalRules: "[]" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.name).toBe("Zone name is required.");
      expect(result.fieldErrors.countries).toBe("Select at least one destination country (or worldwide).");
    }
  });

  it("malformed countries JSON counts as empty (countries error)", function () {
    const result = parseZoneForm(form({ name: "Z", countries: "{oops}", provinces: "[]", postalRules: "[]" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.countries).toBeDefined();
    }
  });

  it("malformed postalRules JSON reports the postal error", function () {
    const result = parseZoneForm(
      form({ name: "Z", countries: '["US"]', provinces: "[]", postalRules: "[{bad" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toBe("Postal rules are malformed.");
    }
  });

  it("a postal rule failing its own schema reports the postal error", function () {
    const result = parseZoneForm(
      form({
        name: "Z",
        countries: '["US"]',
        provinces: "[]",
        postalRules: '[{"id":"p1","mode":"NOPE","value":"1"}]',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toBe("Postal rules are malformed.");
    }
  });

  it("PARTIAL with multiple countries is rejected", function () {
    const result = parseZoneForm(
      form({
        name: "Z",
        countries: '["GB","FR"]',
        provinces: "[]",
        postalRules: '[{"id":"p1","mode":"PARTIAL","value":"EC1A"}]',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toContain("PARTIAL requires exactly one selected country");
    }
  });

  it("PARTIAL for a non-UK/CA country is rejected", function () {
    const result = parseZoneForm(
      form({
        name: "Z",
        countries: '["US"]',
        provinces: "[]",
        postalRules: '[{"id":"p1","mode":"PARTIAL","value":"902"}]',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toContain("only available for United Kingdom and Canada");
    }
  });

  it("PARTIAL with a pattern that is not a valid UK outward code is rejected", function () {
    const result = parseZoneForm(
      form({
        name: "Z",
        countries: '["GB"]',
        provinces: "[]",
        postalRules: '[{"id":"p1","mode":"PARTIAL","value":"SW1A 1AA"}]', // full code, not an outward fragment
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toContain("is not a valid partial code for GB");
    }
  });

  it("RANGE with end <= start is rejected", function () {
    const result = parseZoneForm(
      form({
        name: "Z",
        countries: '["US"]',
        provinces: "[]",
        postalRules: '[{"id":"p1","mode":"RANGE","value":"20000","rangeEnd":"10000"}]',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toContain("Range end must be greater than the range start");
    }
  });

  it("EXACT with an empty value is rejected", function () {
    const result = parseZoneForm(
      form({
        name: "Z",
        countries: '["US"]',
        provinces: "[]",
        postalRules: '[{"id":"p1","mode":"EXACT","value":"  "}]',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.postal).toContain("Value is required");
    }
  });
});
