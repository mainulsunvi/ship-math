import { json } from "@remix-run/node";
import type { ShippingRule } from "@prisma/client";
import prisma from "../db.server";
import { syncAfterOwnerEnsure, type MirrorSyncReport } from "./sync";
import { writeAudit } from "./audit";
import {
  deleteRule,
  duplicateRule,
  setRuleEnabled,
  swapPriority,
} from "./repositories/rules";
import {
  ConditionGroupSchema,
  RuleKindSchema,
} from "./config-schema";
import type { RuleRow } from "../components/rules/RulesTable";

/**
 * Shared handlers for the rule-table mutations (toggle / delete / duplicate /
 * priority) and the ShippingRule → RuleRow mapping, used by BOTH the
 * dashboard (/app) and the rules page (/app/rules, 2026-09-11) so the two
 * tables can never drift (architecture §A4 spirit; extraction mirrors the
 * 005 review's parseRuleForm lift).
 *
 * Load-bearing order for every rule mutation (architecture §A1):
 *   1. repository call (Prisma, source of truth)
 *   2. ensureFunctionOwner
 *   3. pushFunctionConfig — failures become a sync REPORT, never a throw
 *   4. writeAudit (fail-open)
 */

export type AdminApiClient = Parameters<typeof syncAfterOwnerEnsure>[0];

export interface RuleTableActionReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
}

/** Mirrors the repository page size used by listRules (spec 005 criterion 7). */
export const RULES_PAGE_SIZE = 50;

function parseConditionGroup(raw: string): unknown {
  try {
    const result = ConditionGroupSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { combinator: "AND", conditions: [] };
  } catch {
    return { combinator: "AND", conditions: [] };
  }
}

function parseActionJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function toRuleRow(rule: ShippingRule): RuleRow {
  const kindResult = RuleKindSchema.safeParse(rule.kind);
  return {
    id: rule.id,
    uid: rule.uid ?? undefined,
    name: rule.name,
    kind: kindResult.success ? kindResult.data : "HIDE",
    enabled: rule.enabled,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    zoneId: rule.zoneId,
    conditions: parseConditionGroup(rule.conditions),
    action: parseActionJson(rule.action),
  };
}

export async function handleRuleDelete(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true, kind: true, priority: true },
  });
  if (!existing) {
    return json<RuleTableActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  await deleteRule(shopId, id);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Deleted rule "${existing.name}"`, existing, null);
  return json<RuleTableActionReply>({ ok: true, sync });
}

export async function handleRuleDuplicate(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return json<RuleTableActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  const copy = await duplicateRule(shopId, id);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Duplicated rule "${existing.name}" as "${copy.name}" (disabled, adjacent priority)`,
    { id: existing.id },
    { id: copy.id, name: copy.name, enabled: copy.enabled, priority: copy.priority },
  );
  return json<RuleTableActionReply>({ ok: true, sync });
}

export async function handleRuleToggle(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const next = formData.get("value") === "1";
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true, enabled: true },
  });
  if (!existing) {
    return json<RuleTableActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  await setRuleEnabled(shopId, id, next);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Rule "${existing.name}" ${next ? "enabled" : "disabled"}`,
    { enabled: existing.enabled },
    { enabled: next },
  );
  return json<RuleTableActionReply>({ ok: true, sync });
}

export async function handleRulePriority(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const dirRaw = String(formData.get("dir") ?? "");
  if (dirRaw !== "up" && dirRaw !== "down") {
    return json<RuleTableActionReply>(
      { ok: false, message: "Direction must be up or down." },
      { status: 422 },
    );
  }
  const dir: "up" | "down" = dirRaw;
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return json<RuleTableActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  await swapPriority(shopId, id, dir);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Moved rule "${existing.name}" ${dir === "up" ? "up" : "down"}`,
    { id, dir },
    null,
  );
  return json<RuleTableActionReply>({ ok: true, sync });
}
