/**
 * Store-rate summary tests (spec 008 addendum): GraphQL deliveryProfiles
 * zone parsing, destination/subtotal/weight filtering (incl. rest-of-world
 * and province-restricted zones), and Function-lane ops applied to the
 * combined store + ShipMath list through the SHARED optionMatchesTarget
 * (parity by construction with checkout), with every customization recorded.
 */

import { describe, expect, it } from "vitest";
import {
  buildCheckoutOptions,
  pickStoreRates,
  storeRatesFromZones,
} from "../store-rates";

/** GraphQL delivery-profile zone nodes, flattened like fetchDeliveryZones. */
const ZONES = [
  {
    id: "gid://shopify/DeliveryZone/846446649",
    name: "Domestic",
    countries: [{ code: { countryCode: "US", restOfWorld: false }, provinces: [] }],
    methodDefinitions: {
      edges: [
        {
          node: {
            id: "gid://shopify/DeliveryMethodDefinition/159353577",
            name: "Standard",
            active: true,
            methodConditions: [],
            rateProvider: { price: { amount: "0.00" } },
          },
        },
        {
          node: {
            id: "gid://shopify/DeliveryMethodDefinition/159353578",
            name: "Express",
            active: true,
            methodConditions: [],
            rateProvider: { price: { amount: "15.00" } },
          },
        },
      ],
    },
  },
  {
    id: "gid://shopify/DeliveryZone/846446650",
    name: "Heavy",
    countries: [{ code: { countryCode: "US", restOfWorld: false }, provinces: [] }],
    methodDefinitions: {
      edges: [
        {
          node: {
            id: "gid://shopify/DeliveryMethodDefinition/206705707",
            name: "Freight",
            active: true,
            methodConditions: [
              {
                field: "TOTAL_WEIGHT",
                operator: "GREATER_THAN_OR_EQUAL_TO",
                conditionCriteria: { __typename: "Weight", unit: "KILOGRAMS", value: "10" },
              },
              {
                field: "TOTAL_WEIGHT",
                operator: "LESS_THAN_OR_EQUAL_TO",
                conditionCriteria: { __typename: "Weight", unit: "POUNDS", value: "44.1" },
              },
            ],
            rateProvider: { price: { amount: "40.00" } },
          },
        },
      ],
    },
  },
  {
    id: "gid://shopify/DeliveryZone/846446651",
    name: "Europe",
    countries: [{ code: { countryCode: "DE", restOfWorld: false }, provinces: [] }],
    methodDefinitions: {
      edges: [
        {
          node: {
            id: "gid://shopify/DeliveryMethodDefinition/159353579",
            name: "EU Standard",
            active: true,
            methodConditions: [],
            rateProvider: { price: { amount: "4.90" } },
          },
        },
      ],
    },
  },
];

const US_CART = { country: "US", province: null, subtotal: 50, weightGrams: 500 };

