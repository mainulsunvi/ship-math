/**
 * Shop prefs + plan details persistence tests (spec 003, plan Tasks 2–3,
 * architecture.md §A5): updatePrefs JSON-merge semantics, saveShopPlanDetails
 * upsert idempotency (webhook retry safety), and ensureShopPlanDetails
 * first-run population against the fixture DB.
 *
 * There is no existing pattern in this repo for stubbing
 * `authenticate.webhook` inside a vitest run (searched app/lib/__tests__ and
 * app/routes — webhook handlers are only exercised manually), so the
 * shop-update route itself is covered indirectly: the handler is a one-line
 * delegation to saveShopPlanDetails, whose retry/idempotency contract is
 * pinned here, and ensureShopPlanDetails is tested against a fake admin
 * GraphQL client.
 */

import { beforeEach, describe, expect, it } from "vitest";
import prisma, { saveShopPlanDetails, updatePrefs } from "../../db.server";
import { ensureShopPlanDetails, type AdminApiClient } from "../../services/shop-details";

const DOMAIN = "prefs-fixture.myshopify.com";

async function createShop(data: { plan?: string | null; name?: string | null } = {}): Promise<string> {
  const shop = await prisma.shop.create({
    data: { shopDomain: DOMAIN, name: data.name ?? null, plan: data.plan ?? null },
  });
  return shop.id;
}

function fakeAdmin(response: unknown, queries: string[]): AdminApiClient {
  return {
    graphql(query: string) {
      queries.push(query);
      return Promise.resolve({ json() { return Promise.resolve(response); } });
    },
  } as unknown as AdminApiClient;
}

function fakeFailingAdmin(error: Error, queries: string[]): AdminApiClient {
  return {
    graphql(query: string) {
      queries.push(query);
      return Promise.reject(error);
    },
  } as unknown as AdminApiClient;
}

beforeEach(async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.aiUsageDay.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
});

describe("updatePrefs (§A5 JSON merge on Shop.prefs)", function () {
  it("turns a null prefs column into the patch object", async function () {
    const shopId = await createShop();
    expect(await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).toMatchObject({ prefs: null });

    const result = await updatePrefs(shopId, { planBannerDismissedFor: "CCS_ELIGIBLE" });
    expect(result).toEqual({ planBannerDismissedFor: "CCS_ELIGIBLE" });

    const stored = JSON.parse(
      (await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).prefs ?? "null",
    );
    expect(stored).toEqual({ planBannerDismissedFor: "CCS_ELIGIBLE" });
  });

  it("merges successive patches while preserving sibling keys", async function () {
    const shopId = await createShop();
    await updatePrefs(shopId, { dismissedHints: ["rates"] });
    await updatePrefs(shopId, { planBannerDismissedFor: "FUNCTIONS_ONLY" });

    const stored = JSON.parse(
      (await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).prefs ?? "{}",
    );
    expect(stored).toEqual({ dismissedHints: ["rates"], planBannerDismissedFor: "FUNCTIONS_ONLY" });
  });

  it("shallow-merges: a later array patch replaces the whole array", async function () {
    const shopId = await createShop();
    await updatePrefs(shopId, { dismissedHints: ["rates", "zones"] });
    await updatePrefs(shopId, { dismissedHints: ["zones"] });

    const stored = JSON.parse(
      (await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).prefs ?? "{}",
    );
    expect(stored.dismissedHints).toEqual(["zones"]);
  });

  it("a null patch value clears the key (dismissal reset → banner reappears)", async function () {
    const shopId = await createShop();
    await updatePrefs(shopId, { planBannerDismissedFor: "FUNCTIONS_ONLY" });
    const cleared = await updatePrefs(shopId, { planBannerDismissedFor: null });

    expect(cleared.planBannerDismissedFor).toBeNull();
    const stored = JSON.parse(
      (await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).prefs ?? "{}",
    );
    // plan.ts shouldShowPlanBanner treats null as "not dismissed".
    expect(stored.planBannerDismissedFor).toBeNull();
  });

  it("treats corrupt prefs JSON as an empty object instead of throwing", async function () {
    const shopId = await createShop();
    await prisma.shop.update({ where: { id: shopId }, data: { prefs: "not-json{{" } });

    const result = await updatePrefs(shopId, { checklistDismissedAt: "2026-09-09" });
    expect(result).toEqual({ checklistDismissedAt: "2026-09-09" });
  });

  it("preserves unknown forward-compatible keys (spec 010 additions)", async function () {
    const shopId = await createShop();
    await prisma.shop.update({
      where: { id: shopId },
      data: { prefs: JSON.stringify({ futureFlag: true, dismissedHints: ["x"] }) },
    });

    const result = await updatePrefs(shopId, { planBannerDismissedFor: "ALL" });
    expect(result).toEqual({
      futureFlag: true,
      dismissedHints: ["x"],
      planBannerDismissedFor: "ALL",
    });
  });
});

