/**
 * Standard scenarios the tester suite must always answer (uninstall →
 * reinstall cascade + fresh state) exercised against the fixture DB.
 *
 * "Uninstall" deletes the Shop row (the app-uninstalled webhook does exactly
 * this, spec 002); "reinstall by the same shop" is getOrCreateShop on the
 * same shopDomain — it must produce a FRESH row with default settings and no
 * leftover config children (zones/rules/audit cascade-deleted with the shop).
 */

import { beforeEach, describe, expect, it } from "vitest";
import prisma, { getOrCreateShop } from "../../../db.server";

const DOMAIN = "reinstall-fixture.myshopify.com";

async function seedShopWithChildren(): Promise<string> {
  const shop = await prisma.shop.create({ data: { shopDomain: DOMAIN } });
  const zone = await prisma.zone.create({
    data: {
      shopId: shop.id,
      name: "California metro",
      countries: '["US"]',
      provinces: '["CA"]',
      postalRules: '[{"id":"p1","mode":"PREFIX","value":"94"}]',
    },
  });
  await prisma.shippingRule.create({
    data: {
      shopId: shop.id,
      name: "Hide pickup",
      kind: "HIDE",
      priority: 10,
      zoneId: zone.id,
      conditions: '{"combinator":"AND","conditions":[]}',
      action: '{"target":{"method":"PICK_UP"}}',
    },
  });
  await prisma.auditLog.create({
    data: { shopId: shop.id, actor: "MERCHANT", summary: "Seeded", changeSet: "{}" },
  });
  return shop.id;
}

beforeEach(async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.aiUsageDay.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
});

describe("uninstall → reinstall (spec 004/005 standard scenarios)", function () {
  it("deleting the shop cascades zones, rules, and audit logs", async function () {
    const shopId = await seedShopWithChildren();
    await prisma.shop.delete({ where: { id: shopId } });

    expect(await prisma.shop.count({ where: { id: shopId } })).toBe(0);
    expect(await prisma.zone.count({ where: { shopId } })).toBe(0);
    expect(await prisma.shippingRule.count({ where: { shopId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { shopId } })).toBe(0);
  });

  it("reinstalling the same domain starts from FRESH default state", async function () {
    const oldShopId = await seedShopWithChildren();
    await prisma.shop.delete({ where: { id: oldShopId } });

    const reinstalled = await getOrCreateShop(DOMAIN);
    expect(reinstalled.id).not.toBe(oldShopId);
    // Fresh defaults (002 schema): evaluationMode FIRST_MATCH, testMode on,
    // no owner, never synced.
    expect(reinstalled.evaluationMode).toBe("FIRST_MATCH");
    expect(reinstalled.testMode).toBe(true);
    expect(reinstalled.functionOwnerId).toBeNull();
    expect(reinstalled.functionSyncedAt).toBeNull();

    // No leftover config children from the previous install.
    expect(await prisma.zone.count({ where: { shopId: reinstalled.id } })).toBe(0);
    expect(await prisma.shippingRule.count({ where: { shopId: reinstalled.id } })).toBe(0);

    // Second call is idempotent — same row.
    await expect(getOrCreateShop(DOMAIN)).resolves.toMatchObject({ id: reinstalled.id });
  });
});
