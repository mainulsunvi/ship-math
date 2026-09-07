/**
 * Rate simulator core (spec 008 / architecture.md §A4) — server module.
 *
 * Parity by construction: this orchestrator calls the PRODUCTION modules —
 * `buildFunctionConfig` for the exact wire config checkout reads,
 * `evaluateRules` for the operations the Function WOULD emit,
 * `computeRatesDetailed` for the carrier lane exactly as the live callback
 * runs it, and the shared CartFacts shape for cart normalization. No second
 * evaluation path exists anywhere in the app.
 *
 * Test mode does NOT gate the simulator: it is the preview surface the
 * merchant relies on while test mode keeps real checkouts untouched (spec
 * 008 criterion 8). The result carries the shop's live testMode so the UI
 * can say so.
 *
 * Every run persists one RequestLog(SIMULATION) row — synchronous, because
 * the run is user-facing — and joins the ~1-in-20 30-day prune cadence.
 */

import { z } from "zod";
import prisma from "../db.server";
import {
  buildFunctionConfig,
  buildWireZones,
  toWireConditionGroup,
  ConfigTooLargeError,
} from "./function-config";
import { CarrierRateActionSchema } from "./carrier/action-schema";
import { parseStoredJson } from "./config-schema";
import {
  computeRatesDetailed,
  type CarrierRule,
  type CarrierCartContext,
  type ComputedRate,
  type EvaluationMode,
} from "./carrier/engine";
import {
  carrierTracesFromDetailed,
  explainRules,
  type RuleTrace,
} from "./rule-explain";
import { evaluateRules, type CartFacts, type WireConfig } from "./rule-evaluation";
import { addDecimals, multiplyDecimals } from "./money";
import { inputDigestFor, pruneIfDue, pruneRequestLogs } from "./prune-logs";

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

const MONEY_STRING_PATTERN = /^\d+(\.\d+)?$/;

export const SimInputSchema = z.object({
  lines: z
    .array(
      z.object({
        title: z.string().max(200).default(""),
        price: z.string().regex(MONEY_STRING_PATTERN, "price must be a decimal like 12.50"),
        weightGrams: z.number().int().min(0),
        quantity: z.number().int().min(1),
        sku: z.string().max(100).optional(),
        vendor: z.string().max(100).optional(),
        productTags: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .max(100),
  destination: z.object({
    country: z.string().trim().length(2),
    province: z.string().trim().max(10).nullable(),
    postal: z.string().trim().max(20).nullable(),
  }),
  loggedIn: z.boolean(),
  customerTags: z.array(z.string().max(100)).max(100),
  /** Combined-rules picker: absent/empty = every rule runs (spec 008). */
  onlyRuleIds: z.array(z.string().max(64)).max(200).optional(),
  /** Pickup location id the summary displays — metadata; no rule reads it. */
  locationId: z.string().max(64).nullable().optional(),
});
export type SimInput = z.infer<typeof SimInputSchema>;

/** Result of parsing a raw JSON payload submitted by a simulator UI. */
export type SimPayloadParse =
  | { ok: true; input: SimInput }
  | { ok: false; message: string };

/**
 * Parses the JSON payload a simulator modal submits over the wire. Shared by
 * every route that hosts the simulator modal so validation cannot drift.
 */
export function parseSimPayload(raw: string): SimPayloadParse {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      message: "The simulator payload was malformed. Run the simulation again.",
    };
  }
  const parsed = SimInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        "Check the cart: every line needs a title, a price like 15.00, whole-number grams, and a quantity of at least 1.",
    };
  }
  return { ok: true, input: parsed.data };
}

export interface SimFunctionOperation {
  ruleId: string;
  ruleName: string;
  kind: "HIDE" | "RENAME" | "MOVE";
  methodType?: string;
  titleContains?: string;
  title?: string;
  index?: number;
}