describe("storeRatesFromZones", function testParsing() {
  it("parses method definitions with static prices", function parses() {
    const rates = storeRatesFromZones(ZONES);
    expect(rates).toHaveLength(4);
    expect(rates[0]).toMatchObject({
      code: "store:159353577",
      title: "Standard",
      price: "0.00",
      zoneName: "Domestic",
      restOfWorld: false,
    });
    expect(rates[1]).toMatchObject({ title: "Express", price: "15.00" });
    expect(rates[3]).toMatchObject({ title: "EU Standard", zoneId: "gid://shopify/DeliveryZone/846446651" });
  });

  it("converts weight conditions to gram bounds", function weightBounds() {
    const rates = storeRatesFromZones(ZONES);
    // 44.1 lb × 453.592 g/lb = 20003.4072 g (exact decimal arithmetic).
    expect(rates[2]).toMatchObject({
      title: "Freight",
      weightLowGrams: 10000,
      weightHighGrams: 20003.4072,
    });
  });

  it("parses subtotal windows from TOTAL_PRICE conditions", function priceBounds() {
    const rates = storeRatesFromZones([
      {
        id: "gid://shopify/DeliveryZone/1",
        name: "Bounded",
        countries: [{ code: { countryCode: "US", restOfWorld: false }, provinces: [] }],
        methodDefinitions: {
          edges: [
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/2",
                name: "Banded",
                active: true,
                methodConditions: [
                  {
                    field: "TOTAL_PRICE",
                    operator: "GREATER_THAN_OR_EQUAL_TO",
                    conditionCriteria: { __typename: "MoneyV2", amount: "100.00" },
                  },
                  {
                    field: "TOTAL_PRICE",
                    operator: "LESS_THAN_OR_EQUAL_TO",
                    conditionCriteria: { __typename: "MoneyV2", amount: "200.00" },
                  },
                ],
                rateProvider: { price: { amount: "8.00" } },
              },
            },
          ],
        },
      },
    ]);
    expect(rates[0]).toMatchObject({ minOrderSubtotal: 100, maxOrderSubtotal: 200 });
  });

  it("flags rest-of-world zones and keeps province restrictions", function zoneShapes() {
    const rates = storeRatesFromZones([
      {
        id: "gid://shopify/DeliveryZone/3",
        name: "ROW",
        countries: [{ code: { countryCode: null, restOfWorld: true }, provinces: [] }],
        methodDefinitions: {
          edges: [
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/4",
                name: "Anywhere",
                active: true,
                methodConditions: [],
                rateProvider: { price: { amount: "12.00" } },
              },
            },
          ],
        },
      },
      {
        id: "gid://shopify/DeliveryZone/5",
        name: "NY only",
        countries: [
          {
            code: { countryCode: "US", restOfWorld: false },
            provinces: [{ code: "NY" }, { code: "NJ" }],
          },
        ],
        methodDefinitions: {
          edges: [
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/6",
                name: "Local",
                active: true,
                methodConditions: [],
                rateProvider: { price: { amount: "2.00" } },
              },
            },
          ],
        },
      },
    ]);
    expect(rates[0].restOfWorld).toBe(true);
    // Option-level countries keep the 2-field shape; ROW coverage rides on
    // the option's restOfWorld flag.
    expect(rates[0].countries).toEqual([{ code: "", provinces: [] }]);
    expect(rates[1].countries[0].provinces).toEqual(["NY", "NJ"]);
  });

  it("skips inactive methods, dynamic rates, and malformed entries, and dedupes by id", function skips() {
    const rates = storeRatesFromZones([
      {
        id: "gid://shopify/DeliveryZone/7",
        name: "Broken",
        countries: [{ code: { countryCode: "US", restOfWorld: false }, provinces: [] }],
        methodDefinitions: {
          edges: [
            null,
            { node: null },
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/8",
                name: "Inactive",
                active: false,
                methodConditions: [],
                rateProvider: { price: { amount: "1.00" } },
              },
            },
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/9",
                name: "Carrier participant",
                active: true,
                methodConditions: [],
                rateProvider: {},
              },
            },
            { node: { id: "gid://shopify/DeliveryMethodDefinition/10", name: "Ok", active: true, methodConditions: [], rateProvider: { price: { amount: "1.50" } } } },
          ],
        },
      },
      // Same zone linked twice → the method must appear once.
      {
        id: "gid://shopify/DeliveryZone/7",
        name: "Broken",
        countries: [],
        methodDefinitions: {
          edges: [
            { node: { id: "gid://shopify/DeliveryMethodDefinition/10", name: "Ok", active: true, methodConditions: [], rateProvider: { price: { amount: "1.50" } } } },
          ],
        },
      },
      null,
      { name: "no id" },
    ]);
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ title: "Ok", price: "1.50" });
  });
});

describe("pickStoreRates", function testFiltering() {
  const rates = storeRatesFromZones(ZONES);

  it("matches by country and drops rates from other zones", function byCountry() {
    const picked = pickStoreRates(rates, US_CART);
    expect(picked.map(function title(rate) {
      return rate.title;
    })).toEqual(["Standard", "Express"]);
  });

  it("respects the weight window", function weightWindow() {
    const picked = pickStoreRates(rates, { ...US_CART, weightGrams: 15000 });
    expect(picked.map(function title(rate) {
      return rate.title;
    })).toEqual(["Standard", "Express", "Freight"]);
  });

  it("respects subtotal bounds inclusive on both ends", function subtotalBounds() {
    const bounded = storeRatesFromZones(ZONES).map(function bound(rate) {
      return rate.title === "Standard" ? { ...rate, minOrderSubtotal: 100, maxOrderSubtotal: 200 } : rate;
    });
    expect(pickStoreRates(bounded, { ...US_CART, subtotal: 99.99 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Express" })]),
    );
    expect(pickStoreRates(bounded, { ...US_CART, subtotal: 100 }).map(function title(r) {
      return r.title;
    })).toContain("Standard");
    expect(pickStoreRates(bounded, { ...US_CART, subtotal: 200 }).map(function title(r) {
      return r.title;
    })).toContain("Standard");
    expect(pickStoreRates(bounded, { ...US_CART, subtotal: 200.01 }).map(function title(r) {
      return r.title;
    })).not.toContain("Standard");
  });

  it("requires a matching province when the zone restricts them", function provinceRestriction() {
    const restricted = storeRatesFromZones([
      {
        id: "gid://shopify/DeliveryZone/8",
        name: "NY only",
        countries: [
          { code: { countryCode: "US", restOfWorld: false }, provinces: [{ code: "NY" }] },
        ],
        methodDefinitions: {
          edges: [
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/11",
                name: "Local",
                active: true,
                methodConditions: [],
                rateProvider: { price: { amount: "2.00" } },
              },
            },
          ],
        },
      },
    ]);
    expect(pickStoreRates(restricted, { ...US_CART, province: "NY" })).toHaveLength(1);
    expect(pickStoreRates(restricted, { ...US_CART, province: "CA" })).toHaveLength(0);
    expect(pickStoreRates(restricted, { ...US_CART, province: null })).toHaveLength(0);
  });

  it("covers any country through a rest-of-world zone", function restOfWorld() {
    const row = storeRatesFromZones([
      {
        id: "gid://shopify/DeliveryZone/9",
        name: "ROW",
        countries: [{ code: { countryCode: null, restOfWorld: true }, provinces: [] }],
        methodDefinitions: {
          edges: [
            {
              node: {
                id: "gid://shopify/DeliveryMethodDefinition/12",
                name: "Anywhere",
                active: true,
                methodConditions: [],
                rateProvider: { price: { amount: "12.00" } },
              },
            },
          ],
        },
      },
    ]);
    expect(pickStoreRates(row, { ...US_CART, country: "JP" })).toHaveLength(1);
  });

  it("returns nothing without a destination country", function needsCountry() {
    expect(pickStoreRates(rates, { ...US_CART, country: "" })).toHaveLength(0);
  });
});

