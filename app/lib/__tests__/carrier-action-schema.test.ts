import { describe, expect, it } from "vitest";
import { CarrierRateActionSchema } from "../carrier/action-schema";

function flatAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "flat",
    amount: "12.50",
    serviceName: "ShipMath Rate",
    serviceCode: "shipmath-rate",
    ...overrides,
  };
}

describe("CarrierRateActionSchema (architecture §A3)", function () {
  it("parses a flat action", function () {
    const parsed = CarrierRateActionSchema.parse(flatAction());
    expect(parsed.mode).toBe("flat");
    expect(parsed.amount).toBe("12.50");
  });

  it("parses a free action", function () {
    expect(CarrierRateActionSchema.parse({ mode: "free", serviceName: "Free", serviceCode: "free" }).mode).toBe("free");
  });

  it("requires amount for flat mode", function () {
    const { mode: _mode, amount: _amount, ...withoutAmount } = flatAction();
    expect(CarrierRateActionSchema.safeParse(withoutAmount).success).toBe(false);
  });

  it("requires percentage within 0–100 for percentage mode", function () {
    expect(
      CarrierRateActionSchema.safeParse({ mode: "percentage", percentage: 10, serviceName: "S", serviceCode: "s" })
        .success,
    ).toBe(true);
    expect(
      CarrierRateActionSchema.safeParse({ mode: "percentage", percentage: 150, serviceName: "S", serviceCode: "s" })
        .success,
    ).toBe(false);
    expect(
      CarrierRateActionSchema.safeParse({ mode: "percentage", serviceName: "S", serviceCode: "s" }).success,
    ).toBe(false);
  });

  it("requires at least one tier for tiered mode", function () {
    const tiered = {
      mode: "tiered",
      tiers: [{ basis: "weight", from: 0, to: 1000, amount: "8.00" }],
      serviceName: "S",
      serviceCode: "s",
    };
    expect(CarrierRateActionSchema.safeParse(tiered).success).toBe(true);
    expect(
      CarrierRateActionSchema.safeParse({ mode: "tiered", tiers: [], serviceName: "S", serviceCode: "s" }).success,
    ).toBe(false);
    expect(CarrierRateActionSchema.safeParse({ mode: "tiered", serviceName: "S", serviceCode: "s" }).success).toBe(
      false,
    );
  });

  it("rejects tiers where 'to' is not greater than 'from'", function () {
    const tiered = {
      mode: "tiered",
      tiers: [{ basis: "subtotal", from: 100, to: 100, amount: "8.00" }],
      serviceName: "S",
      serviceCode: "s",
    };
    expect(CarrierRateActionSchema.safeParse(tiered).success).toBe(false);
  });

  it("keeps all money as decimal strings and rejects floats-as-strings garbage", function () {
    expect(CarrierRateActionSchema.safeParse(flatAction({ amount: "0" })).success).toBe(true);
    expect(CarrierRateActionSchema.safeParse(flatAction({ amount: "12.5.1" })).success).toBe(false);
    expect(CarrierRateActionSchema.safeParse(flatAction({ amount: "-5" })).success).toBe(false);
    expect(CarrierRateActionSchema.safeParse(flatAction({ amount: "1,000" })).success).toBe(false);
    expect(CarrierRateActionSchema.safeParse(flatAction({ amount: 12.5 })).success).toBe(false);
  });

  it("validates perItem and perWeight sub-forms", function () {
    expect(
      CarrierRateActionSchema.safeParse({ mode: "free", perItem: { amount: "1.00", freeItems: 2 }, serviceName: "S", serviceCode: "s" })
        .success,
    ).toBe(true);
    expect(
      CarrierRateActionSchema.safeParse({ mode: "free", perItem: { amount: "1.00", freeItems: -1 }, serviceName: "S", serviceCode: "s" })
        .success,
    ).toBe(false);
    expect(
      CarrierRateActionSchema.safeParse({ mode: "free", perWeight: { amount: "2.00", per: "kg" }, serviceName: "S", serviceCode: "s" })
        .success,
    ).toBe(true);
    expect(
      CarrierRateActionSchema.safeParse({ mode: "free", perWeight: { amount: "2.00", per: "oz" }, serviceName: "S", serviceCode: "s" })
        .success,
    ).toBe(false);
  });

  it("accepts handlingFee, cap and description", function () {
    const parsed = CarrierRateActionSchema.parse(
      flatAction({ handlingFee: "2.00", cap: "49.99", description: "Ground" }),
    );
    expect(parsed.handlingFee).toBe("2.00");
    expect(parsed.cap).toBe("49.99");
  });

  it("requires serviceName and serviceCode", function () {
    const { serviceName: _serviceName, serviceCode: _serviceCode, ...withoutNames } = flatAction();
    expect(CarrierRateActionSchema.safeParse(withoutNames).success).toBe(false);
  });
});
