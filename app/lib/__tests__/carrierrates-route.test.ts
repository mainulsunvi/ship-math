/**
 * Integration tests for the public carrier callback route (spec 007 §A3):
 * signed POST → rates; every failure gate answers 200 {rates: []} (never 4xx
 * — Shopify treats non-20x as "force backup rates" and has NO retry); latency
 * budget guard; 60-line cart fixture; RequestLog row on success.
 *
 * The route module pulls in shopify.server transitively (verify.ts), so
 * vitest.config provides stub SHOPIFY_* env vars (same test-only pattern as
 * SHIPMATH_TEST_DATABASE_URL). HMAC signing here uses the same stub secret.
 */

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { action, loader } from "../../routes/carrierrates";

const SECRET = process.env.SHOPIFY_API_SECRET ?? "";
const LIVE_DOMAIN = "carrier-live.myshopify.com";
const TESTMODE_DOMAIN = "carrier-testmode.myshopify.com";
const ALLMATCH_DOMAIN = "carrier-allmatch.myshopify.com";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("base64");
}

interface CallbackItem {
  name?: string;
  sku?: string;
  quantity?: number;
  grams?: number;
  price?: number;
  vendor?: string;
}

function callbackBody(overrides: { domain?: string; items?: CallbackItem[] } = {}): string {
  return JSON.stringify({
    rate: {
      origin_shop_domain: overrides.domain ?? LIVE_DOMAIN,
      currency: "USD",
      destination: { country: "US", province: "CA", postal_code: "94105" },
    },
    items:
      overrides.items ?? [
        { name: "T", sku: "SKU-1", quantity: 2, grams: 500, price: 1500, vendor: "Acme" },
      ],
  });
}

async function callAction(rawBody: string, hmac: string | null, method = "POST") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (hmac !== null) {
    headers.set("X-Shopify-Hmac-Sha256", hmac);
  }
  const request = new Request("https://shipmath.test/carrierrates", {
    method,
    headers,
    body: method === "GET" ? undefined : rawBody,
  });
  return action({ request, params: {}, context: {} } as unknown as ActionFunctionArgs);
}

const FLAT_ACTION = {
  mode: "flat",
  amount: "5.00",
  serviceName: "ShipMath Standard",
  serviceCode: "shipmath_standard",
};

async function seedCarrierRule(
  shopId: string,
  actionJson: object,
  overrides: { priority?: number; zoneId?: string | null; name?: string } = {},
) {
  return prisma.shippingRule.create({
    data: {
      shopId,
      name: overrides.name ?? "Carrier rule",
      kind: "CARRIER_RATE",
      priority: overrides.priority ?? 10,
      zoneId: overrides.zoneId ?? null,
      conditions: '{"combinator":"AND","conditions":[]}',
      action: JSON.stringify(actionJson),
    },
  });
}

async function shopIdFor(domain: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: domain } });
  return shop.id;
}

