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

function parseConditionsField(
  formData: FormData,
): { ok: true; value: RuleInput["conditions"] } | { ok: false; message: string } {
  try {
    const result = ConditionGroupSchema.safeParse(JSON.parse(String(formData.get("conditions") ?? "null")));
    if (!result.success) {
      return { ok: false, message: `Conditions failed validation: ${zodIssuesText(result.error)}` };
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
    const result =
      kind === "CARRIER_RATE"
        ? CarrierRateActionSchema.safeParse(rawAction)
        : ActionSchema.safeParse(rawAction);
    if (!result.success) {
      return { ok: false, message: `Action failed validation: ${zodIssuesText(result.error)}` };
    }
    return { ok: true, value: result.data as RuleInput["action"] };
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
