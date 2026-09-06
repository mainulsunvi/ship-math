/**
 * AuditLog writer (architecture §A1 — orchestration step 4, owned by route
 * actions). Fail-open by design: an audit failure must never break the
 * merchant mutation that produced it, so nothing here ever throws.
 *
 * Actions call this AFTER the Prisma write and the mirror push, with
 * before/after snapshots that land in the changeSet JSON column.
 */

import prisma from "../db.server";

export type AuditActor = "MERCHANT" | "AI" | "SYSTEM";

export async function writeAudit(
  shopId: string,
  actor: AuditActor,
  summary: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        shopId,
        actor,
        summary,
        changeSet: JSON.stringify({ before: before ?? null, after: after ?? null }),
      },
    });
  } catch (error) {
    // Fail-open: log and continue — the mutation itself already committed.
    console.error(`writeAudit failed (fail-open) for shop ${shopId}:`, error);
  }
}
