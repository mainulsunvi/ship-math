/**
 * Carrier rate action schema (architecture.md §A3) — the stored action JSON
 * for rules with kind = CARRIER_RATE.
 *
 * PURE module: zod is the only import. Plan 007's Function imports this
 * verbatim, so no server imports are allowed here (purity boundary §A4 keeps
 * carrier/* app-side, but the schema itself must be WASM-bundleable).
 *
 * All money is decimal STRINGS (never floats); cents conversion happens only
 * at the carrier-callback response boundary (§A3 rate math pipeline:
 * base + perItem + perWeight + handlingFee, cap clamp, round half-up).
 */

import { z } from "zod";

export const RATE_MODES = ["flat", "free", "tiered", "percentage"] as const;
export type RateMode = (typeof RATE_MODES)[number];

/** Non-negative decimal string: "0", "12.5", "1200". No sign, no separators. */
const MONEY_STRING_PATTERN = /^\d+(\.\d+)?$/;

const MoneyStringSchema = z.string().regex(MONEY_STRING_PATTERN);

/** One tiered band; `to` omitted = open-ended final band. */
export const RateTierSchema = z
  .object({
    basis: z.enum(["weight", "subtotal", "quantity"]),
    from: z.number(),
    to: z.number().optional(),
    amount: MoneyStringSchema,
  })
  .refine(
    function tierBounds(tier) {
      return tier.to === undefined || tier.to > tier.from;
    },
    { path: ["to"], message: "tier 'to' must be greater than 'from'" },
  );
export type RateTier = z.infer<typeof RateTierSchema>;

export const CarrierRateActionSchema = z
  .object({
    mode: z.enum(RATE_MODES),
    amount: MoneyStringSchema.optional(), // flat: shop-currency decimal
    percentage: z.number().min(0).max(100).optional(), // percentage: 0–100 (§A3 — a number, not a money string)
    tiers: z.array(RateTierSchema).optional(), // tiered bands
    perItem: z
      .object({
        amount: MoneyStringSchema,
        freeItems: z.number().int().min(0).optional(),
      })
      .optional(),
    perWeight: z
      .object({
        amount: MoneyStringSchema,
        per: z.enum(["kg", "lb"]),
      })
      .optional(),
    handlingFee: MoneyStringSchema.optional(),
    cap: MoneyStringSchema.optional(), // max clamp
    serviceName: z.string().min(1), // Shopify rejects empty service names at the response boundary
    serviceCode: z.string().min(1),
    description: z.string().optional(),
  })
  .superRefine(
    function refineCarrierRateAction(action, ctx) {
      if (action.mode === "flat" && action.amount === undefined) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "flat mode requires 'amount' (decimal string)" });
      }
      if (action.mode === "percentage" && action.percentage === undefined) {
        ctx.addIssue({ code: "custom", path: ["percentage"], message: "percentage mode requires 'percentage' (0–100)" });
      }
      if (action.mode === "tiered" && (action.tiers === undefined || action.tiers.length === 0)) {
        ctx.addIssue({ code: "custom", path: ["tiers"], message: "tiered mode requires at least one tier" });
      }
    },
  );
export type CarrierRateAction = z.infer<typeof CarrierRateActionSchema>;