describe("saveShopPlanDetails (shop/update webhook upsert)", function () {
  it("creates the Shop row when the webhook arrives before any page load", async function () {
    await saveShopPlanDetails(DOMAIN, { name: "My Shop", plan: "Basic", isDevShop: false });

    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.name).toBe("My Shop");
    expect(row.plan).toBe("Basic");
    expect(row.isDevShop).toBe(false);
    expect(await prisma.shop.count({ where: { shopDomain: DOMAIN } })).toBe(1);
  });

  it("two identical webhook deliveries leave exactly one unchanged row", async function () {
    await saveShopPlanDetails(DOMAIN, { name: "My Shop", plan: "Advanced" });
    const first = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });

    await saveShopPlanDetails(DOMAIN, { name: "My Shop", plan: "Advanced" });

    const rows = await prisma.shop.findMany({ where: { shopDomain: DOMAIN } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
    expect(rows[0]!.name).toBe("My Shop");
    expect(rows[0]!.plan).toBe("Advanced");
  });

  it("updates fields on an existing row without touching unrelated columns", async function () {
    const shopId = await createShop({ plan: null });
    await prisma.shop.update({
      where: { id: shopId },
      data: { testMode: true, functionOwnerId: "gid://shopify/DeliveryCustomization/1" },
    });

    await saveShopPlanDetails(DOMAIN, { plan: "Grow" });

    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.plan).toBe("Grow");
    // Omitted fields untouched.
    expect(row.name).toBeNull();
    expect(row.testMode).toBe(true);
    expect(row.functionOwnerId).toBe("gid://shopify/DeliveryCustomization/1");
  });

  it("an empty plan_display_name is stored as null (webhook normalization contract)", async function () {
    await saveShopPlanDetails(DOMAIN, { name: "Shop", plan: null, isDevShop: false });
    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.plan).toBeNull();
    expect(row.name).toBe("Shop");
  });
});

describe("ensureShopPlanDetails (first-run population, never throws)", function () {
  it("does not call Shopify when plan and name are already stored", async function () {
    const shopId = await createShop({ name: "Stored", plan: "Advanced" });
    const queries: string[] = [];
    const admin = fakeAdmin({ data: { shop: null } }, queries);

    const result = await ensureShopPlanDetails(admin, DOMAIN);

    expect(result).toEqual({ planClass: "CCS_ELIGIBLE", fetched: false });
    expect(queries).toHaveLength(0);
    // Row untouched.
    const row = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(row.plan).toBe("Advanced");
  });

  it("fetches once, persists details, and classifies a Basic plan", async function () {
    await createShop();
    const queries: string[] = [];
    const admin = fakeAdmin(
      {
        data: {
          shop: {
            name: "Fresh Shop",
            plan: { displayName: "Basic", partnerDevelopment: false, shopifyPlus: false },
          },
        },
      },
      queries,
    );

    const result = await ensureShopPlanDetails(admin, DOMAIN);

    expect(result).toEqual({ planClass: "FUNCTIONS_ONLY", fetched: true });
    expect(queries).toHaveLength(1);
    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.name).toBe("Fresh Shop");
    expect(row.plan).toBe("Basic");
    expect(row.isDevShop).toBe(false);
  });

  it("persists partnerDevelopment and classifies dev stores as ALL", async function () {
    await createShop();
    const admin = fakeAdmin(
      {
        data: {
          shop: {
            name: "Dev Shop",
            plan: { displayName: "Basic", partnerDevelopment: true, shopifyPlus: false },
          },
        },
      },
      [],
    );

    const result = await ensureShopPlanDetails(admin, DOMAIN);

    expect(result).toEqual({ planClass: "ALL", fetched: true });
    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.isDevShop).toBe(true);
    expect(row.plan).toBe("Basic");
  });

  it("only writes on the first run — a second call spends no API call", async function () {
    await createShop();
    const queries: string[] = [];
    const admin = fakeAdmin(
      {
        data: {
          shop: {
            name: "Fresh Shop",
            plan: { displayName: "Basic", partnerDevelopment: false, shopifyPlus: false },
          },
        },
      },
      queries,
    );

    await ensureShopPlanDetails(admin, DOMAIN);
    const second = await ensureShopPlanDetails(admin, DOMAIN);

    expect(queries).toHaveLength(1);
    expect(second).toEqual({ planClass: "FUNCTIONS_ONLY", fetched: false });
  });

  it("returns the error and the stored-row class when GraphQL fails (never throws)", async function () {
    await createShop({ name: null, plan: "Advanced" });
    const admin = fakeFailingAdmin(new Error("network down"), []);

    // Awaiting directly proves the promise never rejects into a loader.
    const result = await ensureShopPlanDetails(admin, DOMAIN);
    expect(result).toEqual({ planClass: "CCS_ELIGIBLE", fetched: false, error: "network down" });

    // Nothing was written.
    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.name).toBeNull();
    expect(row.plan).toBe("Advanced");
  });

  it("reports GraphQL-level errors when the payload has no shop data", async function () {
    await createShop();
    const admin = fakeAdmin(
      { data: null, errors: [{ message: "access denied" }] },
      [],
    );

    const result = await ensureShopPlanDetails(admin, DOMAIN);

    expect(result.fetched).toBe(false);
    expect(result.error).toContain("access denied");
    expect(result.planClass).toBe("CCS_ELIGIBLE"); // unknown → permissive default (plan.ts)
    const row = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(row.plan).toBeNull();
  });
});
