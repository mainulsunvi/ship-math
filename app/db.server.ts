import { PrismaClient, Prisma } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;

// ---------------------------------------------------------------------------
// Shop repository (spec 002)
// ---------------------------------------------------------------------------

/** Idempotent shop row keyed by the myshopify domain from the session. */
export async function getOrCreateShop(shopDomain: string): Promise<{
  id: string;
  shopDomain: string;
  testMode: boolean;
  evaluationMode: string;
  functionOwnerId: string | null;
  functionSyncedAt: Date | null;
  onboardedAt: Date | null;
}> {
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) {
    return existing;
  }
  return prisma.shop.create({ data: { shopDomain } });
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
