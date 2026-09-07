/**
 * Simulator core tests (spec 008 Task 2): parity with the production engine
 * (byte-identical rates), overlapping-rule traces with winners per
 * evaluation mode, out-of-zone runs naming the gate, SIMULATION log rows,
 * and test-mode independence (the simulator is the preview surface).
 */

import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { simulateRun } from "../simulate";
import { computeRates, type CarrierRule, type CarrierCartContext } from "../carrier/engine";
import type { SimInput } from "../simulate";

const DOMAIN = "simulator.myshopify.com";
const ALLMATCH_DOMAIN = "simulator-allmatch.myshopify.com";
const TESTMODE_DOMAIN = "simulator-testmode.myshopify.com";

const FLAT_ACTION = {
  mode: "flat",
  amount: "5.00",
  serviceName: "ShipMath Standard",
  serviceCode: "shipmath_standard",
} as const;

function simInput(overrides: Partial<SimInput> = {}): SimInput {
  return {
    lines: [
      { title: "T-shirt", price: "15.00", weightGrams: 500, quantity: 2, sku: "SKU-1", vendor: "Acme" },
    ],
    destination: { country: "US", province: "CA", postal: "94105" },
    loggedIn: true,
    customerTags: [],
    ...overrides,
  };
}

async function shopIdFor(domain: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: domain } });
  return shop.id;
}

async function seedCarrierRule(
  shopId: string,
  actionJson: object,
  overrides: { priority?: number; zoneId?: string | null; name?: string; conditions?: string } = {},
) {
  return prisma.shippingRule.create({
    data: {
      shopId,
      name: overrides.name ?? "Carrier rule",
      kind: "CARRIER_RATE",
      priority: overrides.priority ?? 10,
      zoneId: overrides.zoneId ?? null,
      conditions: overrides.conditions ?? '{"combinator":"AND","conditions":[]}',
      action: JSON.stringify(actionJson),
    },
  });
}

async function seedZone(shopId: string, data: Partial<{ countries: string; provinces: string; postalRules: string; enabled: boolean; name: string }> = {}) {
  return prisma.zone.create({
    data: {
      shopId,
      name: data.name ?? "US CA",
      countries: data.countries ?? '["US"]',
      provinces: data.provinces ?? '["CA"]',
      postalRules: data.postalRules ?? "[]",
      enabled: data.enabled ?? true,
    },
  });
}

async function seedHideRule(shopId: string, overrides: { priority?: number; name?: string; conditions?: string; action?: object; zoneId?: string | null } = {}) {
  return prisma.shippingRule.create({
    data: {
      shopId,
      name: overrides.name ?? "Hide pickup for big carts",
      kind: "HIDE",
      priority: overrides.priority ?? 10,
      zoneId: overrides.zoneId ?? null,
      conditions: overrides.conditions ?? '{"combinator":"AND","conditions":[{"field":"subtotal","operator":"gte","value":20}]}',
      action: JSON.stringify(overrides.action ?? { target: { method: "PICK_UP" } }),
    },
  });
}

beforeEach(async function resetDatabase() {
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
  await prisma.shop.create({ data: { shopDomain: DOMAIN, testMode: false } });
  await prisma.shop.create({ data: { shopDomain: ALLMATCH_DOMAIN, testMode: false, evaluationMode: "ALL_MATCH" } });
  await prisma.shop.create({ data: { shopDomain: TESTMODE_DOMAIN, testMode: true } });
});

