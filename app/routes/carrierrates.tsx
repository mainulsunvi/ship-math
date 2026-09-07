/**
 * Carrier Service callback (spec 007, architecture §A3) — PUBLIC resource
 * route. No `authenticate.admin`, no UI: Shopify's Carrier Service API calls
 * this endpoint synchronously during checkout rate calculation.
 *
 * Hard rules (§A3):
 *  - ALWAYS respond HTTP 200 — never 4xx/5xx (Shopify retry storms). Every
 *    failure path answers `{rates: []}` so the checkout falls back to stock
 *    rates; we never invent charges and never block checkout.
 *  - Auth = HMAC over the raw body (verify.ts) AND `rate.origin_shop_domain`
 *    matching an installed, non-test-mode Shop.
 *  - Latency budget: hard internal deadline 1500ms; if >1200ms have elapsed
 *    by the time data is loaded, skip evaluation and answer empty.
 *  - Every live call logs one RequestLog row, fire-and-forget with errors
 *    swallowed (logging must never break the response); every 20th insert
 *    triggers a 30-day prune for that shop (spec 008).
 *  - Currency: rates are computed in the shop currency and labeled with it —
 *    no FX conversion (multi-currency deferred to 016/017).
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { CarrierRateActionSchema } from "../lib/carrier/action-schema";
import { computeRates, type CarrierRule, type CarrierCartContext } from "../lib/carrier/engine";
import { CARRIER_HMAC_HEADER, verifyCarrierCallback } from "../lib/carrier/verify";
import { parseStoredJson } from "../lib/config-schema";
import { buildWireZones, toWireConditionGroup } from "../lib/function-config";

/** Cents (integer) → decimal string: 1250 → "12.50", 5 → "0.05". Integer math only. */
function centsToDecimalString(cents: number): string {
  const whole = Math.trunc(Math.abs(cents)) / 100 | 0;
  const frac = Math.abs(Math.trunc(cents)) % 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

interface CarrierCallbackPayload {
  rate?: {
    origin_shop_domain?: string;
    currency?: string;
    destination?: {
      country?: string;
      province?: string;
      postal_code?: string;
    };
  };
  items?: Array<{
    name?: string;
    sku?: string;
    quantity?: number;
    grams?: number;
    price?: number; // cents
    vendor?: string;
  }>;
}

/** Non-negative integers summed exactly — payload mapping, not money math. */
function sumItems(payload: CarrierCallbackPayload): {
  subtotalCents: number;
  weightGrams: number;
  quantity: number;
  skus: string[];
  vendors: string[];
} {
  let subtotalCents = 0;
  let weightGrams = 0;
  let quantity = 0;
  const skus: string[] = [];
  const vendors: string[] = [];
  for (const item of payload.items ?? []) {
    const qty = Math.max(0, Math.trunc(item.quantity ?? 0));
    subtotalCents += Math.max(0, Math.trunc(item.price ?? 0)) * qty;
    weightGrams += Math.max(0, Math.trunc(item.grams ?? 0)) * qty;
    quantity += qty;
    if (typeof item.sku === "string" && item.sku !== "" && !skus.includes(item.sku)) {
      skus.push(item.sku);
    }
    if (typeof item.vendor === "string" && item.vendor !== "" && !vendors.includes(item.vendor)) {
      vendors.push(item.vendor);
    }
  }
  return { subtotalCents, weightGrams, quantity, skus, vendors };
}

function emptyRates() {
  return json({ rates: [] });
}

export async function loader({}: LoaderFunctionArgs) {
  // Anything that is not the signed POST (health checks, browsers) → empty 200.
  return emptyRates();
}

export async function action({ request }: ActionFunctionArgs) {
  const startedAt = Date.now();

  if (request.method !== "POST") {
    return emptyRates();
  }

  // 1. Raw body + HMAC gate. Fail → 200 empty (never 4xx).
  const rawBody = await request.text();
  if (!verifyCarrierCallback(rawBody, request.headers.get(CARRIER_HMAC_HEADER))) {
    return emptyRates();
  }

  // 2. Parse + domain gate: origin_shop_domain must be an installed shop.
  let payload: CarrierCallbackPayload;
  try {
    payload = JSON.parse(rawBody) as CarrierCallbackPayload;
  } catch {
    return emptyRates();
  }
  const originDomain = payload.rate?.origin_shop_domain;
  if (typeof originDomain !== "string" || originDomain === "") {
    return emptyRates();
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: originDomain },
    select: { id: true, testMode: true, evaluationMode: true },
  });
  if (!shop || shop.testMode) {
    return emptyRates();
  }

  // 3. Map the payload onto the engine's cart context.
  const { subtotalCents, weightGrams, quantity, skus, vendors } = sumItems(payload);
  const cart: CarrierCartContext = {
    destination: {
      country: payload.rate?.destination?.country ?? "",
      province: payload.rate?.destination?.province ?? null,
      postal: payload.rate?.destination?.postal_code ?? null,
    },
    currency: typeof payload.rate?.currency === "string" ? payload.rate.currency : "USD",
    subtotal: centsToDecimalString(subtotalCents),
    weightGrams,
    quantity,
    skus,
    vendors,
  };

  // 4. Load rules + zones; honor the internal latency budget (1200ms guard
  //    against the 1500ms hard deadline — leave response headroom).
  const rulesRaw = await prisma.shippingRule.findMany({
    where: { shopId: shop.id, enabled: true, kind: "CARRIER_RATE" },
    orderBy: { priority: "asc" },
  });
  const zoneRows = await prisma.zone.findMany({
    where: { shopId: shop.id, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (Date.now() - startedAt > 1200) {
    return emptyRates();
  }

  const referencedZoneIds = new Set(
    rulesRaw.map(function zoneId(rule) {
      return rule.zoneId;
    }).filter(function defined(id): id is string {
      return id !== null;
    }),
  );
  const { wireZones, idMap } = buildWireZones(zoneRows, referencedZoneIds);

  const rules: CarrierRule[] = [];
  const ruleNames = new Map<string, string>();
  for (const stored of rulesRaw) {
    ruleNames.set(stored.id, stored.name);
    let action;
    try {
      action = parseStoredJson(stored.action, CarrierRateActionSchema);
    } catch {
      continue; // malformed stored action → rule fails, never the response
    }
    if (stored.zoneId !== null && !idMap.has(stored.zoneId)) {
      continue; // zone disabled/missing → rule fails closed (never "applies everywhere")
    }
    rules.push({
      id: stored.id,
      priority: stored.priority,
      stopOnMatch: stored.stopOnMatch,
      zoneId: stored.zoneId === null ? null : idMap.get(stored.zoneId) ?? null,
      conditions: toWireConditionGroup(stored.conditions) ?? null,
      action,
    });
  }

  // 5. Evaluate (shop-wide evaluation mode — same semantics as the Function lane).
  const computed = computeRates(
    rules,
    wireZones,
    cart,
    shop.evaluationMode === "ALL_MATCH" ? "ALL_MATCH" : "FIRST_MATCH",
  );

  // 6. Fire-and-forget logging + ~1-in-20 prune. Never awaited, never throws.
  const latencyMs = Date.now() - startedAt;
  void logCallback(shop.id, cart, rules, ruleNames, computed, latencyMs).catch(function swallow() {
    // logging must never break the response (§A3)
  });

  // 7. Respond with cents STRINGS, labeled with the requested currency.
  // Amounts are shop-currency amounts; for single-currency MVP shops the
  // requested currency IS the shop currency. Multi-currency is deferred to
  // specs 016/017 — no FX conversion (§A3: label honestly, never invent).
  return json({
    rates: computed.map(function toResponse(rate) {
      return {
        service_name: rate.serviceName,
        service_code: rate.serviceCode,
        // Docs mark description REQUIRED — always send a string (may be empty).
        description: rate.description ?? "",
        currency: cart.currency,
        total_price: rate.priceCents,
      };
    }),
  });
}

async function logCallback(
  shopId: string,
  cart: CarrierCartContext,
  rules: CarrierRule[],
  ruleNames: Map<string, string>,
  rates: Array<{ serviceName: string; serviceCode: string; priceCents: string }>,
  latencyMs: number,
): Promise<void> {
  const input = {
    destination: cart.destination,
    subtotal: cart.subtotal,
    weightGrams: cart.weightGrams,
    quantity: cart.quantity,
    currency: cart.currency,
  };
  const inputDigest = inputDigestFor(input);
  const matched = rules.map(function row(rule, order) {
    return { ruleId: rule.id, ruleName: ruleNames.get(rule.id) ?? "", order };
  });
  await prisma.requestLog.create({
    data: {
      shopId,
      source: "CARRIER_CALLBACK",
      inputDigest,
      input: JSON.stringify(input),
      matched: JSON.stringify(matched),
      rates: JSON.stringify(rates),
      latencyMs,
    },
  });
  if (Math.random() < 0.05) {
    await pruneOldLogs(shopId);
  }
}

function inputDigestFor(input: unknown): string {
  // Stable digest of the normalized input (no crypto need — dedup/debug key).
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url").slice(0, 32);
}

async function pruneOldLogs(shopId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.requestLog.deleteMany({
    where: { shopId, createdAt: { lt: cutoff } },
  });
}
