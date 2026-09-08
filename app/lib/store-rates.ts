/**
 * Store shipping rates for the simulator's order summary (spec 008 addendum).
 *
 * Shopify stores define their own shipping methods inside delivery zones
 * (e.g. "Standard — free", "Express — $15"). At checkout those options share
 * the delivery group with ShipMath's carrier rates, and the Function lane's
 * HIDE/RENAME/MOVE operations apply to them by title. This module rebuilds
 * that combined view for the simulator:
 *
 *   parse GraphQL deliveryProfiles zone nodes (countries + method
 *   definitions with price/weight conditions) → filter by destination /
 *   subtotal / weight → merge ShipMath's carrier rates into ONE list →
 *   apply the ops the Function WOULD emit in priority order (the SHARED
 *   optionMatchesTarget, so matching cannot drift) → report every
 *   customization for the summary to display.
 *
 * Pure module: no prisma, no I/O — the loader feeds raw zone nodes in, the
 * page calls buildCheckoutOptions per render.
 */

import { optionMatchesTarget, type WireAction } from "./rule-evaluation";
import type { SimFunctionOperation } from "./simulate";

/** One Shopify-defined shipping method (a delivery method definition). */
export interface StoreRateOption {
  /** Pickable code derived from the method definition id. */
  code: string;
  /** The rate name as the store defined it ("Standard", "Express", …). */
  title: string;
  /** Decimal string in shop currency ("0.00", "15.00"). */
  price: string;
  zoneId: string;
  zoneName: string;
  /**
   * Country coverage with optional province restriction (empty/absent
   * provinces = the whole country is in the zone).
   */
  countries: Array<{ code: string; provinces: string[] | null }>;
  /** True when the zone covers "rest of world" (any destination). */
  restOfWorld: boolean;
  /** Inclusive order-subtotal bounds in shop currency; null = unbounded. */
  minOrderSubtotal: number | null;
  maxOrderSubtotal: number | null;
  /** Inclusive weight bounds in grams; null = unbounded. */
  weightLowGrams: number | null;
  weightHighGrams: number | null;
}

/** One pickable row in the summary's shipping rates box. */
export interface CheckoutOption {
  code: string;
  title: string;
  /** Decimal string in shop currency. */
  price: string;
  /** Where the option comes from: the store's own zone, or a ShipMath rule. */
  source: "STORE" | "SHIPMATH";
}

/** One delivery-customization effect the Function lane applied to an option. */
export interface CheckoutCustomization {
  kind: "HIDE" | "RENAME" | "MOVE";
  ruleName: string;
  /** The affected option's title at the moment the op applied. */
  title: string;
  /** RENAME only: the new title. */
  renamedTo?: string;
  /** MOVE only: the final 0-based position. */
  index?: number;
}

/** The combined rates box plus every customization the Function lane applied. */
export interface CheckoutPreview {
  options: CheckoutOption[];
  customizations: CheckoutCustomization[];
  /** H/R/M ops that matched no shipping option here (filters may be off). */
  unmatchedOps: number;
}

const UNIT_TO_GRAMS: Record<string, number> = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  POUNDS: 453.592,
  OUNCES: 28.3495,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function decimal(value: number): string {
  return value.toFixed(2);
}

/** Short pickable suffix of a gid ("…/159353577" → "159353577"). */
function shortId(id: string): string {
  const match = /\d+$/.exec(id);
  return match ? match[0] : id;
}

function parseCountries(
  rawCountries: unknown,
): Array<{ code: string; provinces: string[] | null; restOfWorld: boolean }> {
  const countries: Array<{ code: string; provinces: string[] | null; restOfWorld: boolean }> = [];
  if (!Array.isArray(rawCountries)) {
    return countries;
  }
  for (const rawCountry of rawCountries) {
    const country = asRecord(rawCountry);
    if (!country) {
      continue;
    }
    // 2025-10 shape: code is an OBJECT { countryCode, restOfWorld } (it only
    // became a union in later versions — see DELIVERY_PROFILES_QUERY).
    const codeNode = asRecord(country.code);
    const code = codeNode ? str(codeNode.countryCode) : null;
    const restOfWorld = codeNode ? codeNode.restOfWorld === true : false;
    if (!code && !restOfWorld) {
      continue;
    }
    let provinces: string[] | null = null;
    if (Array.isArray(country.provinces)) {
      provinces = [];
      for (const rawProvince of country.provinces) {
        const province = asRecord(rawProvince);
        const provinceCode = province ? str(province.code) : null;
        if (provinceCode) {
          provinces.push(provinceCode.toUpperCase());
        }
      }
    }
    countries.push({ code: (code ?? "").toUpperCase(), provinces, restOfWorld });
  }
  return countries;
}

interface ParsedBounds {
  minOrderSubtotal: number | null;
  maxOrderSubtotal: number | null;
  weightLowGrams: number | null;
  weightHighGrams: number | null;
}

