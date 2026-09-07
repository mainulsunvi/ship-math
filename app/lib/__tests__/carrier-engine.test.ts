/**
 * Carrier engine unit tests (spec 007 criteria 1, 2, 7 + mode semantics).
 * Table-driven per plan 007 Task 2: flat, free-over-threshold, weight tier,
 * per-item with freeItems, percentage, handling fee, cap-after-fee,
 * currency labeling, FIRST_MATCH/ALL_MATCH/stopOnMatch, zone gating.
 */

import { describe, expect, it } from "vitest";
import { computeRates, type CarrierRule, type CarrierCartContext } from "../carrier/engine";
import type { CarrierRateAction } from "../carrier/action-schema";
import type { WireZone } from "../rule-evaluation";

function action(overrides: Partial<CarrierRateAction>): CarrierRateAction {
  return {
    mode: "flat",
    amount: "10",
    serviceName: "ShipMath Standard",
    serviceCode: "shipmath_standard",
    ...overrides,
  } as CarrierRateAction;
}

function rule(overrides: Partial<CarrierRule> & { action: CarrierRateAction }): CarrierRule {
  return {
    id: "r1",
    priority: 1,
    stopOnMatch: false,
    zoneId: null,
    conditions: null,
    ...overrides,
  };
}

const BASE_CART: CarrierCartContext = {
  destination: { country: "US", province: "CA", postal: "94105" },
  currency: "USD",
  subtotal: "120.00",
  weightGrams: 2500,
  quantity: 3,
  skus: ["SKU-1"],
  vendors: ["Acme"],
};

/** Criterion 7: rates are labeled with the shop currency (no FX invention). */
const EUR_CART: CarrierCartContext = { ...BASE_CART, currency: "EUR" };

describe("007 criterion 1 — rate math cases (table-driven)", function () {
  const cases: Array<{
    name: string;
    rules: CarrierRule[];
    cart?: CarrierCartContext;
    mode?: "FIRST_MATCH" | "ALL_MATCH";
    want: Array<{ serviceCode: string; priceCents: string }>;
  }> = [
    {
      name: "flat rate",
      rules: [rule({ action: action({ mode: "flat", amount: "12.5" }) })],
      want: [{ serviceCode: "shipmath_standard", priceCents: "1250" }],
    },
    {
      name: "free-over-threshold via tiered subtotal band (from 100, open-ended, free)",
      rules: [
        rule({
          action: action({
            mode: "tiered",
            amount: undefined,
            tiers: [
              { basis: "subtotal", from: 0, to: 100, amount: "9.99" },
              { basis: "subtotal", from: 100, amount: "0" },
            ],
          }),
        }),
      ],
      want: [{ serviceCode: "shipmath_standard", priceCents: "0" }], // subtotal 120 ≥ 100 → free band
    },
    {
      name: "weight tier in kilograms (6000 g = 6 kg → 5–10 band)",
      rules: [
        rule({
          action: action({
            mode: "tiered",
            tiers: [
              { basis: "weight", from: 0, to: 5, amount: "6" },
              { basis: "weight", from: 5, to: 10, amount: "11" },
              { basis: "weight", from: 10, amount: "22" },
            ],
          }),
        }),
      ],
      cart: { ...BASE_CART, weightGrams: 6000 },
      want: [{ serviceCode: "shipmath_standard", priceCents: "1100" }],
    },
    {
      name: "weight band edges: from inclusive (5000 g = 5 kg → second band), below exclusive (4999 g → first band)",
      rules: [
        rule({
          action: action({
            mode: "tiered",
            tiers: [
              { basis: "weight", from: 0, to: 5, amount: "6" },
              { basis: "weight", from: 5, to: 10, amount: "11" },
            ],
          }),
        }),
      ],
      cart: { ...BASE_CART, weightGrams: 5000 },
      want: [{ serviceCode: "shipmath_standard", priceCents: "1100" }],
    },
    {
      name: "weight band edges: 2.5 kg stays in the 0–5 band",
      rules: [
        rule({
          action: action({
            mode: "tiered",
            tiers: [
              { basis: "weight", from: 0, to: 5, amount: "6" },
              { basis: "weight", from: 5, to: 10, amount: "11" },
            ],
          }),
        }),
      ],
      cart: { ...BASE_CART, weightGrams: 2500 },
      want: [{ serviceCode: "shipmath_standard", priceCents: "600" }],
    },
    {
      name: "per-item incremental with 1 free item (3 qty − 1 = 2 × 1.50)",
      rules: [
        rule({
          action: action({
            mode: "flat",
            amount: "5",
            perItem: { amount: "1.50", freeItems: 1 },
          }),
        }),
      ],
      want: [{ serviceCode: "shipmath_standard", priceCents: "800" }], // 5 + 2×1.50
    },
    {
      name: "percentage of subtotal (10% of 120.00)",
      rules: [rule({ action: action({ mode: "percentage", percentage: 10 }) })],
      want: [{ serviceCode: "shipmath_standard", priceCents: "1200" }],
    },
    {
      name: "handling fee added last (flat 5 + handling 2.25)",
      rules: [
        rule({ action: action({ mode: "flat", amount: "5", handlingFee: "2.25" }) }),
      ],
      want: [{ serviceCode: "shipmath_standard", priceCents: "725" }],
    },
    {
      name: "cap clamps AFTER handling fee (5 + 2.25 = 7.25 → cap 6 → 6.00)",
      rules: [
        rule({ action: action({ mode: "flat", amount: "5", handlingFee: "2.25", cap: "6" }) }),
      ],
      want: [{ serviceCode: "shipmath_standard", priceCents: "600" }],
    },
    {
      name: "per-weight kg (2.5 kg × 2.00/kg = 5.00 + flat 1)",
      rules: [
        rule({
          action: action({
            mode: "flat",
            amount: "1",
            perWeight: { amount: "2.00", per: "kg" },
          }),
        }),
      ],
      want: [{ serviceCode: "shipmath_standard", priceCents: "600" }],
    },
    {
      name: "tiered: no band covers the cart → rule produces no rate",
      rules: [
        rule({
          action: action({
            mode: "tiered",
            tiers: [{ basis: "quantity", from: 10, amount: "5" }], // cart qty = 3
          }),
        }),
      ],
      want: [],
    },
  ];

  for (const c of cases) {
    it(c.name, function () {
      const rates = computeRates(c.rules, [], c.cart ?? BASE_CART, "ALL_MATCH");
      expect(rates.map(function strip(r) {
        return { serviceCode: r.serviceCode, priceCents: r.priceCents };
      })).toEqual(c.want);
    });
  }
});

