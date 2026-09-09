import { PrismaClient, Prisma, Shop } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

/**
 * Runtime behavior is unchanged when the env var is unset (Prisma then uses
 * the schema url file:dev.sqlite exactly as before). Test setup sets
 * SHIPMATH_TEST_DATABASE_URL to a throwaway fixture file so repository tests
 * never touch the dev database.
 */
function createPrismaClient(): PrismaClient {
  const testDatabaseUrl = process.env.SHIPMATH_TEST_DATABASE_URL;
  if (testDatabaseUrl) {
    return new PrismaClient({ datasourceUrl: testDatabaseUrl });
  }
  return new PrismaClient();
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;

// ---------------------------------------------------------------------------
// Shop repository (spec 002)
// ---------------------------------------------------------------------------

/** Idempotent shop row keyed by the myshopify domain from the session. */
export async function getOrCreateShop(shopDomain: string): Promise<Shop> {
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) {
    return existing;
  }
  return prisma.shop.create({ data: { shopDomain } });
}

// ---------------------------------------------------------------------------
// Shop prefs + plan details (spec 003, plan Tasks 2–3, architecture.md §A5)
// ---------------------------------------------------------------------------

/**
 * Dismissal/hint state lives in the Shop.prefs JSON string (§A5: no new
 * columns). Unknown keys are preserved — forward compatible with specs 010.
 * wizardDraftRuleIds/wizardDraftZoneIds carry the row ids created by the
 * setup wizard as disabled drafts (003 review REQUIRED finding: completion
 * flips EXACTLY these rows, never rules/zones the merchant deliberately
 * switched off outside the wizard). Cleared on wizard-complete and on
 * restart-setup.
 */
export interface ShopPrefs {
  dismissedHints?: string[];
  planBannerDismissedFor?: string | null;
  checklistDismissedAt?: string | null;
  wizardDraftRuleIds?: string[] | null;
  wizardDraftZoneIds?: string[] | null;
  [key: string]: unknown;
}

function parsePrefs(raw: string | null): ShopPrefs {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ShopPrefs;
    }
    return {};
  } catch {
    // Corrupt JSON must never break a page load — start over from {}.
    return {};
  }
}

/**
 * Read-only prefs accessor for loaders (§A5): parses the stored JSON string
 * with the same corrupt-safe semantics as updatePrefs. Takes the Shop row so
 * callers that already loaded it never re-query just for prefs.
 */
export function readPrefs(shop: { prefs: string | null }): ShopPrefs {
  return parsePrefs(shop.prefs);
}

/**
 * Read-modify-write JSON merge on Shop.prefs (§A5): shallow-merge `patch`
 * over the stored object, persist back as a JSON string, return the merged
 * result. A patch value of null CLEARS the key's value (that is how a plan
 * banner dismissal is reset when the caller wants it visible again).
 */
export async function updatePrefs(shopId: string, patch: Record<string, unknown>): Promise<ShopPrefs> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { prefs: true },
  });
  const merged = { ...parsePrefs(shop.prefs), ...patch };
  await prisma.shop.update({
    where: { id: shopId },
    data: { prefs: JSON.stringify(merged) },
  });
  return merged;
}

/** Coerce a prefs value to a clean string[] (missing/corrupt shape → []). */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(function isId(entry): entry is string {
    return typeof entry === "string" && entry.length > 0;
  });
}

/** Read the wizard draft id lists without a re-query when the row is at hand. */
export function readWizardDraftIds(prefs: ShopPrefs): { ruleIds: string[]; zoneIds: string[] } {
  return {
    ruleIds: toStringList(prefs.wizardDraftRuleIds),
    zoneIds: toStringList(prefs.wizardDraftZoneIds),
  };
}

/**
 * Append one row id to a wizard draft list (read-modify-write on prefs).
 * Safe for the wizard's one-submit-at-a-time usage; duplicate ids are
 * ignored. Returns the updated list.
 */
export async function appendWizardDraftId(
  shopId: string,
  key: "wizardDraftRuleIds" | "wizardDraftZoneIds",
  id: string,
): Promise<string[]> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { prefs: true },
  });
  const prefs = parsePrefs(shop.prefs);
  const existing = toStringList(prefs[key]);
  const next = existing.includes(id) ? existing : [...existing, id];
  await prisma.shop.update({
    where: { id: shopId },
    data: { prefs: JSON.stringify({ ...prefs, [key]: next }) },
  });
  return next;
}

export interface ShopPlanDetailsInput {
  name?: string | null;
  plan?: string | null;
  isDevShop?: boolean;
}

/**
 * Idempotent upsert of shop identity + plan fields. Consumed by the
 * shop/update webhook (webhooks.app.shop-update.tsx — plain field writes are
 * naturally retry-safe) and by first-run population via
 * ensureShopPlanDetails (services/shop-details.ts). Omitted fields are left
 * untouched on update; the row is created when missing so the very first
 * webhook can arrive before any page load.
 */
export async function saveShopPlanDetails(shopDomain: string, data: ShopPlanDetailsInput): Promise<void> {
  const fields: ShopPlanDetailsInput = {};
  if (data.name !== undefined) {
    fields.name = data.name;
  }
  if (data.plan !== undefined) {
    fields.plan = data.plan;
  }
  if (data.isDevShop !== undefined) {
    fields.isDevShop = data.isDevShop;
  }
  await prisma.shop.upsert({
    where: { shopDomain },
    update: fields,
    create: { shopDomain, ...fields },
  });
}

export async function countFunctionRules(shopId: string): Promise<number> {
  return prisma.shippingRule.count({
    where: { shopId, enabled: true, kind: { in: ["HIDE", "RENAME", "MOVE"] } },
  });
}

/** Whether the mirrored config is stale relative to any config row (banner flag, spec 002 criterion 9). */
export async function isFunctionSyncStale(shop: {
  id: string;
  functionSyncedAt: Date | null;
}): Promise<boolean> {
  if (!shop.functionSyncedAt) {
    const hasRows = await prisma.shippingRule.count({ where: { shopId: shop.id } }) > 0
      || await prisma.zone.count({ where: { shopId: shop.id } }) > 0;
    return hasRows;
  }
  const newer = await prisma.shippingRule.findFirst({
    where: { shopId: shop.id, updatedAt: { gt: shop.functionSyncedAt } },
    select: { id: true },
  });
  if (newer) {
    return true;
  }
  return (await prisma.zone.findFirst({
    where: { shopId: shop.id, updatedAt: { gt: shop.functionSyncedAt } },
    select: { id: true },
  })) !== null;
}

export { Prisma };
