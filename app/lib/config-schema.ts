/**
 * Configuration schemas (spec 002) — app-side only (Zod; never imported by
 * the Function runtime). Two layers:
 *
 *   1. STORED format — the JSON columns in Prisma (Zone.postalRules,
 *      ShippingRule.conditions, ShippingRule.action). Verbose, stable,
 *      human-readable keys.
 *   2. WIRE format — the compact mirror pushed to the function owner
 *      metafield (`FunctionConfig`, short keys, ≤9,500 bytes).
 *
 * buildFunctionConfig() in app/lib/function-config.ts converts 1 → 2.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Stored format
// ---------------------------------------------------------------------------

export const POSTAL_MODES = ["EXACT", "PREFIX", "RANGE", "PARTIAL"] as const;
export type PostalMode = (typeof POSTAL_MODES)[number];

export const PostalRuleSchema = z.object({
  id: z.string(),
  mode: z.enum(POSTAL_MODES),
  value: z.string(),
  rangeEnd: z.string().optional(),
});
export type PostalRule = z.infer<typeof PostalRuleSchema>;

export const CONDITION_FIELDS = [
  "subtotal",
  "weight",
  "quantity",
  "product_tag",
  "sku",
  "vendor",
  "customer_tag",
  "logged_in",
  "destination_country",
  "destination_province",
  "destination_postal",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains"] as const;
export type Operator = (typeof OPERATORS)[number];

export const ConditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  operator: z.enum(OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ConditionGroupSchema: z.ZodType<{
  combinator: "AND" | "OR";
  conditions: Array<z.infer<typeof ConditionSchema> | unknown>;
}> = z.lazy(() =>
  z.object({
    combinator: z.enum(["AND", "OR"]),
    conditions: z.array(z.union([ConditionSchema, ConditionGroupSchema])),
  }),
);
export type ConditionGroup = {
  combinator: "AND" | "OR";
  conditions: Array<Condition | ConditionGroup>;
};

export const RuleKindSchema = z.enum(["CARRIER_RATE", "HIDE", "RENAME", "MOVE"]);
export type RuleKind = z.infer<typeof RuleKindSchema>;

/** Delivery-option target inside stored actions. */
export const OptionTargetSchema = z.object({
  method: z.string().optional(), // SHIPPING | PICK_UP | LOCAL | RETAIL …
  titleContains: z.string().optional(),
});
export type OptionTarget = z.infer<typeof OptionTargetSchema>;

export const ActionSchema = z.object({
  target: OptionTargetSchema.optional(),
  title: z.string().optional(), // RENAME
  position: z.number().int().min(0).optional(), // MOVE
  // CARRIER_RATE payload (spec 007) is intentionally not mirrored to the Function.
});
export type RuleAction = z.infer<typeof ActionSchema>;

// ---------------------------------------------------------------------------
// Wire format (mirror) — mirrors app/lib/rule-evaluation.ts types, plus the
// parse/serialize helpers used by app code and tests.
// ---------------------------------------------------------------------------

export const WirePostalRuleSchema = z.object({
  m: z.enum(["E", "P", "R", "C"]),
  x: z.string(),
  e: z.string().optional(),
});

export const WireZoneSchema = z.object({
  i: z.string(),
  c: z.array(z.string()).optional(),
  p: z.array(z.string()).optional(),
  pc: z.array(WirePostalRuleSchema).optional(),
});

export const WireConditionSchema = z.object({
  f: z.string(),
  q: z.string(),
  v: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});

export const WireConditionGroupSchema: z.ZodType<{ o: string; n: unknown[] }> = z.lazy(() =>
  z.object({
    o: z.enum(["A", "O"]),
    n: z.array(z.union([WireConditionSchema, WireConditionGroupSchema])),
  }),
);

export const WireActionSchema = z.object({
  m: z.string().optional(),
  tc: z.string().optional(),
  ti: z.string().optional(),
  ix: z.number().int().optional(),
});

export const WireRuleSchema = z.object({
  i: z.string(),
  k: z.enum(["H", "R", "M"]),
  p: z.number().int(),
  s: z.union([z.literal(0), z.literal(1)]),
  z: z.string().optional(),
  c: WireConditionGroupSchema.optional(),
  a: WireActionSchema,
});

export const FunctionConfigSchema = z.object({
  v: z.literal(1),
  t: z.union([z.literal(0), z.literal(1)]),
  m: z.enum(["F", "A"]),
  z: z.array(WireZoneSchema).optional(),
  r: z.array(WireRuleSchema).optional(),
});
export type FunctionConfig = z.infer<typeof FunctionConfigSchema>;

/** Variables metafield content: distinct tags referenced by rules (≤100 each, platform limit). */
export const InputVariablesSchema = z.object({
  pt: z.array(z.string()).max(100).optional(),
  ct: z.array(z.string()).max(100).optional(),
});
export type InputVariables = z.infer<typeof InputVariablesSchema>;

export function validateFunctionConfig(value: unknown): FunctionConfig {
  return FunctionConfigSchema.parse(value);
}

export function parseStoredJson<T>(raw: string, schema: { parse: (input: unknown) => T }): T {
  return schema.parse(JSON.parse(raw));
}