describe("007 — rule pipeline semantics", function () {
  const cheap = rule({
    id: "cheap",
    priority: 1,
    action: action({ mode: "flat", amount: "5", serviceCode: "cheap" }),
  });
  const pricey = rule({
    id: "pricey",
    priority: 2,
    action: action({ mode: "flat", amount: "50", serviceCode: "pricey" }),
  });

  it("FIRST_MATCH returns only the first producing rule", function () {
    const rates = computeRates([pricey, cheap], [], BASE_CART, "FIRST_MATCH");
    expect(rates.map(function code(r) {
      return r.serviceCode;
    })).toEqual(["cheap"]);
  });

  it("ALL_MATCH returns every matching rule in priority order", function () {
    const rates = computeRates([pricey, cheap], [], BASE_CART, "ALL_MATCH");
    expect(rates.map(function code(r) {
      return r.serviceCode;
    })).toEqual(["cheap", "pricey"]);
  });

  it("stopOnMatch halts ALL_MATCH after the stopping rule", function () {
    const stopper = rule({
      id: "stopper",
      priority: 1,
      stopOnMatch: true,
      action: action({ mode: "flat", amount: "9", serviceCode: "stopper" }),
    });
    const rates = computeRates([stopper, pricey], [], BASE_CART, "ALL_MATCH");
    expect(rates.map(function code(r) {
      return r.serviceCode;
    })).toEqual(["stopper"]);
  });

  it("a tier rule that fails math does NOT consume FIRST_MATCH", function () {
    const failing = rule({
      id: "failing",
      priority: 1,
      action: action({
        mode: "tiered",
        tiers: [{ basis: "quantity", from: 10, amount: "5" }],
      }),
    });
    const rates = computeRates([failing, cheap], [], BASE_CART, "FIRST_MATCH");
    expect(rates.map(function code(r) {
      return r.serviceCode;
    })).toEqual(["cheap"]);
  });
});

describe("007 — zone + condition gating", function () {
  const zones: WireZone[] = [{ i: "z1", c: ["CA"] }];

  it("zone hit produces the rate", function () {
    const zoned = rule({ zoneId: "z1", action: action({ serviceCode: "zoned" }) });
    const ca = computeRates(
      [zoned],
      zones,
      { ...BASE_CART, destination: { country: "CA", province: null, postal: null } },
      "ALL_MATCH",
    );
    expect(ca).toHaveLength(1);
  });

  it("zone miss skips the rule (fail-closed on missing zone)", function () {
    const zoned = rule({ zoneId: "z1", action: action({ serviceCode: "zoned" }) });
    const missing = rule({ zoneId: "nope", action: action({ serviceCode: "missing" }) });
    const rates = computeRates([zoned, missing], zones, BASE_CART, "ALL_MATCH");
    expect(rates).toHaveLength(0);
  });

  it("conditions gate the rule (subtotal > 200 does not match 120)", function () {
    const gated = rule({
      conditions: { o: "A", n: [{ f: "subtotal", q: ">", v: 200 }] },
      action: action({ serviceCode: "gated" }),
    });
    const rates = computeRates([gated], [], BASE_CART, "ALL_MATCH");
    expect(rates).toHaveLength(0);
  });
});

describe("007 criterion 7 — currency labeling", function () {
  it("labels rates with the requested currency without converting", function () {
    const rates = computeRates(
      [rule({ action: action({ mode: "flat", amount: "12.5" }) })],
      [],
      EUR_CART,
      "ALL_MATCH",
    );
    expect(rates).toHaveLength(1);
    expect(rates[0].priceCents).toBe("1250"); // same digits — no FX
  });

  it("passes description through when present", function () {
    const rates = computeRates(
      [rule({ action: action({ mode: "flat", amount: "1", description: "Evri 2–3 days" }) })],
      [],
      BASE_CART,
      "ALL_MATCH",
    );
    expect(rates[0].description).toBe("Evri 2–3 days");
  });
});