/** Polls the fixture DB until the fire-and-forget RequestLog insert lands. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) {
      return true;
    }
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(async function resetDatabase() {
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
  await prisma.shop.create({ data: { shopDomain: LIVE_DOMAIN, testMode: false } });
  await prisma.shop.create({ data: { shopDomain: TESTMODE_DOMAIN, testMode: true } });
  await prisma.shop.create({
    data: { shopDomain: ALLMATCH_DOMAIN, testMode: false, evaluationMode: "ALL_MATCH" },
  });
});

describe("007 carrier callback — happy path", function () {
  it("loader answers 200 with empty rates (anything not the signed POST)", async function () {
    const response = await loader({
      request: new Request("https://shipmath.test/carrierrates"),
      params: {},
      context: {},
    } as unknown as LoaderFunctionArgs);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
  });

  it("non-POST action → 200 empty", async function () {
    const response = await callAction("{}", null, "GET");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
  });

  it("signed callback for a live shop returns the computed rate as subunit string", async function () {
    await seedCarrierRule(await shopIdFor(LIVE_DOMAIN), FLAT_ACTION);
    const body = callbackBody();
    const response = await callAction(body, sign(body));
    expect(response.status).toBe(200);
    // subtotal 1500¢ × 2 = "30.00"; flat "5.00" → 500 subunits (docs: 500 = 5.00 CAD).
    expect(await response.json()).toEqual({
      rates: [
        {
          service_name: "ShipMath Standard",
          service_code: "shipmath_standard",
          description: "", // docs: description is REQUIRED — always a string
          currency: "USD",
          total_price: "500",
        },
      ],
    });
  });

  it("writes one CARRIER_CALLBACK RequestLog row after a successful call", async function () {
    const shopId = await shopIdFor(LIVE_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION);
    const body = callbackBody();
    await callAction(body, sign(body));

    const logged = await waitFor(function oneRow() {
      return prisma.requestLog
        .count({ where: { shopId, source: "CARRIER_CALLBACK" } })
        .then(function isOne(count) {
          return count === 1;
        });
    });
    expect(logged).toBe(true);
  });

  it("handles a 60-line cart fixture through the weight-tier pipeline", async function () {
    await seedCarrierRule(await shopIdFor(LIVE_DOMAIN), {
      mode: "tiered",
      tiers: [
        { basis: "weight", from: 0, to: 5, amount: "6.00" },
        { basis: "weight", from: 5, to: 10, amount: "11.00" },
        { basis: "weight", from: 10, amount: "16.00" },
      ],
      serviceName: "ShipMath Tiered",
      serviceCode: "shipmath_tiered",
    });
    // 60 lines × 100 g = 6000 g = 6 kg → band [5, 10) → "11.00" → 1100 subunits.
    const items: CallbackItem[] = Array.from({ length: 60 }, function line(_, index) {
      return { name: `Item ${index}`, sku: `SKU-${index}`, quantity: 1, grams: 100, price: 1000 };
    });
    const body = callbackBody({ items });
    const response = await callAction(body, sign(body));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { rates: Array<{ total_price: string }> };
    expect(payload.rates).toHaveLength(1);
    expect(payload.rates[0]?.total_price).toBe("1100");
  });
});

describe("007 carrier callback — fail-open gates (always 200 {rates: []})", function () {
  it("bad HMAC → 200 empty and no RequestLog", async function () {
    const shopId = await shopIdFor(LIVE_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION);
    const body = callbackBody();
    const forged = createHmac("sha256", "wrong-secret").update(body).digest("base64");
    const response = await callAction(body, forged);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
    expect(await prisma.requestLog.count()).toBe(0);
  });

  it("signed garbage body → 200 empty", async function () {
    const response = await callAction("not json at all", sign("not json at all"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
  });

  it("signed payload for a domain that is not installed → 200 empty", async function () {
    const body = callbackBody({ domain: "ghost-shop.myshopify.com" });
    const response = await callAction(body, sign(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
  });

  it("test-mode shop → 200 empty even with matching rules", async function () {
    await seedCarrierRule(await shopIdFor(TESTMODE_DOMAIN), FLAT_ACTION);
    const body = callbackBody({ domain: TESTMODE_DOMAIN });
    const response = await callAction(body, sign(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rates: [] });
  });

  it("rule whose zone is disabled fails closed → 200 empty (never 'applies everywhere')", async function () {
    const shopId = await shopIdFor(LIVE_DOMAIN);
    const zone = await prisma.zone.create({
      data: {
        shopId,
        name: "Disabled west",
        countries: '["US"]',
        provinces: '["CA"]',
        postalRules: "[]",
        enabled: false,
      },
    });
    await seedCarrierRule(shopId, FLAT_ACTION, { zoneId: zone.id });
    const body = callbackBody();
    const response = await callAction(body, sign(body));
    expect(await response.json()).toEqual({ rates: [] });
  });

  it("blown latency budget (guard sees >1200ms) → 200 empty, evaluation skipped", async function () {
    const shopId = await shopIdFor(LIVE_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION);
    const base = Date.now();
    let firstCall = true;
    const spy = vi.spyOn(Date, "now").mockImplementation(function shifted() {
      if (firstCall) {
        firstCall = false;
        return base; // startedAt
      }
      return base + 2000; // every later clock read — guard trips (> 1200ms)
    });
    try {
      const body = callbackBody();
      const response = await callAction(body, sign(body));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ rates: [] });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("007 carrier callback — evaluation modes", function () {
  it("FIRST_MATCH returns only the first matching rule's rate", async function () {
    const shopId = await shopIdFor(LIVE_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION, { priority: 1 });
    await seedCarrierRule(shopId, { ...FLAT_ACTION, serviceName: "Second" }, { priority: 2 });
    const body = callbackBody();
    const response = await callAction(body, sign(body));
    const payload = (await response.json()) as { rates: unknown[] };
    expect(payload.rates).toHaveLength(1);
  });

  it("ALL_MATCH shop returns every matching rule's rate", async function () {
    const shopId = await shopIdFor(ALLMATCH_DOMAIN);
    await seedCarrierRule(shopId, FLAT_ACTION, { priority: 1 });
    await seedCarrierRule(shopId, { ...FLAT_ACTION, serviceName: "Second" }, { priority: 2 });
    const body = callbackBody({ domain: ALLMATCH_DOMAIN });
    const response = await callAction(body, sign(body));
    const payload = (await response.json()) as { rates: unknown[] };
    expect(payload.rates).toHaveLength(2);
  });
});
