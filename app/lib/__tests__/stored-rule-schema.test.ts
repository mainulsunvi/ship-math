import { describe, expect, it } from "vitest";
import { StoredRuleSchema, type RuleInput } from "../config-schema";

function baseRuleInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    name: "Test rule",
    kind: "HIDE",
    priority: 1,
    stopOnMatch: false,
    conditions: { combinator: "AND", conditions: [] },
    action: { target: { method: "SHIPPING" } },
    ...overrides,
  };
}

describe("StoredRuleSchema", function () {
  it("parses a valid function-lane rule", function () {
    const parsed = StoredRuleSchema.parse(baseRuleInput());
    expect(parsed.kind).toBe("HIDE");
    expect(parsed.conditions.combinator).toBe("AND");
  });

  it("accepts zoneId null and explicit values", function () {
    expect(StoredRuleSchema.parse(baseRuleInput({ zoneId: null })).zoneId).toBeNull();
    expect(StoredRuleSchema.parse(baseRuleInput({ zoneId: "zone_1" })).zoneId).toBe("zone_1");
  });

  it("accepts a CARRIER_RATE rule with a carrier action and preserves its fields", function () {
    const parsed = StoredRuleSchema.parse(
      baseRuleInput({
        kind: "CARRIER_RATE",
        action: { mode: "flat", amount: "9.99", serviceName: "ShipMath Rate", serviceCode: "shipmath-flat" },
      }),
    );
    expect(parsed.action).toEqual({
      mode: "flat",
      amount: "9.99",
      serviceName: "ShipMath Rate",
      serviceCode: "shipmath-flat",
    });
  });

  it("rejects a CARRIER_RATE rule whose action is a function action", function () {
    const result = StoredRuleSchema.safeParse(baseRuleInput({ kind: "CARRIER_RATE" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("action"))).toBe(true);
    }
  });

  it("rejects a CARRIER_RATE rule with an invalid carrier action (flat without amount)", function () {
    const result = StoredRuleSchema.safeParse(
      baseRuleInput({
        kind: "CARRIER_RATE",
        action: { mode: "flat", serviceName: "ShipMath Rate", serviceCode: "shipmath-flat" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects product_tag conditions on CARRIER_RATE rules (lane matrix §A3)", function () {
    const result = StoredRuleSchema.safeParse(
      baseRuleInput({
        kind: "CARRIER_RATE",
        action: { mode: "free", serviceName: "Free", serviceCode: "free" },
        conditions: {
          combinator: "AND",
          conditions: [{ field: "product_tag", operator: "in", value: ["heavy"] }],
        },
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("conditions"))).toBe(true);
    }
  });

  it("rejects customer_tag and logged_in conditions on CARRIER_RATE rules", function () {
    for (const field of ["customer_tag", "logged_in"] as const) {
      const result = StoredRuleSchema.safeParse(
        baseRuleInput({
          kind: "CARRIER_RATE",
          action: { mode: "free", serviceName: "Free", serviceCode: "free" },
          conditions: {
            combinator: "AND",
            conditions: [
              field === "logged_in"
                ? { field, operator: "eq", value: true }
                : { field, operator: "in", value: ["vip"] },
            ],
          },
        }),
      );
      expect(result.success).toBe(false);
    }
  });

  it("rejects forbidden fields nested deep inside condition groups", function () {
    const result = StoredRuleSchema.safeParse(
      baseRuleInput({
        kind: "CARRIER_RATE",
        action: { mode: "flat", amount: "5", serviceName: "Rate", serviceCode: "rate" },
        conditions: {
          combinator: "OR",
          conditions: [
            { combinator: "AND", conditions: [{ field: "subtotal", operator: "gt", value: 100 }] },
            {
              combinator: "AND",
              conditions: [{ field: "customer_tag", operator: "in", value: ["vip"] }],
            },
          ],
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts product_tag / customer_tag / logged_in on HIDE rules", function () {
    const parsed = StoredRuleSchema.parse(
      baseRuleInput({
        conditions: {
          combinator: "OR",
          conditions: [
            { field: "product_tag", operator: "in", value: ["oversize"] },
            { field: "customer_tag", operator: "in", value: ["vip"] },
            { field: "logged_in", operator: "eq", value: true },
          ],
        },
      }),
    );
    expect(parsed.conditions.combinator).toBe("OR");
  });

  it("accepts RENAME and MOVE actions", function () {
    expect(
      StoredRuleSchema.parse(baseRuleInput({ kind: "RENAME", action: { title: "Express" } })).action,
    ).toEqual({ title: "Express" });
    expect(
      StoredRuleSchema.parse(baseRuleInput({ kind: "MOVE", action: { position: 3 } })).action,
    ).toEqual({ position: 3 });
  });

  it("rejects non-integer priorities", function () {
    const result = StoredRuleSchema.safeParse(baseRuleInput({ priority: 1.5 }));
    expect(result.success).toBe(false);
  });
});
