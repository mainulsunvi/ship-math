/**
 * Prune + digest helpers (spec 008 Task 4): 30-day retention sweeps only old
 * rows for the given shop; the 1-in-20 gate is deterministic under a mocked
 * random source (spec 008 criterion 6).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../../db.server";
import { inputDigestFor, pruneIfDue, pruneRequestLogs } from "../prune-logs";

const DOMAIN = "prune.myshopify.com";

beforeEach(async function resetDatabase() {
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
  await prisma.shop.create({ data: { shopDomain: DOMAIN, testMode: false } });
});

async function shopId(): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
  return shop.id;
}

async function insertLog(shopId: string, ageDays: number) {
  return prisma.requestLog.create({
    data: {
      shopId,
      source: "SIMULATION",
      inputDigest: "seed",
      matched: "[]",
      ...(ageDays > 0
        ? { createdAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000) }
        : {}),
    },
  });
}

describe("008 pruneRequestLogs", function () {
  it("deletes rows older than 30 days for the shop and keeps everything else", async function () {
    const id = await shopId();
    const old31 = await insertLog(id, 31);
    const old45 = await insertLog(id, 45);
    const fresh = await insertLog(id, 0);
    const otherShop = await prisma.shop.create({
      data: { shopDomain: "prune-other.myshopify.com", testMode: false },
    });
    const otherOld = await insertLog(otherShop.id, 60);

    const deleted = await pruneRequestLogs(id);

    expect(deleted).toBe(2);
    const remaining = await prisma.requestLog.findMany({ where: { shopId: id } });
    expect(remaining.map(function ids(row) {
      return row.id;
    })).toEqual([fresh.id]);
    // Other shops are untouched (per-shop sweep).
    expect(await prisma.requestLog.findUnique({ where: { id: otherOld.id } })).not.toBeNull();
    expect(old31).toBeDefined();
    expect(old45).toBeDefined();
  });

  it("is idempotent — a second sweep deletes nothing", async function () {
    const id = await shopId();
    await insertLog(id, 40);
    await pruneRequestLogs(id);
    expect(await pruneRequestLogs(id)).toBe(0);
  });
});

describe("008 pruneIfDue — the 1-in-20 cadence gate", function () {
  it("fires only below the 0.05 threshold", function () {
    const spy = vi.spyOn(Math, "random");
    spy.mockReturnValue(0.049);
    expect(pruneIfDue()).toBe(true);
    spy.mockReturnValue(0.05);
    expect(pruneIfDue()).toBe(false);
    spy.mockReturnValue(0.9);
    expect(pruneIfDue()).toBe(false);
    spy.mockRestore();
  });
});

describe("008 inputDigestFor", function () {
  it("is stable and bounded", function () {
    const input = { destination: { country: "US" }, subtotal: "30.00" };
    expect(inputDigestFor(input)).toBe(inputDigestFor({ destination: { country: "US" }, subtotal: "30.00" }));
    expect(inputDigestFor(input)).toHaveLength(32);
    expect(inputDigestFor(input)).not.toBe(inputDigestFor({ different: true }));
  });
});