/**
 * methodConditions → bounds. Shopify's UI emits inclusive >= / <= pairs for
 * TOTAL_PRICE (MoneyV2 criteria) and TOTAL_WEIGHT (Weight criteria with a
 * unit); strict variants are folded onto the same inclusive bound.
 */
function parseConditions(conditions: unknown): ParsedBounds {
  const bounds: ParsedBounds = {
    minOrderSubtotal: null,
    maxOrderSubtotal: null,
    weightLowGrams: null,
    weightHighGrams: null,
  };
  if (!Array.isArray(conditions)) {
    return bounds;
  }
  for (const raw of conditions) {
    const condition = asRecord(raw);
    if (!condition) {
      continue;
    }
    const field = typeof condition.field === "string" ? condition.field.toUpperCase() : "";
    const operator =
      typeof condition.operator === "string" ? condition.operator.toUpperCase() : "";
    const criteria = asRecord(condition.conditionCriteria);
    if (!criteria) {
      continue;
    }
    if (field === "TOTAL_PRICE") {
      const amount = num(criteria.amount);
      if (amount === null) {
        continue;
      }
      if (operator.startsWith("GREATER_THAN")) {
        bounds.minOrderSubtotal = amount;
      } else if (operator.startsWith("LESS_THAN")) {
        bounds.maxOrderSubtotal = amount;
      }
    } else if (field === "TOTAL_WEIGHT") {
      const value = num(criteria.value);
      const factor = UNIT_TO_GRAMS[String(criteria.unit ?? "").toUpperCase()] ?? null;
      if (value === null || factor === null) {
        continue;
      }
      const grams = value * factor;
      if (operator.startsWith("GREATER_THAN")) {
        bounds.weightLowGrams = grams;
      } else if (operator.startsWith("LESS_THAN")) {
        bounds.weightHighGrams = grams;
      }
    }
  }
  return bounds;
}

/**
 * Parse delivery-profile zone nodes (zone + attached methodDefinitions, the
 * flattened shape fetchDeliveryZones builds) into store rate options.
 * Defensive by design: a shape the API changed is skipped, never thrown —
 * the simulator page still works without store rates. Method definitions
 * are de-duplicated by id because a zone can be linked from several
 * profiles; inactive methods and dynamic carrier-participant rates (no
 * static price) are skipped.
 */
export function storeRatesFromZones(zones: unknown[]): StoreRateOption[] {
  const options: StoreRateOption[] = [];
  const seenMethodIds = new Set<string>();
  for (const rawZone of zones) {
    const zone = asRecord(rawZone);
    if (!zone) {
      continue;
    }
    const zoneId = zone.id === undefined || zone.id === null ? null : String(zone.id);
    if (!zoneId) {
      continue;
    }
    const zoneName = str(zone.name) ?? `Zone ${zoneId}`;
    const countries = parseCountries(zone.countries);
    const restOfWorld = countries.some(function row(entry) {
      return entry.restOfWorld;
    });
    const definitionsRoot = asRecord(zone.methodDefinitions);
    const edges = Array.isArray(definitionsRoot?.edges) ? definitionsRoot.edges : [];
    for (const rawEdge of edges) {
      const edge = asRecord(rawEdge);
      const method = edge ? asRecord(edge.node) : null;
      if (!method) {
        continue;
      }
      const methodId =
        method.id === undefined || method.id === null ? null : String(method.id);
      if (!methodId || seenMethodIds.has(methodId)) {
        continue;
      }
      const title = str(method.name);
      if (!title || method.active === false) {
        continue;
      }
      const rateProvider = asRecord(method.rateProvider);
      const priceNode = rateProvider ? asRecord(rateProvider.price) : null;
      const price = priceNode ? num(priceNode.amount) : null;
      if (price === null || price < 0) {
        continue; // dynamic (carrier participant) rates carry no static price
      }
      seenMethodIds.add(methodId);
      options.push({
        code: `store:${shortId(methodId)}`,
        title,
        price: decimal(price),
        zoneId,
        zoneName,
        countries: countries.map(function copy(entry) {
          return { code: entry.code, provinces: entry.provinces ? [...entry.provinces] : null };
        }),
        restOfWorld,
        ...parseConditions(method.methodConditions),
      });
    }
  }
  return options;
}

export interface StoreRateContext {
  /** ISO-2 country code; empty = no destination → checkout shows nothing. */
  country: string;
  province: string | null;
  subtotal: number;
  weightGrams: number;
}

/**
 * Which store rates apply to this cart + destination: the zone must cover
 * the country (rest-of-world zones cover any country; a NAMED province must
 * be covered by the zone's province list), and the cart must fall inside
 * the method's subtotal/weight window (bounds inclusive). A destination
 * without a province passes the province gate: Shopify lists every
 * subdivision of a country added whole to a zone, so a full list cannot be
 * told apart from a deliberate restriction, and real checkout addresses in
 * subdivided countries always carry a province.
 */