describe("buildCheckoutOptions", function testCombined() {
  const rates = storeRatesFromZones(ZONES);
  const CARRIER = [{ serviceCode: "shipmath-1", serviceName: "Flat 5", priceCents: "500" }];

  it("lists store rates then carrier rates with no ops", function plain() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [],
      carrierRates: CARRIER,
    });
    expect(preview.options.map(function title(option) {
      return option.title;
    })).toEqual(["Standard", "Express", "Flat 5"]);
    expect(preview.options.map(function source(option) {
      return option.source;
    })).toEqual(["STORE", "STORE", "SHIPMATH"]);
    expect(preview.customizations).toEqual([]);
    expect(preview.unmatchedOps).toBe(0);
  });

  it("hides only the targeted option (case-insensitive contains) and records it", function hidesTargeted() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [{ ruleId: "r1", ruleName: "No express", kind: "HIDE", titleContains: "express" }],
      carrierRates: CARRIER,
    });
    expect(preview.options.map(function title(option) {
      return option.title;
    })).toEqual(["Standard", "Flat 5"]);
    expect(preview.customizations).toEqual([
      { kind: "HIDE", ruleName: "No express", title: "Express" },
    ]);
  });

  it("a hide with no filter removes every option, carrier rates included", function hidesAll() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [{ ruleId: "r1", ruleName: "Hide everything", kind: "HIDE" }],
      carrierRates: CARRIER,
    });
    expect(preview.options).toHaveLength(0);
    expect(preview.customizations).toHaveLength(3);
  });

  it("renames the matched option and records old and new title", function renames() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [
        { ruleId: "r1", ruleName: "Brand it", kind: "RENAME", titleContains: "Standard", title: "Eco Standard" },
      ],
      carrierRates: [],
    });
    expect(preview.options.map(function title(option) {
      return option.title;
    })).toEqual(["Eco Standard", "Express"]);
    expect(preview.customizations).toEqual([
      { kind: "RENAME", ruleName: "Brand it", title: "Standard", renamedTo: "Eco Standard" },
    ]);
  });

  it("ops also apply to ShipMath's own carrier rates", function carrierOps() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [
        { ruleId: "r1", ruleName: "Brand the flat", kind: "RENAME", titleContains: "Flat", title: "Flat 5 (branded)" },
      ],
      carrierRates: CARRIER,
    });
    expect(preview.options[2]).toMatchObject({ title: "Flat 5 (branded)", source: "SHIPMATH" });
  });

  it("a pickup-targeted hide never touches shipping options and counts unmatched", function methodFilter() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [
        { ruleId: "r1", ruleName: "Hide pickup", kind: "HIDE", methodType: "PICK_UP", titleContains: "standard" },
      ],
      carrierRates: [],
    });
    expect(preview.options).toHaveLength(2);
    expect(preview.customizations).toEqual([]);
    expect(preview.unmatchedOps).toBe(1);
  });

  it("moves an option inside the combined list, clamped", function moves() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [
        { ruleId: "r1", ruleName: "Express first", kind: "MOVE", titleContains: "Express", index: 0 },
      ],
      carrierRates: CARRIER,
    });
    expect(preview.options.map(function title(option) {
      return option.title;
    })).toEqual(["Express", "Standard", "Flat 5"]);
    expect(preview.customizations).toEqual([
      { kind: "MOVE", ruleName: "Express first", title: "Express", index: 0 },
    ]);
    const clamped = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [
        { ruleId: "r1", ruleName: "Express last", kind: "MOVE", titleContains: "Express", index: 99 },
      ],
      carrierRates: CARRIER,
    });
    expect(clamped.options.map(function title(option) {
      return option.title;
    })).toEqual(["Standard", "Flat 5", "Express"]);
    expect(clamped.customizations[0]).toMatchObject({ kind: "MOVE", index: 2 });
  });

  it("applies ops in rule priority order: a hide beats a later move", function orderMatters() {
    const preview = buildCheckoutOptions({
      storeRates: rates,
      cart: US_CART,
      functionOperations: [
        { ruleId: "r1", ruleName: "No express", kind: "HIDE", titleContains: "Express" },
        { ruleId: "r2", ruleName: "Express first", kind: "MOVE", titleContains: "Express", index: 0 },
      ],
      carrierRates: CARRIER,
    });
    expect(preview.options.map(function title(option) {
      return option.title;
    })).toEqual(["Standard", "Flat 5"]);
    expect(preview.unmatchedOps).toBe(1);
  });
});
