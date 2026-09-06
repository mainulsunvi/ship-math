/**
 * Rule repositories (plan 004/005 Task 3) — the ONLY Prisma writers for
 * ShippingRule rows. Deliberately boring:
 *   - no admin API access,
 *   - no pushFunctionConfig and no AuditLog writes — route actions own that
 *     orchestration (Prisma first, then owner ensure, mirror push, audit;
 *     architecture §A1).
 * Every write entry point validates its input with StoredRuleSchema.
 */

import prisma, { Prisma } from "../../db.server";
import { StoredRuleSchema, type RuleInput } from "../config-schema";
import type { ShippingRule, Zone } from "@prisma/client";

/** Spec 005 criterion 7: the rules table paginates at 50 rows per page. */
const PAGE_SIZE = 50;

/**
 * Stable evaluation order used everywhere (list, neighbor lookup, tie-breaks):
 * priority asc, then createdAt asc, then id asc.
 */
const RULE_ORDER: Prisma.ShippingRuleOrderByWithRelationInput[] = [
  { priority: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

export async function listRules(shopId: string, page = 1): Promise<{ rules: ShippingRule[]; total: number }> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const [rules, total] = await prisma.$transaction([
    prisma.shippingRule.findMany({
      where: { shopId },
      orderBy: RULE_ORDER,
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.shippingRule.count({ where: { shopId } }),
  ]);
  return { rules, total };
}

/** A zone can only be referenced by rules of the same shop. */
async function assertZoneInShop(shopId: string, zoneId: string): Promise<void> {
  const zone = await prisma.zone.findFirst({ where: { id: zoneId, shopId }, select: { id: true } });
  if (!zone) {
    throw new Error(`Zone ${zoneId} does not exist in shop ${shopId}`);
  }
}

export async function createRule(shopId: string, input: RuleInput): Promise<ShippingRule> {
  const parsed = StoredRuleSchema.parse(input);
  if (parsed.zoneId !== null && parsed.zoneId !== undefined) {
    await assertZoneInShop(shopId, parsed.zoneId);
  }
  return prisma.shippingRule.create({
    data: {
      shopId,
      name: parsed.name,
      kind: parsed.kind,
      priority: parsed.priority,
      stopOnMatch: parsed.stopOnMatch,
      zoneId: parsed.zoneId ?? null,
      conditions: JSON.stringify(parsed.conditions),
      action: JSON.stringify(parsed.action),
    },
  });
}

export async function updateRule(shopId: string, id: string, input: RuleInput): Promise<ShippingRule> {
  const existing = await prisma.shippingRule.findFirst({ where: { id, shopId }, select: { id: true } });
  if (!existing) {
    throw new Error(`ShippingRule ${id} does not exist in shop ${shopId}`);
  }
  const parsed = StoredRuleSchema.parse(input);
  if (parsed.zoneId !== null && parsed.zoneId !== undefined) {
    await assertZoneInShop(shopId, parsed.zoneId);
  }
  return prisma.shippingRule.update({
    where: { id },
    data: {
      name: parsed.name,
      kind: parsed.kind,
      priority: parsed.priority,
      stopOnMatch: parsed.stopOnMatch,
      zoneId: parsed.zoneId ?? null,
      conditions: JSON.stringify(parsed.conditions),
      action: JSON.stringify(parsed.action),
    },
  });
}

/**
 * Idempotent by design: deleting an already-deleted (or foreign) id is a
 * no-op so a double-submitted fetcher never errors. Zone deletion (zone
 * repositories, Task 2) relies on the rules.zoneId SetNull cascade, which
 * already exists in prisma/schema.prisma — verified, no migration needed.
 */
export async function deleteRule(shopId: string, id: string): Promise<void> {
  await prisma.shippingRule.deleteMany({ where: { id, shopId } });
}

/**
 * Duplicate (spec 005 criterion 3): copy named "<name> (copy)", enabled:
 * false, inserted DIRECTLY AFTER the source in evaluation order.
 *
 * Exact insertion rule (documented per plan; tested in
 * app/lib/repositories/__tests__/rules.test.ts). Let s = source.priority and
 * n = the smallest priority strictly greater than s in the shop (i.e. the
 * first rule after the source's priority band in RULE_ORDER):
 *   - No such rule exists, or n >= s + 2 (a free gap): insert at s + 1.
 *     With no rule above the band, s + 1 still lands after the whole band,
 *     hence after the source in stable order.
 *   - n === s + 1 (no gap): shift — increment priority by 1 for every rule of
 *     the shop with priority >= s + 1, then insert at s + 1.
 * Rules tying with the source at priority s keep their priority; the copy
 * lands after the whole tie group (integer priorities cannot express a finer
 * position without shifting the group itself, which the gap/shift rule above
 * deliberately avoids for the source's own band).
 */
export async function duplicateRule(shopId: string, id: string): Promise<ShippingRule> {
  const source = await prisma.shippingRule.findFirst({ where: { id, shopId } });
  if (!source) {
    throw new Error(`ShippingRule ${id} does not exist in shop ${shopId}`);
  }
  // Re-validate the stored row through StoredRuleSchema as a write-path backstop.
  const parsed = StoredRuleSchema.parse({
    name: source.name,
    kind: source.kind,
    priority: source.priority,
    stopOnMatch: source.stopOnMatch,
    zoneId: source.zoneId,
    conditions: JSON.parse(source.conditions),
    action: JSON.parse(source.action),
  });
  const sourcePriority = source.priority;
  const next = await prisma.shippingRule.findFirst({
    where: { shopId, priority: { gt: sourcePriority } },
    orderBy: RULE_ORDER,
    select: { priority: true },
  });
  const needsShift = next !== null && next.priority === sourcePriority + 1;
  return prisma.$transaction(async function duplicateTransaction(tx) {
    if (needsShift) {
      await tx.shippingRule.updateMany({
        where: { shopId, priority: { gte: sourcePriority + 1 } },
        data: { priority: { increment: 1 } },
      });
    }
    return tx.shippingRule.create({
      data: {
        shopId,
        name: `${source.name} (copy)`,
        enabled: false,
        kind: parsed.kind,
        priority: sourcePriority + 1,
        stopOnMatch: parsed.stopOnMatch,
        zoneId: parsed.zoneId ?? null,
        conditions: JSON.stringify(parsed.conditions),
        action: JSON.stringify(parsed.action),
      },
    });
  });
}

export async function setRuleEnabled(shopId: string, id: string, enabled: boolean): Promise<void> {
  await prisma.shippingRule.updateMany({ where: { id, shopId }, data: { enabled } });
}

/**
 * Swap the rule with its evaluation-order neighbor ("up" = earlier in RULE_ORDER).
 *
 * Tie rule (documented per plan; tested in app/lib/repositories/__tests__/rules.test.ts):
 *   - Different priority bands: the two rules exchange priority values. The
 *     mover keeps its createdAt, so it enters the neighbor's band wherever the
 *     createdAt tiebreaker places it.
 *   - Same priority (tie): exchanging equal priorities would be a no-op, so
 *     the tie is broken with the createdAt tiebreaker — the mover's createdAt
 *     is nudged 1ms across its neighbor's (neighbor.createdAt ∓ 1ms, minus
 *     when moving up, plus when moving down). Priorities stay untouched and
 *     exactly the two rows swap in (priority, createdAt, id) order.
 *   - Already first/last: no-op, not an error.
 */
export async function swapPriority(shopId: string, id: string, dir: "up" | "down"): Promise<void> {
  const ordered = await prisma.shippingRule.findMany({
    where: { shopId },
    orderBy: RULE_ORDER,
    select: { id: true, priority: true, createdAt: true },
  });
  const index = ordered.findIndex(function isSource(rule) {
    return rule.id === id;
  });
  if (index === -1) {
    throw new Error(`ShippingRule ${id} does not exist in shop ${shopId}`);
  }
  const neighborIndex = dir === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) {
    return; // already at the edge — nothing to swap
  }
  const source = ordered[index];
  const neighbor = ordered[neighborIndex];
  if (source.priority !== neighbor.priority) {
    await prisma.$transaction([
      prisma.shippingRule.update({ where: { id: source.id }, data: { priority: neighbor.priority } }),
      prisma.shippingRule.update({ where: { id: neighbor.id }, data: { priority: source.priority } }),
    ]);
    return;
  }
  const neighborMs = neighbor.createdAt.getTime();
  await prisma.shippingRule.update({
    where: { id: source.id },
    data: { createdAt: new Date(dir === "up" ? neighborMs - 1 : neighborMs + 1) },
  });
}

/** Global FIRST_MATCH vs ALL_MATCH behaviour (spec 005 criterion 5). */
export async function setEvaluationMode(shopId: string, mode: "FIRST_MATCH" | "ALL_MATCH"): Promise<void> {
  await prisma.shop.update({ where: { id: shopId }, data: { evaluationMode: mode } });
}

/** Newest zones first — matches the zones-page loader order (plan Task 2). */
export async function listZones(shopId: string): Promise<Zone[]> {
  return prisma.zone.findMany({ where: { shopId }, orderBy: [{ createdAt: "desc" }] });
}
