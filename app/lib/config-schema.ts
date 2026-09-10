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
import { CarrierRateActionSchema } from "./carrier/action-schema";

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
  "total",
  "weight",
  "quantity",
  "price",
  "product_tag",
  "sku",
  "vendor",
  "customer_tag",
  "logged_in",
  "city",
  "date",
  "day_of_week",
  "time_of_day",
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

/**
 * Spec 021: the ROOT group may also use NONE ("none of the conditions
 * match", semantics NOT(OR over children)). Nested NONE is rejected in
 * StoredRuleSchema.superRefine — root-only keeps evaluation explainable.
 */
export const ConditionGroupSchema: z.ZodType<{
  combinator: "AND" | "OR" | "NONE";
  conditions: Array<z.infer<typeof ConditionSchema> | unknown>;
}> = z.lazy(() =>
  z.object({
    combinator: z.enum(["AND", "OR", "NONE"]),
    conditions: z.array(z.union([ConditionSchema, ConditionGroupSchema])),
  }),
);
export type ConditionGroup = {
  combinator: "AND" | "OR" | "NONE";
  conditions: Array<Condition | ConditionGroup>;
};

export const RuleKindSchema = z.enum(["CARRIER_RATE", "HIDE", "RENAME", "MOVE"]);
export type RuleKind = z.infer<typeof RuleKindSchema>;

/** Rank selectors (spec 020): target the cheapest/most expensive option. */
export const RANK_SELECTORS = ["CHEAPEST", "MOST_EXPENSIVE"] as const;
export type RankSelector = (typeof RANK_SELECTORS)[number];

/** Delivery-option target inside stored actions. */
export const OptionTargetSchema = z.object({
  method: z.string().optional(), // SHIPPING | PICK_UP | LOCAL | RETAIL …
  titleContains: z.string().optional(),
  /** Spec 020: price-rank selector; HIDE rules only, exclusive with method/titleContains. */
  rank: z.enum(RANK_SELECTORS).optional(),
  /** Spec 020: invert the match ("hide all EXCEPT the matched options"). */
  invert: z.boolean().optional(),
});
export type OptionTarget = z.infer<typeof OptionTargetSchema>;

export const ActionSchema = z.object({
  target: OptionTargetSchema.optional(),
  title: z.string().optional(), // RENAME
  position: z.number().int().min(0).optional(), // MOVE
  // CARRIER_RATE payload (spec 007) is intentionally not mirrored to the Function.
});
export type RuleAction = z.infer<typeof ActionSchema>;

/**
 * Spec 021: HIDE/RENAME/MOVE rules carry a THEN branch (actions, min 1) and
 * an optional ELSE branch (elseActions). Stored in the SAME Prisma `action`
 * column as the wrapper object — repositories keep writing
 * JSON.stringify(parsed.action). Legacy single-action objects normalize to
 * { actions: [obj], elseActions: [] } via normalizeFunctionActions.
 */
export const FunctionRuleActionsSchema = z.object({
  actions: z.array(ActionSchema).min(1),
  elseActions: z.array(ActionSchema).default([]),
});
export type FunctionRuleActions = z.infer<typeof FunctionRuleActionsSchema>;

/**
 * Normalize any stored/incoming action value for a function-kind rule into
 * the wrapper shape: accepts the wrapper, a legacy single action, and falls
 * back to an empty THEN branch (callers report their own validation error).
 */
export function normalizeFunctionActions(action: unknown): FunctionRuleActions {
  const wrapper = FunctionRuleActionsSchema.safeParse(action);
  if (wrapper.success) {
    return wrapper.data;
  }
  const single = ActionSchema.safeParse(action);
  if (single.success) {
    return { actions: [single.data], elseActions: [] };
  }
  return { actions: [], elseActions: [] };
}

/** Condition fields the carrier lane can never support (architecture §A3 matrix). */
const CARRIER_FORBIDDEN_FIELDS = new Set<string>(["product_tag", "customer_tag", "logged_in"]);

/** Walk a stored condition tree (groups or leaf conditions), visiting each field name. */
function collectConditionFields(node: unknown, visit: (field: string) => void): void {
  if (!node || typeof node !== "object") {
    return;
  }
  const entry = node as Record<string, unknown>;
  if (typeof entry.field === "string") {
    visit(entry.field);
    return;
  }
  if (Array.isArray(entry.conditions)) {
    for (const child of entry.conditions) {
      collectConditionFields(child, visit);
    }
  }
}

/**
 * Stored ShippingRule row (spec 005) — validates every repository write.
 * `action` is discriminated per kind in the superRefine below: CARRIER_RATE
 * rules carry a CarrierRateAction (architecture §A3); HIDE/RENAME/MOVE carry
 * the OptionTarget-based function action above.
 */