describe("008 simulateRun — parity with the production engine", function () {
  it("rates are byte-identical to computeRates for the same fixture", async function () {
    // ALL_MATCH shop so both rates come back (FIRST_MATCH stops at one).
    const shopId = await shopIdFor(ALLMATCH_DOMAIN);
    const zone = await seedZone(shopId);
    await seedCarrierRule(shopId, FLAT_ACTION, { zoneId: zone.id, priority: 10, name: "Flat 5" });
    await seedCarrierRule(shopId, {
      mode: "tiered",
      tiers: [
        { basis: "weight", from: 0, to: 2, amount: "6.00" },
        { basis: "weight", from: 2, amount: "11.00" },
      ],
      serviceName: "ShipMath Tiered",
      serviceCode: "shipmath_tiered",
    }, { priority: 20, name: "Tiered" });

    // ALL_MATCH on both sides so both rates come back (FIRST_MATCH stops at one).
    const result = await simulateRun(ALLMATCH_DOMAIN, simInput());
    const stored = await prisma.shippingRule.findMany({
      where: { shopId, kind: "CARRIER_RATE", enabled: true },
      orderBy: { priority: "asc" },
    });
    const zones = await prisma.zone.findMany({ where: { shopId, enabled: true } });
    const direct: CarrierRule[] = [
      {
        id: stored[0]?.id ?? "",
        priority: 10,
        stopOnMatch: false,
        zoneId: "z1",
        conditions: null,
        action: FLAT_ACTION,
      },
      {
        id: stored[1]?.id ?? "",
        priority: 20,
        stopOnMatch: false,
        zoneId: null,
        conditions: null,
        action: {
          mode: "tiered",
          tiers: [
            { basis: "weight", from: 0, to: 2, amount: "6.00" },
            { basis: "weight", from: 2, amount: "11.00" },
          ],
          serviceName: "ShipMath Tiered",
          serviceCode: "shipmath_tiered",
        },
      },
    ];
    const cart: CarrierCartContext = {
      destination: { country: "US", province: "CA", postal: "94105" },
      currency: "USD",
      subtotal: "30.00",
      weightGrams: 1000,
      quantity: 2,
      skus: ["SKU-1"],
      vendors: ["Acme"],
    };
    const expected = computeRates(direct, zones.map(function wire(_zoneRow, index) {
      return { i: `z${index + 1}`, c: ["US"], p: ["CA"] };
    }), cart, "ALL_MATCH");

    // BYTE-identical (spec 008 criterion 3): same JSON string, not just deep-equal.
    expect(JSON.stringify(result.rates)).toBe(JSON.stringify(expected));
    expect(result.rates.map(function price(rate) {
      return rate.priceCents;
    })).toEqual(["500", "600"]); // flat 5.00; 1 kg → band [0,2) = 6.00
  });
});

describe("008 simulateRun — traces, winners, and gates", function () {
  it("overlapping rules both evaluate; winners follow evaluation mode; the loser names its failed condition", async function () {
    const shopId = await shopIdFor(ALLMATCH_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION, { priority: 10, name: "Flat 5" });
    await seedCarrierRule(shopId, {
      ...FLAT_ACTION,
      serviceName: "ShipMath Big",
      serviceCode: "shipmath_big",
    }, {
      priority: 20,
      name: "Big carts only",
      conditions: '{"combinator":"AND","conditions":[{"field":"subtotal","operator":"gte","value":500}]}',
    });

    const result = await simulateRun(ALLMATCH_DOMAIN, simInput());

    // ALL_MATCH: both rules EVALUATED (criterion 1)…
    expect(result.carrierTraces).toHaveLength(2);
    expect(result.carrierTraces.every(function matched(trace) {
      return trace.ruleName !== "";
    })).toBe(true);
    const big = result.carrierTraces.find(function find(trace) {
      return trace.ruleName === "Big carts only";
    });
    // …and the loser names its failed condition (subtotal >= 500).
    expect(big?.matched).toBe(false);
    expect(big?.failedCondition).toMatchObject({ f: "subtotal", q: ">=", v: 500 });

    // The winner list is the rates that actually came back.
    expect(result.rates.map(function name(rate) {
      return rate.serviceName;
    })).toEqual(["ShipMath Standard"]);
  });

  it("FIRST_MATCH marks the single winning function rule per evaluation mode", async function () {
    const shopId = await shopIdFor(DOMAIN);
    await seedHideRule(shopId, { priority: 10, name: "Hide pickup big" });
    await seedHideRule(shopId, {
      priority: 20,
      name: "Hide pickup always",
      conditions: '{"combinator":"AND","conditions":[]}',
    });

    const result = await simulateRun(DOMAIN, simInput());

    expect(result.traces).toHaveLength(2);
    expect(result.traces.filter(function winner(trace) {
      return trace.winner;
    }).map(function name(trace) {
      return trace.ruleName;
    })).toEqual(["Hide pickup big"]);
    expect(result.functionOperations).toHaveLength(1);
    expect(result.functionOperations[0]).toMatchObject({ ruleName: "Hide pickup big", kind: "HIDE", methodType: "PICK_UP" });
  });

  it("a destination outside all zones returns no rates and names the country gate", async function () {
    const shopId = await shopIdFor(DOMAIN);
    const zone = await seedZone(shopId, { countries: '["US"]', provinces: "[]" });
    await seedCarrierRule(shopId, FLAT_ACTION, { zoneId: zone.id });

    const result = await simulateRun(DOMAIN, simInput({
      destination: { country: "GB", province: null, postal: "SW1A 1AA" },
    }));

    expect(result.rates).toEqual([]); // "no rates"
    expect(result.carrierTraces[0]).toMatchObject({ matched: false, zoneGate: "country" }); // gate named
    expect(result.carrierTraces[0]?.ruleName).toBe("Carrier rule");
  });

  it("runs unaffected by test mode — the simulator is the preview surface", async function () {
    const shopId = await shopIdFor(TESTMODE_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION);
    await seedHideRule(shopId);

    const result = await simulateRun(TESTMODE_DOMAIN, simInput());

    expect(result.testMode).toBe(true);
    expect(result.rates).toHaveLength(1); // carrier lane still previews
    expect(result.functionOperations).toHaveLength(1); // function lane still previews
  });

  it("a mirror over budget produces a note and empty function traces, carrier lane still runs", async function () {
    // 008: config-too-large path degrades gracefully (note + bytes, no throw).
    const shopId = await shopIdFor(DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION);
    // Postal lists are the usual byte hog (function-config's own warning).
    const bigPostalCodes = Array.from({ length: 3000 }, function entry(_, index) {
      return `SW1A ${String(index % 100).padStart(2, "0")} ${String(index % 10)}AA`;
    });
    // The zone must be REFERENCED by a rule, or buildWireZones skips it.
    const hugeZone = await prisma.zone.create({
      data: {
        shopId,
        name: "Huge postal list",
        countries: '["GB"]',
        provinces: "[]",
        postalRules: JSON.stringify(
          bigPostalCodes.map(function rule(value) {
            return { id: `p-${value}`, mode: "EXACT", value };
          }),
        ),
      },
    });
    await seedHideRule(shopId, {
      name: "Postal hog",
      action: { target: { method: "PICK_UP" } },
      zoneId: hugeZone.id,
    });

    const result = await simulateRun(DOMAIN, simInput({
      destination: { country: "GB", province: null, postal: "SW1A 1AA" },
    }));

    expect(result.note).toBeTruthy();
    expect(result.wireBytes).toBeGreaterThan(9500);
    expect(result.traces).toEqual([]); // mirror unusable → no function traces
    expect(result.rates).toHaveLength(1); // carrier lane unaffected
  });
});