export function pickStoreRates(
  options: StoreRateOption[],
  context: StoreRateContext,
): StoreRateOption[] {
  const country = context.country.trim().toUpperCase();
  if (!country) {
    return [];
  }
  const province = context.province ? context.province.trim().toUpperCase() : null;
  return options.filter(function applicable(option) {
    const inZone =
      option.restOfWorld ||
      option.countries.some(function covered(entry) {
        if (entry.code !== country) {
          return false;
        }
        if (!entry.provinces || entry.provinces.length === 0) {
          return true;
        }
        // Shopify returns EVERY subdivision when a whole country is added to
        // a zone (verified 2026-09-08 against a live store: a US-wide zone
        // carries 62 province codes), so a full list is indistinguishable
        // from a deliberate restriction. The destination shortcut fills only
        // the country, and checkout addresses in subdivided countries always
        // carry a province, so a missing province fails OPEN here: the gate
        // restricts only a destination that names a province the zone does
        // not cover.
        return province === null || entry.provinces.includes(province);
      });
    if (!inZone) {
      return false;
    }
    if (option.minOrderSubtotal !== null && context.subtotal < option.minOrderSubtotal) {
      return false;
    }
    if (option.maxOrderSubtotal !== null && context.subtotal > option.maxOrderSubtotal) {
      return false;
    }
    if (option.weightLowGrams !== null && context.weightGrams < option.weightLowGrams) {
      return false;
    }
    if (option.weightHighGrams !== null && context.weightGrams > option.weightHighGrams) {
      return false;
    }
    return true;
  });
}

function opToAction(operation: SimFunctionOperation): WireAction {
  return {
    m: operation.methodType,
    tc: operation.titleContains,
    ti: operation.title,
    ix: operation.index,
  };
}

/**
 * The combined shipping options box, as checkout would render it: the
 * store's own rates for this destination plus ShipMath's carrier rates in
 * ONE list, then the Function lane's HIDE/RENAME/MOVE ops applied in rule
 * priority order (the same order the Function emits them at checkout, and
 * through the SHARED optionMatchesTarget, so matching cannot drift) — every
 * effect is recorded for the summary. MOVE indexes are clamped to the list
 * bounds, exactly like the Function.
 */
export function buildCheckoutOptions(input: {
  storeRates: StoreRateOption[];
  cart: StoreRateContext;
  functionOperations: SimFunctionOperation[];
  carrierRates: Array<{ serviceCode: string; serviceName: string; priceCents: string }>;
}): CheckoutPreview {
  function matches(option: { title: string }, operation: SimFunctionOperation): boolean {
    return optionMatchesTarget(opToAction(operation), {
      handle: option.title,
      title: option.title,
      methodType: "SHIPPING",
    });
  }

  const customizations: CheckoutCustomization[] = [];
  let unmatchedOps = 0;

  // Checkout shows one combined delivery group: the store's own methods and
  // ShipMath's carrier rates together, so a rule can hide or rename either.
  const options: CheckoutOption[] = [
    ...pickStoreRates(input.storeRates, input.cart).map(function toOption(rate) {
      return { code: rate.code, title: rate.title, price: rate.price, source: "STORE" as const };
    }),
    ...input.carrierRates.map(function toOption(rate) {
      const price = Number.parseFloat(rate.priceCents) / 100;
      return {
        code: rate.serviceCode,
        title: rate.serviceName,
        price: decimal(Number.isFinite(price) ? price : 0),
        source: "SHIPMATH" as const,
      };
    }),
  ];

  // Apply the ops in rule priority order (functionOperations preserves it),
  // exactly as the Function walks decisions over the delivery group.
  for (const operation of input.functionOperations) {
    if (operation.kind === "HIDE") {
      let removedAny = false;
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (matches(options[index], operation)) {
          customizations.push({
            kind: "HIDE",
            ruleName: operation.ruleName,
            title: options[index].title,
          });
          options.splice(index, 1);
          removedAny = true;
        }
      }
      if (!removedAny) {
        unmatchedOps += 1;
      }
    } else if (operation.kind === "RENAME" && operation.title) {
      let renamedAny = false;
      for (const option of options) {
        if (matches(option, operation)) {
          customizations.push({
            kind: "RENAME",
            ruleName: operation.ruleName,
            title: option.title,
            renamedTo: operation.title,
          });
          option.title = operation.title;
          renamedAny = true;
        }
      }
      if (!renamedAny) {
        unmatchedOps += 1;
      }
    } else if (operation.kind === "MOVE" && typeof operation.index === "number") {
      const at = options.findIndex(function locate(option) {
        return matches(option, operation);
      });
      if (at < 0) {
        unmatchedOps += 1;
        continue;
      }
      const moved = options.splice(at, 1)[0];
      const target = Math.max(0, Math.min(operation.index, options.length));
      options.splice(target, 0, moved);
      customizations.push({
        kind: "MOVE",
        ruleName: operation.ruleName,
        title: moved.title,
        index: target,
      });
    }
  }

  return { options, customizations, unmatchedOps };
}
