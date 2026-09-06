import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../../db.server";
import type { RuleInput } from "../../config-schema";
import {
  createRule,
  deleteRule,
  duplicateRule,
  listRules,
  listZones,
  setEvaluationMode,
  setRuleEnabled,
  swapPriority,
  updateRule,
} from "../rules";

import type { ShippingRule } from "@prisma/client";

function baseRuleInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    name: "Rule",
    kind: "HIDE",
    priority: 1,
    stopOnMatch: false,
    conditions: { combinator: "AND", conditions: [] },
    action: { target: { method: "SHIPPING" } },
    ...overrides,
  };
}

async function createTestShop(): Promise<string> {
  const shop = await prisma.shop.create({
    data: { shopDomain: `rules-test-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  return shop.id;
}

async function rawRule(
  shopId: string,
  overrides: { name: string; priority: number; createdAt?: Date },
): Promise<ShippingRule> {
  return prisma.shippingRule.create({
    data: {
      shopId,
      name: overrides.name,
      kind: "HIDE",
      priority: overrides.priority,
      conditions: "{}",
      action: "{}",
      createdAt: overrides.createdAt,
    },
  });
}

async function rawZone(shopId: string, name: string, createdAt?: Date) {
  return prisma.zone.create({
    data: {
      shopId,
      name,
      countries: "[\"US\"]",
      provinces: "[\"*\"]",
      postalRules: "[]",
      createdAt,
    },
  });
}

beforeEach(async function resetDatabase() {
  // Children first, then parents (FK-safe). Never touches prisma/dev.sqlite —
  // Prisma is redirected to the fixture file via SHIPMATH_TEST_DATABASE_URL.
  await prisma.auditLog.deleteMany();
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.aiUsageDay.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
});

describe("listRules", function () {
  it("paginates at 50 and orders by priority asc", async function () {
    const shopId = await createTestShop();
    for (let index = 1; index <= 55; index += 1) {
      await createRule(shopId, baseRuleInput({ name: `R${index}`, priority: index }));
    }
    const page1 = await listRules(shopId);
    expect(page1.total).toBe(55);
    expect(page1.rules).toHaveLength(50);
    expect(page1.rules[0]?.name).toBe("R1");
    expect(page1.rules[49]?.name).toBe("R50");

    const page2 = await listRules(shopId, 2);
    expect(page2.rules).toHaveLength(5);
    expect(page2.rules[0]?.name).toBe("R51");
  });

  it("breaks priority ties by createdAt asc", async function () {
    const shopId = await createTestShop();
    const t1 = new Date("2026-01-01T00:00:00.000Z");
    const t2 = new Date("2026-01-01T00:00:01.000Z");
    const t3 = new Date("2026-01-01T00:00:02.000Z");
    await prisma.shippingRule.createMany({
      data: [
        { shopId, name: "late", kind: "HIDE", priority: 1, conditions: "{}", action: "{}", createdAt: t3 },
        { shopId, name: "early", kind: "HIDE", priority: 1, conditions: "{}", action: "{}", createdAt: t1 },
        { shopId, name: "middle", kind: "HIDE", priority: 1, conditions: "{}", action: "{}", createdAt: t2 },
      ],
    });
    const { rules, total } = await listRules(shopId);
    expect(total).toBe(3);
    expect(rules.map((rule) => rule.name)).toEqual(["early", "middle", "late"]);
  });
});

describe("createRule / updateRule / deleteRule", function () {
  it("persists JSON columns and validates StoredRuleSchema", async function () {
    const shopId = await createTestShop();
    const carrierRule = await createRule(
      shopId,
      baseRuleInput({
        name: "Rates",
        kind: "CARRIER_RATE",
        action: { mode: "flat", amount: "9.99", serviceName: "ShipMath Rate", serviceCode: "shipmath" },
      }),
    );
    expect(carrierRule.kind).toBe("CARRIER_RATE");
    expect(JSON.parse(carrierRule.action)).toEqual({
      mode: "flat",
      amount: "9.99",
      serviceName: "ShipMath Rate",
      serviceCode: "shipmath",
    });
    expect(JSON.parse(carrierRule.conditions)).toEqual({ combinator: "AND", conditions: [] });
  });

  it("persists a nested AND/OR condition tree verbatim (005 criterion 1)", async function () {
    const shopId = await createTestShop();
    const nested: RuleInput["conditions"] = {
      combinator: "AND",
      conditions: [
        { field: "subtotal", operator: "gte", value: 50 },
        {
          combinator: "OR",
          conditions: [
            { field: "product_tag", operator: "in", value: ["heavy", "fragile"] },
            {
              combinator: "AND",
              conditions: [
                { field: "vendor", operator: "eq", value: "Acme" },
                { field: "logged_in", operator: "eq", value: true },
              ],
            },
          ],
        },
      ],
    };
    const rule = await createRule(shopId, baseRuleInput({ name: "Nested", priority: 3, conditions: nested }));
    const stored = await prisma.shippingRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(JSON.parse(stored.conditions)).toEqual(nested);

    // Appears in the list at the chosen priority position (only rule → first).
    const { rules } = await listRules(shopId);
    expect(rules[0]?.name).toBe("Nested");
    expect(rules[0]?.priority).toBe(3);

    // Update round-trips the tree too.
    const nestedUpdated: RuleInput["conditions"] = {
      combinator: "OR",
      conditions: [{ field: "quantity", operator: "gt", value: 4 }, nested],
    };
    const updated = await updateRule(shopId, rule.id, baseRuleInput({ conditions: nestedUpdated }));
    expect(JSON.parse(updated.conditions)).toEqual(nestedUpdated);
  });

  it("rejects CARRIER_RATE + product_tag conditions", async function () {
    const shopId = await createTestShop();
    await expect(
      createRule(
        shopId,
        baseRuleInput({
          kind: "CARRIER_RATE",
          action: { mode: "free", serviceName: "Free", serviceCode: "free" },
          conditions: {
            combinator: "AND",
            conditions: [{ field: "product_tag", operator: "in", value: ["heavy"] }],
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a zoneId from another shop", async function () {
    const shopId = await createTestShop();
    const otherShopId = await createTestShop();
    const foreignZone = await rawZone(otherShopId, "Foreign");
    await expect(createRule(shopId, baseRuleInput({ zoneId: foreignZone.id }))).rejects.toThrow();
  });

  it("updates fields and clears the zone with zoneId null", async function () {
    const shopId = await createTestShop();
    const zone = await rawZone(shopId, "Domestic");
    const rule = await createRule(shopId, baseRuleInput({ name: "Before", priority: 2 }));

    const updated = await updateRule(
      shopId,
      rule.id,
      baseRuleInput({ name: "After", priority: 7, stopOnMatch: true, zoneId: zone.id }),
    );
    expect(updated.name).toBe("After");
    expect(updated.priority).toBe(7);
    expect(updated.stopOnMatch).toBe(true);
    expect(updated.zoneId).toBe(zone.id);

    const cleared = await updateRule(shopId, rule.id, baseRuleInput({ zoneId: null }));
    expect(cleared.zoneId).toBeNull();
  });

  it("refuses to update another shop's rule", async function () {
    const shopId = await createTestShop();
    const otherShopId = await createTestShop();
    const rule = await createRule(shopId, baseRuleInput());
    await expect(updateRule(otherShopId, rule.id, baseRuleInput())).rejects.toThrow();
  });

  it("deletes only the shop's own rule and is idempotent", async function () {
    const shopId = await createTestShop();
    const otherShopId = await createTestShop();
    const rule = await createRule(shopId, baseRuleInput());

    await deleteRule(otherShopId, rule.id); // foreign → no-op
    expect(await prisma.shippingRule.count({ where: { shopId } })).toBe(1);

    await deleteRule(shopId, rule.id);
    expect(await prisma.shippingRule.count({ where: { shopId } })).toBe(0);
    await expect(deleteRule(shopId, rule.id)).resolves.toBeUndefined(); // already gone
  });

  it("benefits from the zone SetNull cascade on rules.zoneId", async function () {
    const shopId = await createTestShop();
    const zone = await rawZone(shopId, "Domestic");
    const rule = await createRule(shopId, baseRuleInput({ zoneId: zone.id }));
    await prisma.zone.delete({ where: { id: zone.id } });
    const after = await prisma.shippingRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.zoneId).toBeNull();
  });
});

describe("duplicateRule", function () {
  it("inserts '(copy)' disabled directly after the source, shifting later rules", async function () {
    const shopId = await createTestShop();
    const a = await createRule(shopId, baseRuleInput({ name: "A", priority: 1 }));
    await createRule(shopId, baseRuleInput({ name: "B", priority: 2 }));
    await createRule(shopId, baseRuleInput({ name: "C", priority: 3 }));

    const copy = await duplicateRule(shopId, a.id);
    expect(copy.name).toBe("A (copy)");
    expect(copy.enabled).toBe(false);
    expect(copy.priority).toBe(2);

    const { rules } = await listRules(shopId);
    expect(rules.map((rule) => `${rule.name}:${rule.priority}`)).toEqual([
      "A:1",
      "A (copy):2",
      "B:3",
      "C:4",
    ]);
  });

  it("uses a free priority gap without shifting anything", async function () {
    const shopId = await createTestShop();
    const a = await createRule(shopId, baseRuleInput({ name: "A", priority: 10 }));
    await createRule(shopId, baseRuleInput({ name: "B", priority: 20 }));

    const copy = await duplicateRule(shopId, a.id);
    expect(copy.priority).toBe(11);
    const { rules } = await listRules(shopId);
    expect(rules.map((rule) => rule.priority)).toEqual([10, 11, 20]);
  });
});

describe("swapPriority", function () {
  it("exchanges priorities across bands", async function () {
    const shopId = await createTestShop();
    const a = await createRule(shopId, baseRuleInput({ name: "A", priority: 1 }));
    await createRule(shopId, baseRuleInput({ name: "B", priority: 2 }));

    await swapPriority(shopId, a.id, "down");
    const { rules } = await listRules(shopId);
    expect(rules.map((rule) => rule.name)).toEqual(["B", "A"]);
    const byName = new Map(rules.map((rule) => [rule.name, rule]));
    expect(byName.get("A")?.priority).toBe(2);
    expect(byName.get("B")?.priority).toBe(1);
  });

  it("breaks priority ties by nudging createdAt (tie rule)", async function () {
    const shopId = await createTestShop();
    const base = new Date("2026-01-01T00:00:00.000Z");
    await rawRule(shopId, { name: "first", priority: 5, createdAt: base });
    const second = await rawRule(shopId, {
      name: "second",
      priority: 5,
      createdAt: new Date(base.getTime() + 5000),
    });

    await swapPriority(shopId, second.id, "up");
    const { rules } = await listRules(shopId);
    expect(rules.map((rule) => rule.name)).toEqual(["second", "first"]);
    const byName = new Map(rules.map((rule) => [rule.name, rule]));
    expect(byName.get("second")?.priority).toBe(5); // priorities untouched
    expect(byName.get("first")?.priority).toBe(5);
    expect(byName.get("second")?.createdAt.getTime()).toBe(base.getTime() - 1);

    // Moving back down restores the original order.
    await swapPriority(shopId, second.id, "down");
    const restored = await listRules(shopId);
    expect(restored.rules.map((rule) => rule.name)).toEqual(["first", "second"]);
  });

  it("is a no-op at the edges", async function () {
    const shopId = await createTestShop();
    const only = await createRule(shopId, baseRuleInput({ name: "Only", priority: 1 }));
    await expect(swapPriority(shopId, only.id, "up")).resolves.toBeUndefined();
    await expect(swapPriority(shopId, only.id, "down")).resolves.toBeUndefined();
    const { rules } = await listRules(shopId);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe("Only");
  });
});

describe("setRuleEnabled", function () {
  it("toggles a rule", async function () {
    const shopId = await createTestShop();
    const rule = await createRule(shopId, baseRuleInput());
    await setRuleEnabled(shopId, rule.id, false);
    expect((await prisma.shippingRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled).toBe(false);
    await setRuleEnabled(shopId, rule.id, true);
    expect((await prisma.shippingRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled).toBe(true);
  });
});

describe("setEvaluationMode", function () {
  it("round-trips on Shop.evaluationMode", async function () {
    const shopId = await createTestShop();
    await setEvaluationMode(shopId, "ALL_MATCH");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).evaluationMode).toBe("ALL_MATCH");
    await setEvaluationMode(shopId, "FIRST_MATCH");
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).evaluationMode).toBe("FIRST_MATCH");
  });
});

describe("listZones", function () {
  it("returns only the shop's zones, newest first", async function () {
    const shopId = await createTestShop();
    const otherShopId = await createTestShop();
    await rawZone(shopId, "Old", new Date("2026-01-01T00:00:00.000Z"));
    await rawZone(shopId, "New", new Date("2026-01-02T00:00:00.000Z"));
    await rawZone(otherShopId, "Foreign");

    const zones = await listZones(shopId);
    expect(zones.map((zone) => zone.name)).toEqual(["New", "Old"]);
  });
});