describe("008 simulateRun — SIMULATION log rows", function () {
  it("writes one SIMULATION RequestLog row with the trace", async function () {
    const shopId = await shopIdFor(DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION, { name: "Flat 5" });

    await simulateRun(DOMAIN, simInput());

    const rows = await prisma.requestLog.findMany({ where: { shopId, source: "SIMULATION" } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.latencyMs).toBeTypeOf("number");
    const matched = JSON.parse(row?.matched ?? "[]") as Array<{ ruleName: string; lane: string; matched: boolean }>;
    expect(matched).toEqual([
      expect.objectContaining({ ruleName: "Flat 5", lane: "CARRIER", matched: true, producedRate: true }),
    ]);
    const input = JSON.parse(row?.input ?? "{}") as { subtotal: string; destination: { country: string } };
    // Decimal strings normalize ("15.00" x 2 → "30") — valid per the money rules.
    expect(input.subtotal).toBe("30");
    expect(input.destination.country).toBe("US");
    const rates = JSON.parse(row?.rates ?? "{}") as { rates: unknown[] };
    expect(rates.rates).toHaveLength(1);
  });

  it("onlyRuleIds scopes the run to the selected rules (combined-rules picker)", async function () {
    const shopId = await shopIdFor(DOMAIN);
    const zone = await seedZone(shopId);
    await seedCarrierRule(shopId, FLAT_ACTION, { zoneId: zone.id, priority: 10, name: "Flat 5" });
    const hide = await seedHideRule(shopId, { priority: 20, name: "Hide pickup" });

    // Only the function rule is selected: the carrier lane contributes nothing.
    const scoped = await simulateRun(DOMAIN, simInput({ onlyRuleIds: [hide.id] }));
    expect(scoped.carrierTraces).toEqual([]);
    expect(scoped.rates).toEqual([]);
    expect(scoped.traces.map(function name(trace) {
      return trace.ruleName;
    })).toEqual(["Hide pickup"]);
    expect(scoped.functionOperations).toHaveLength(1);

    // The default (no selection) still runs every rule in both lanes.
    const full = await simulateRun(DOMAIN, simInput());
    expect(full.carrierTraces).toHaveLength(1);
    expect(full.traces).toHaveLength(1);
  });
});
