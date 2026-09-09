/**
 * shop/update webhook handler tests (spec 003 §5, plan Task 2 + acceptance
 * criterion 8 write path): payload → Shop row upsert, and Shopify
 * redeliveries (partial-delivery retry) write identical values with no
 * duplicate rows.
 *
 * db-prefs.test.ts covers saveShopPlanDetails (the underlying upsert) but
 * punted on the route itself for lack of an authenticate.webhook stub
 * pattern; the wholesale shopify.server vi.mock used by sync.test.ts works
 * here identically, so the handler is now pinned directly. The REAL fixture
 * DB backs every write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { action } from "../../routes/webhooks.app.shop-update";

const webhookMock = vi.hoisted(function createWebhookMock() {
  return vi.fn();
});

vi.mock("../../shopify.server", function mockShopifyServer() {
  return { authenticate: { webhook: webhookMock } };
});

const DOMAIN = "shop-update-fixture.myshopify.com";

function deliver(body: { name?: unknown; plan_display_name?: unknown }): Promise<Response> {
  webhookMock.mockResolvedValue({
    payload: body,
    topic: "shop/update",
    shop: DOMAIN,
  });
  const request = new Request("https://shipmath.test/webhooks/app/shop-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}", // raw body is HMAC-verified upstream; the mock supplies payload
  });
  return action({ request, params: {}, context: {} } as unknown as ActionFunctionArgs) as Promise<Response>;
}

beforeEach(async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.aiUsageDay.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
  vi.clearAllMocks();
});

describe("003 — shop/update webhook handler", function () {
  it("updates an existing Shop row with the delivered name + plan and answers 200", async function () {
    await prisma.shop.create({ data: { shopDomain: DOMAIN, name: null, plan: null } });

    const response = await deliver({ name: "Wizard Shop", plan_display_name: "Basic" });

    expect(response.status).toBe(200);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(shop.name).toBe("Wizard Shop");
    expect(shop.plan).toBe("Basic");
  });

  it("creates the row when the webhook arrives before any page load (upsert-create path)", async function () {
    const response = await deliver({ name: "Early Shop", plan_display_name: "Advanced Shopify" });

    expect(response.status).toBe(200);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(shop.name).toBe("Early Shop");
    expect(shop.plan).toBe("Advanced Shopify");
  });

  it("duplicate delivery (retry after partial failure) is idempotent: one row, same values", async function () {
    await deliver({ name: "Wizard Shop", plan_display_name: "Basic" });
    await deliver({ name: "Wizard Shop", plan_display_name: "Basic" }); // Shopify redelivery

    expect(await prisma.shop.count({ where: { shopDomain: DOMAIN } })).toBe(1);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(shop.name).toBe("Wizard Shop");
    expect(shop.plan).toBe("Basic");
  });

  it("an empty plan_display_name stores null — a downgrade clears the cached plan for re-classification", async function () {
    await prisma.shop.create({ data: { shopDomain: DOMAIN, name: "Old", plan: "Advanced Shopify" } });

    const response = await deliver({ name: "Wizard Shop", plan_display_name: "" });

    expect(response.status).toBe(200);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(shop.name).toBe("Wizard Shop");
    expect(shop.plan).toBeNull(); // missing and unknown share one representation (plan.ts defaults)
  });
});
