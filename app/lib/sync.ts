/**
 * Mirror-sync step of the mutation orchestration (architecture §A1): wraps
 * pushFunctionConfig so route actions receive a REPORT instead of a throw.
 * ConfigTooLargeError and metafieldsSet failures become `{ ok: false }`
 * results that the UI surfaces as a stale/mirror banner — the Prisma write
 * (source of truth) already committed, so the action must not 500.
 *
 * Route actions own the full order: repository call → ensureFunctionOwner →
 * syncMirror (pushFunctionConfig) → writeAudit (fail-open).
 */

import { authenticate } from "../shopify.server";
import { pushFunctionConfig, ConfigTooLargeError } from "./function-config";
import { ensureFunctionOwner } from "../services/function-owner";

/**
 * The package does not re-export its admin client type; derive it from
 * `authenticate.admin` so callers pass exactly what the Remix SDK returns.
 */
type AdminApiClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

export interface MirrorSyncReport {
  ok: boolean;
  bytes?: number;
  syncedAt?: string;
  /** Tag lists that hit the ≤100-tag platform cap (pt = product, ct = customer). */
  variablesTruncated: { pt: boolean; ct: boolean };
  /** Rules excluded from the mirrored config and why (pass-through from buildFunctionConfig). */
  excluded: Array<{ ruleId: string; reason: string }>;
  /** Present when the push failed; ConfigTooLargeError messages guide the merchant. */
  error?: string;
  /** True when the failure was the 9,500-byte budget guard (§A1). */
  tooLarge?: boolean;
}

export async function syncMirror(
  admin: AdminApiClient,
  shopId: string,
): Promise<MirrorSyncReport> {
  try {
    const result = await pushFunctionConfig(admin, shopId);
    return {
      ok: true,
      bytes: result.bytes,
      syncedAt: result.syncedAt,
      variablesTruncated: result.variablesTruncated,
      excluded: result.excluded,
    };
  } catch (error) {
    // The built config is not reachable here (pushFunctionConfig builds
    // internally and ConfigTooLargeError carries only bytes), so failures
    // report neutral truncation/exclusion values.
    const variablesTruncated = { pt: false, ct: false };
    const excluded: Array<{ ruleId: string; reason: string }> = [];
    if (error instanceof ConfigTooLargeError) {
      return { ok: false, error: error.message, tooLarge: true, variablesTruncated, excluded };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      variablesTruncated,
      excluded,
    };
  }
}

/**
 * Steps 2+3 of the orchestration: guarantee the delivery customization owner
 * exists (self-heals merchant deletion), then push the mirror. Owner creation
 * can throw (scopes, GraphQL errors) — reported like a push failure so the
 * action never 500s after the Prisma commit stands.
 */
export async function syncAfterOwnerEnsure(
  admin: AdminApiClient,
  shopId: string,
): Promise<MirrorSyncReport> {
  try {
    await ensureFunctionOwner(admin, shopId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      variablesTruncated: { pt: false, ct: false },
      excluded: [],
    };
  }
  return syncMirror(admin, shopId);
}
