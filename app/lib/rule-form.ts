/**
 * Shared rule-form parsing (005 rules-on-routes review SHOULD finding):
 * ONE parser for every route that accepts the RuleForm payload — the wizard
 * draft intent on /app, /app/rules/new, and /app/rules/:uid/edit. Extraction
 * mirrors the zone-form.ts precedent; behavior is byte-identical to the
 * three copies it replaces.
 */

import { z } from "zod";
import { CarrierRateActionSchema } from "./carrier/action-schema";
import {
  ActionSchema,
  ConditionGroupSchema,
  RuleKindSchema,
  normalizeFunctionActions,
  type RuleInput,
  type RuleKind,
} from "./config-schema";

export function zodIssuesText(error: z.ZodError): string {
  return error.issues
    .map(function describe(issue) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

/** Spec 021: NONE is root-only — nested groups using it are rejected here
 * (the StoredRuleSchema superRefine is the backstop). */
function findNestedNone(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }
  const entry = node as { combinator?: unknown; conditions?: unknown };
  if (!Array.isArray(entry.conditions)) {
    return false;
  }
  for (const child of entry.conditions) {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      continue;
    }
    const childEntry = child as { combinator?: unknown };
    if (childEntry.combinator === "NONE" || findNestedNone(child)) {
      return true;
    }
  }
  return false;
}

function parseConditionsField(
  formData: FormData,
): { ok: true; value: RuleInput["conditions"] } | { ok: false; message: string } {
  try {
    const raw = JSON.parse(String(formData.get("conditions") ?? "null"));
    const result = ConditionGroupSchema.safeParse(raw);
    if (!result.success) {
      return { ok: false, message: `Conditions failed validation: ${zodIssuesText(result.error)}` };
    }
    if (findNestedNone(raw)) {
      return {
        ok: false,
        message: 'The "none" match type can only be used at the top level of the conditions.',
      };
    }
    return { ok: true, value: result.data as RuleInput["conditions"] };
  } catch {
    return { ok: false, message: "Conditions are not valid JSON." };
  }
}

function parseActionField(
  kind: RuleKind,
  formData: FormData,
): { ok: true; value: RuleInput["action"] } | { ok: false; message: string } {
  try {
    const rawAction: unknown = JSON.parse(String(formData.get("action") ?? "null"));
    if (kind === "CARRIER_RATE") {
      const result = CarrierRateActionSchema.safeParse(rawAction);
      if (!result.success) {
        return { ok: false, message: `Action failed validation: ${zodIssuesText(result.error)}` };
      }
      return { ok: true, value: result.data as RuleInput["action"] };
    }
    // Spec 021: function kinds carry the { actions, elseActions } wrapper;
    // a legacy single-action payload still parses (normalized to one
    // then-action) so old callers (wizard intents) keep working.
    const normalized = normalizeFunctionActions(rawAction);
    if (normalized.actions.length === 0 || !normalized.actions.every(function valid(action) {
      return ActionSchema.safeParse(action).success;
    })) {
      return { ok: false, message: "Action failed validation: at least one complete action is required." };
    }
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, message: "Action is not valid JSON." };
  }
}

export type RuleFormParse = { ok: true; input: RuleInput } | { ok: false; message: string };

export function parseRuleForm(formData: FormData): RuleFormParse {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    return { ok: false, message: "Rule name is required." };
  }
  const kindResult = RuleKindSchema.safeParse(String(formData.get("kind") ?? ""));
  if (!kindResult.success) {
    return { ok: false, message: "Unknown rule kind." };
  }
  const priority = Number.parseInt(String(formData.get("priority") ?? ""), 10);
  if (!Number.isFinite(priority) || priority < 0) {
    return { ok: false, message: "Priority must be a whole number of 0 or more." };
  }
  const conditions = parseConditionsField(formData);
  if (!conditions.ok) {
    return conditions;
  }
  const action = parseActionField(kindResult.data, formData);
  if (!action.ok) {
    return action;
  }
  const input: RuleInput = {
    name,
    kind: kindResult.data,
    priority,
    stopOnMatch: formData.get("stopOnMatch") === "1",
    zoneId: String(formData.get("zoneId") ?? "").trim() || null,
    conditions: conditions.value,
    action: action.value,
  };
  return { ok: true, input };
}