export const StoredRuleSchema = z
  .object({
    name: z.string(),
    kind: RuleKindSchema,
    priority: z.number().int(),
    stopOnMatch: z.boolean(),
    zoneId: z.string().nullish(), // null clears the zone binding on update
    // Setup-wizard draft flag (plan 003 Task 4). Input-optional: when
    // omitted the default fires and the parsed output is true (createRule
    // may still pass enabled: false explicitly for wizard drafts).
    // updateRule ignores it — enable/disable still flows through the
    // dedicated setRuleEnabled repository entry point.
    enabled: z.boolean().default(true),
    conditions: ConditionGroupSchema,
    // Union order matters: carrier payload, then the spec 021 wrapper, then
    // the legacy single function action (tolerated on read/duplicate).
    action: z.union([CarrierRateActionSchema, FunctionRuleActionsSchema, ActionSchema]),
  })
  .superRefine(function refineStoredRule(rule, ctx) {
    if (rule.kind === "CARRIER_RATE") {
      // Lane capability matrix (§A3): the carrier payload has no product
      // tags, no customer identity — those fields are function-lane only.
      if (!CarrierRateActionSchema.safeParse(rule.action).success) {
        ctx.addIssue({
          code: "custom",
          path: ["action"],
          message:
            "CARRIER_RATE rules require a carrier rate action (architecture §A3: mode flat/free/tiered/percentage + serviceName/serviceCode)",
        });
      }
      const forbidden = new Set<string>();
      collectConditionFields(rule.conditions, function visit(field) {
        if (CARRIER_FORBIDDEN_FIELDS.has(field)) {
          forbidden.add(field);
        }
      });
      if (forbidden.size > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["conditions"],
          message: `CARRIER_RATE rules cannot use ${Array.from(forbidden).sort().join(", ")} — the carrier payload has no tags or customer identity (§A3)`,
        });
      }
    } else {
      const normalized = normalizeFunctionActions(rule.action);
      if (normalized.actions.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["action"],
          message: `${rule.kind} rules require at least one action (target/title/position)`,
        });
      }
      // Spec 021: rank checks walk BOTH branches (then + else).
      normalized.actions.concat(normalized.elseActions).forEach(function checkAction(action, actionIndex) {
        const target = action.target;
        if (!target || target.rank === undefined) {
          return;
        }
        if (rule.kind !== "HIDE") {
          ctx.addIssue({
            code: "custom",
            path: ["action", "actions", actionIndex, "target", "rank"],
            message: "Rank selectors (cheapest/most expensive) can only be used on Hide rules in this release",
          });
        }
        if (target.method !== undefined || target.titleContains !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["action", "actions", actionIndex, "target", "rank"],
            message: "A rank selector cannot be combined with method or title filters",
          });
        }
      });
    }
    // Spec 021: NONE is a ROOT-only combinator — nested groups using it are
    // rejected loudly (evaluation stays explainable; see §2).
    validateNoNestedNone(rule.conditions, ctx, ["conditions"]);
  });

/** Root-only NONE guard (spec 021 §2): walks nested groups; the root group
 * itself may use NONE, its descendants may not. */
function validateNoNestedNone(
  node: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return;
  }
  const entry = node as { combinator?: unknown; conditions?: unknown };
  if (!Array.isArray(entry.conditions)) {
    return;
  }
  entry.conditions.forEach(function checkChild(child, index) {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return;
    }
    const childEntry = child as { combinator?: unknown; conditions?: unknown };
    if (childEntry.combinator === "NONE") {
      ctx.addIssue({
        code: "custom",
        path: [...path, index, "combinator"],
        message: 'The "none" match type can only be used at the top level of the conditions',
      });
      return;
    }
    validateNoNestedNone(child, ctx, [...path, index]);
  });
}
// z.input (not z.infer): RuleInput is what CALLERS construct, and the
// enabled default makes it input-optional (omitted = true on parse) while
// the parsed output always carries a concrete boolean.
export type RuleInput = z.input<typeof StoredRuleSchema>;

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
    o: z.enum(["A", "O", "N"]),
    n: z.array(z.union([WireConditionSchema, WireConditionGroupSchema])),
  }),
);

export const WireActionSchema = z.object({
  m: z.string().optional(),
  tc: z.string().optional(),
  ti: z.string().optional(),
  ix: z.number().int().optional(),
  rk: z.enum(["C", "E"]).optional(), // spec 020: rank selector (cheapest/most expensive)
  iv: z.union([z.literal(0), z.literal(1)]).optional(), // spec 020: invert match
});

export const WireRuleSchema = z.object({
  i: z.string(),
  k: z.enum(["H", "R", "M"]),
  p: z.number().int(),
  s: z.union([z.literal(0), z.literal(1)]),
  z: z.string().optional(),
  c: WireConditionGroupSchema.optional(),
  /** Spec 021: THEN/ELSE action arrays. Legacy `a` still parses (one then-action). */
  as: z.array(WireActionSchema).optional(),
  ea: z.array(WireActionSchema).optional(),
  a: WireActionSchema.optional(),
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