export interface SimulationResult {
  /** Carrier-lane rates exactly as the live callback would return them. */
  rates: ComputedRate[];
  /** What the checkout Function WOULD emit for this cart (preview). */
  functionOperations: SimFunctionOperation[];
  /** Function-lane rule traces (short wire ids + names + winners). */
  traces: RuleTrace[];
  /** Carrier-lane rule traces (Prisma ids + names + rate outcomes). */
  carrierTraces: RuleTrace[];
  /** Byte size of the wire config the checkout currently reads. */
  wireBytes: number;
  /** The shop's LIVE test-mode flag (the Function mirror may lag a sync). */
  testMode: boolean;
  evaluationMode: EvaluationMode;
  /** Set when the mirror could not be built (config over budget). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Cart facts — mirrors the Function's buildFacts normalization
// ---------------------------------------------------------------------------

function upperOrEmpty(value: string): string {
  return value.toUpperCase();
}

function simFacts(input: SimInput): { facts: CartFacts; subtotal: string; weightGrams: number; quantity: number } {
  let subtotal = "0";
  let weightGrams = 0;
  let quantity = 0;
  const skus: string[] = [];
  const vendors: string[] = [];
  const productTags: string[] = [];
  for (const line of input.lines) {
    const qty = Math.max(1, Math.trunc(line.quantity));
    // Decimal-string math all the way (money never touches floats).
    subtotal = addDecimals(subtotal, multiplyDecimals(line.price, String(qty)));
    weightGrams += Math.max(0, Math.trunc(line.weightGrams)) * qty;
    quantity += qty;
    if (line.sku && !skus.includes(line.sku)) {
      skus.push(line.sku);
    }
    if (line.vendor && !vendors.includes(line.vendor)) {
      vendors.push(line.vendor);
    }
    for (const tag of line.productTags ?? []) {
      if (!productTags.includes(tag)) {
        productTags.push(tag);
      }
    }
  }
  return {
    facts: {
      subtotal: Number(subtotal), // Function parity: Number(subtotalAmount)
      quantity,
      weight: weightGrams, // Function parity: grams
      skus,
      vendors,
      productTags,
      customerTags: input.customerTags,
      loggedIn: input.loggedIn,
    },
    subtotal,
    weightGrams,
    quantity,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Simulate one cart + destination against the shop's rules, exactly as the
 * two production lanes would evaluate them. Throws when the shop domain is
 * not installed (the calling route maps that to a 4xx reply).
 */
export async function simulateRun(shopDomain: string, input: SimInput): Promise<SimulationResult> {
  const startedAt = Date.now();
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, testMode: true, evaluationMode: true },
  });
  if (!shop) {
    throw new Error("This shop is not installed. Reinstall the app and try again.");
  }

  const evaluationMode: EvaluationMode = shop.evaluationMode === "ALL_MATCH" ? "ALL_MATCH" : "FIRST_MATCH";
  const destination = {
    country: upperOrEmpty(input.destination.country),
    province: input.destination.province ? input.destination.province.toUpperCase() : null,
    postal: input.destination.postal ? input.destination.postal.toUpperCase() : null,
  };
  const { facts, subtotal, weightGrams, quantity } = simFacts(input);
  // Combined-rules picker: a non-empty selection scopes BOTH lanes; an empty
  // or absent list means every rule runs.
  const onlyIds =
    input.onlyRuleIds && input.onlyRuleIds.length > 0 ? new Set(input.onlyRuleIds) : null;

  // ---- Function lane: the exact wire config checkout reads ----------------
  let wireBytes = 0;
  let traces: RuleTrace[] = [];
  let functionOperations: SimFunctionOperation[] = [];
  let note: string | undefined;
  try {
    const built = await buildFunctionConfig(shop.id);
    wireBytes = built.bytes;
    const fullConfig = JSON.parse(built.payload) as WireConfig;
    // Scope the wire rules to the picker selection (drift-free: the mirror's
    // own map decides which wire ids survive).
    const scopedWireIds = onlyIds
      ? new Set(
          built.mirrored
            .filter(function selected(entry) {
              return onlyIds.has(entry.ruleId);
            })
            .map(function wireId(entry) {
              return entry.wireId;
            }),
        )
      : null;
    const config: WireConfig = scopedWireIds
      ? {
          ...fullConfig,
          r: (fullConfig.r ?? []).filter(function kept(rule) {
            return scopedWireIds.has(rule.i);
          }),
        }
      : fullConfig;

    // Prisma rule names: wire ids (`r1`) join to Prisma ids via the mirror's
    // own map — no mirror-order duplication here (drift by construction).
    const ruleRows = await prisma.shippingRule.findMany({
      where: { shopId: shop.id },
      select: { id: true, name: true },
    });
    const nameById = new Map(ruleRows.map(function row(rule) {
      return [rule.id, rule.name] as const;
    }));
    const prismaIdByWireId = new Map(built.mirrored.map(function row(entry) {
      return [entry.wireId, entry.ruleId] as const;
    }));

    traces = explainRules(config, facts, destination).map(function named(trace) {
      const prismaId = prismaIdByWireId.get(trace.ruleId);
      return {
        ...trace,
        ruleName: prismaId ? nameById.get(prismaId) ?? "" : "",
      };
    });

    // Winners: the production decision walk (FIRST_MATCH/stopOnMatch included).
    const decisions = evaluateRules(config, facts, destination);
    const winnerIds = new Set(decisions.map(function id(decision) {
      return decision.ruleId;
    }));
    traces = traces.map(function markWinners(trace) {
      return { ...trace, winner: winnerIds.has(trace.ruleId) };
    });
    functionOperations = decisions.map(function toOperation(decision) {
      const prismaId = prismaIdByWireId.get(decision.ruleId);
      return {
        ruleId: decision.ruleId,
        ruleName: prismaId ? nameById.get(prismaId) ?? "" : "",
        kind: decision.kind === "H" ? "HIDE" : decision.kind === "R" ? "RENAME" : "MOVE",
        ...(decision.action.m !== undefined ? { methodType: decision.action.m } : {}),
        ...(decision.action.tc !== undefined ? { titleContains: decision.action.tc } : {}),
        ...(decision.action.ti !== undefined ? { title: decision.action.ti } : {}),
        ...(decision.action.ix !== undefined ? { index: decision.action.ix } : {}),
      };
    });
  } catch (error) {
    if (error instanceof ConfigTooLargeError) {
      // The mirror is over budget, so the checkout currently applies NO
      // function-lane rules. The carrier lane below still simulates.
      note = error.message;
      wireBytes = error.bytes;
    } else {
      throw error;
    }
  }

  // ---- Carrier lane: exactly the live callback's pipeline -----------------
  const rulesRaw = await prisma.shippingRule.findMany({
    where: {
      shopId: shop.id,
      enabled: true,
      kind: "CARRIER_RATE",
      ...(onlyIds ? { id: { in: [...onlyIds] } } : {}),
    },
    orderBy: { priority: "asc" },
  });
  const zoneRows = await prisma.zone.findMany({
    where: { shopId: shop.id, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const referencedZoneIds = new Set(
    rulesRaw
      .map(function zoneId(rule) {
        return rule.zoneId;
      })
      .filter(function defined(id): id is string {
        return id !== null;
      }),
  );
  const { wireZones, idMap } = buildWireZones(zoneRows, referencedZoneIds);

  const carrierRules: CarrierRule[] = [];
  const carrierNames = new Map<string, string>();
  for (const stored of rulesRaw) {
    carrierNames.set(stored.id, stored.name);
    let action;
    try {
      action = parseStoredJson(stored.action, CarrierRateActionSchema);
    } catch {
      continue; // malformed stored action → rule fails, never the run
    }
    if (stored.zoneId !== null && !idMap.has(stored.zoneId)) {
      continue; // zone disabled/missing → rule fails closed (parity with the route)
    }
    carrierRules.push({
      id: stored.id,
      priority: stored.priority,
      stopOnMatch: stored.stopOnMatch,
      zoneId: stored.zoneId === null ? null : idMap.get(stored.zoneId) ?? null,
      conditions: toWireConditionGroup(stored.conditions) ?? null,
      action,
    });
  }

  const cart: CarrierCartContext = {
    destination,
    currency: "USD", // presentation only — the engine computes in shop currency (§A3)
    subtotal,
    weightGrams,
    quantity,
    skus: facts.skus,
    vendors: facts.vendors,
  };
  const detailed = computeRatesDetailed(carrierRules, wireZones, cart, evaluationMode);
  const carrierTraces = carrierTracesFromDetailed(carrierRules, detailed, cart).map(function named(trace) {
    return { ...trace, ruleName: carrierNames.get(trace.ruleId) ?? "" };
  });

  // ---- Persist the run (synchronous — user-facing) ------------------------
  const latencyMs = Date.now() - startedAt;
  const logInput = {
    destination,
    subtotal: cart.subtotal,
    weightGrams,
    quantity,
    lineCount: input.lines.length,
    loggedIn: input.loggedIn,
    customerTags: input.customerTags,
  };
  const matched = [
    ...traces.map(function lane(trace) {
      return { ...trace, lane: "FUNCTION" as const };
    }),
    ...carrierTraces.map(function lane(trace) {
      return { ...trace, lane: "CARRIER" as const };
    }),
  ];
  try {
    await prisma.requestLog.create({
      data: {
        shopId: shop.id,
        source: "SIMULATION",
        inputDigest: inputDigestFor(logInput),
        input: JSON.stringify(logInput),
        matched: JSON.stringify(matched),
        rates: JSON.stringify({ rates: detailed.rates, functionOperations }),
        latencyMs,
      },
    });
    if (pruneIfDue()) {
      await pruneRequestLogs(shop.id);
    }
  } catch {
    // logging must never break the simulation
  }

  return {
    rates: detailed.rates,
    functionOperations,
    traces,
    carrierTraces,
    wireBytes,
    testMode: shop.testMode,
    evaluationMode,
    ...(note !== undefined ? { note } : {}),
  };
}
