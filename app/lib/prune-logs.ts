/**
 * RequestLog helpers shared by the carrier callback (007) and the simulator
 * (008): opportunistic 30-day retention sweep + stable input digest.
 *
 * Retention (spec 008): rows older than 30 days disappear following any new
 * insert — no cron. The sweep runs on ~1-in-20 inserts (pruneIfDue), so the
 * hot callback path stays cold and the cost amortizes naturally. The sweep
 * is idempotent: running it twice in a row is harmless.
 */

import prisma from "../db.server";

const PRUNE_CHANCE = 0.05; // ~1-in-20 inserts
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Roll the dice for the opportunistic prune (pure, testable). */
export function pruneIfDue(): boolean {
  return Math.random() < PRUNE_CHANCE;
}

/** Delete this shop's RequestLog rows older than 30 days. Returns the count. */
export async function pruneRequestLogs(shopId: string): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const result = await prisma.requestLog.deleteMany({
    where: { shopId, createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Stable digest of the normalized input (no crypto need — dedup/debug key
 * for the AI debugging direction, spec 018).
 */
export function inputDigestFor(input: unknown): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url").slice(0, 32);
}
