/**
 * AuditLog writer tests (spec 005 criterion 9 — "the audit log records the
 * change set") plus the fail-open contract from architecture.md §A1 step 4.
 *
 * Route actions own the orchestration (repository → owner → mirror → audit);
 * these tests pin the audit writer itself against the fixture DB.
 */

import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../db.server";
import { writeAudit } from "../audit";

async function createTestShop(): Promise<string> {
  const shop = await prisma.shop.create({
    data: { shopDomain: `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}` },
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

describe("writeAudit", function () {
  it("persists before/after change sets as JSON", async function () {
    const shopId = await createTestShop();
    await writeAudit(shopId, "MERCHANT", 'Deleted rule "Big carts"', { id: "r1", enabled: true }, null);

    const rows = await prisma.auditLog.findMany({ where: { shopId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("MERCHANT");
    expect(rows[0]?.summary).toBe('Deleted rule "Big carts"');
    expect(JSON.parse(rows[0]!.changeSet)).toEqual({ before: { id: "r1", enabled: true }, after: null });
  });

  it("round-trips a full before/after mutation snapshot", async function () {
    const shopId = await createTestShop();
    const before = { id: "r1", name: "Old", priority: 1 };
    const after = { id: "r1", name: "New", priority: 7 };
    await writeAudit(shopId, "MERCHANT", 'Updated rule "New"', before, after);

    const row = await prisma.auditLog.findFirstOrThrow({ where: { shopId } });
    expect(JSON.parse(row.changeSet)).toEqual({ before, after });
  });

  it("normalizes missing snapshots to null (never 'undefined' strings)", async function () {
    const shopId = await createTestShop();
    await writeAudit(shopId, "SYSTEM", "Mirror re-synced");
    const row = await prisma.auditLog.findFirstOrThrow({ where: { shopId } });
    expect(JSON.parse(row.changeSet)).toEqual({ before: null, after: null });
  });

  it("is FAIL-OPEN: a database failure never throws (mutation already committed)", async function () {
    await expect(writeAudit("nonexistent-shop-id", "MERCHANT", "boom", null, null)).resolves.toBeUndefined();
    expect(await prisma.auditLog.count({ where: { shopId: "nonexistent-shop-id" } })).toBe(0);
  });
});
