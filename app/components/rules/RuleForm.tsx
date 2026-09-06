import { useState } from "react";
import {
  Banner,
  BlockStack,
  InlineStack,
  Select,
  Text,
  TextField,
  Button,
  Card,
  Box,
} from "@shopify/polaris";
import { CarrierRateActionSchema } from "../../lib/carrier/action-schema";
import {
  ActionSchema,
  ConditionGroupSchema,
  RuleKindSchema,
  type ConditionGroup,
  type RuleKind,
} from "../../lib/config-schema";
import type { ZodIssue } from "zod";
import ActionEditor, {
  buildCarrierAction,
  buildFunctionAction,
  draftFromCarrierAction,
  draftFromFunctionAction,
  makeDefaultCarrierDraft,
  makeDefaultFunctionDraft,
  type CarrierDraft,
  type FunctionActionDraft,
} from "./ActionEditor";
import ConditionGroupEditor, { sanitizeConditionsForKind } from "./ConditionGroupEditor";
import KindChip from "./KindChip";
import SettingToggle from "../ui/SettingToggle";

/**
 * Reusable rule form — ONE component for both create (/app/rules/new) and
 * edit (/app/routes/:uid/edit) per the user decision of 2026-09-07 (rules
 * live on routes, not modals; zones and other flows stay modal-based).
 * The draft state + validation were carried over VERBATIM from the original
 * RuleEditorModal; only the shell changed (Modal → Card sections).
 */

const KIND_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Hide delivery options", value: "HIDE" },
  { label: "Rename delivery option", value: "RENAME" },
  { label: "Move delivery option", value: "MOVE" },
  { label: "Custom carrier rate (server lane)", value: "CARRIER_RATE" },
];

const NO_ZONE_VALUE = "";

function toConditionGroup(input: unknown): ConditionGroup {
  const parsed = ConditionGroupSchema.safeParse(input);
  if (parsed.success) {
    const candidate = parsed.data as unknown as ConditionGroup;
    if (Array.isArray(candidate.conditions)) {
      return {
        combinator: candidate.combinator === "OR" ? "OR" : "AND",
        conditions: candidate.conditions,
      };
    }
  }
  return { combinator: "AND", conditions: [] };
}

/** Everything the form needs to seed itself from an existing rule.
 * conditions/action are optional-only because Remix Jsonify loosens them
 * through serialization — the form treats missing as an empty group. */
export interface RuleFormInitial {
  name: string;
  kind: RuleKind;
  priority: number;
  stopOnMatch: boolean;
  zoneId: string | null;
  conditions?: unknown;
  action?: unknown;
}

export interface RuleFormSubmitInput {
  name: string;
  kind: RuleKind;
  priority: number;
  stopOnMatch: boolean;
  zoneId: string;
  conditions: ConditionGroup;
  action: unknown;
}

interface RuleFormProps {
  mode: "create" | "edit";
  zones: Array<{ id: string; name: string }>;
  initial?: RuleFormInitial;
  suggestedPriority?: number;
  submitLabel: string;
  busy: boolean;
  serverError?: string | null;
  onSubmit(input: RuleFormSubmitInput): void;
  onCancel(): void;
}

function RuleFormSection({ label, divider, children }: {
  label: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <BlockStack gap="400">
      {divider ? (
        <Box borderBlockStartWidth="025" borderColor="border" />
      ) : null}
      <Text as="h3" variant="headingSm">
        {label}
      </Text>
      {children}
    </BlockStack>
  );
}

export default function RuleForm({
  mode,
  zones,
  initial,
  suggestedPriority,
  submitLabel,
  busy,
  serverError,
  onSubmit,
  onCancel,
}: RuleFormProps) {
  const [name, setName] = useState(function initName() {
    return initial?.name ?? "";
  });
  const [kind, setKind] = useState<RuleKind>(function initKind() {
    const parsed = RuleKindSchema.safeParse(initial?.kind);
    return parsed.success ? parsed.data : "HIDE";
  });
  const [priority, setPriority] = useState(function initPriority() {
    return initial ? String(initial.priority) : String(suggestedPriority ?? 10);
  });
  const [stopOnMatch, setStopOnMatch] = useState(function initStop() {
    return initial?.stopOnMatch ?? false;
  });
  const [zoneId, setZoneId] = useState(function initZone() {
    return initial?.zoneId ?? NO_ZONE_VALUE;
  });
  const [conditions, setConditions] = useState<ConditionGroup>(function initConditions() {
    return toConditionGroup(initial?.conditions);
  });
  const [functionDraft, setFunctionDraft] = useState<FunctionActionDraft>(
    function initFunctionDraft() {
      return kind === "CARRIER_RATE" ? makeDefaultFunctionDraft() : draftFromFunctionAction(initial?.action);
    },
  );
  const [carrierDraft, setCarrierDraft] = useState<CarrierDraft>(function initCarrierDraft() {
    return kind === "CARRIER_RATE" ? draftFromCarrierAction(initial?.action) : makeDefaultCarrierDraft();
  });
  const [errors, setErrors] = useState<string[]>([]);

  function handleKindChange(next: string) {
    const nextKind = next as RuleKind;
    setKind(nextKind);
    // §A3: switching to CARRIER_RATE drops conditions it can never evaluate.
    setConditions(function prune(current: ConditionGroup) {
      return sanitizeConditionsForKind(current, nextKind);
    });
  }

  function handleSubmit() {
    const collected: string[] = [];
    const trimmedName = name.trim();
    if (trimmedName === "") {
      collected.push("Rule name is required.");
    }
    const priorityNumber = Number.parseInt(priority, 10);
    if (!Number.isFinite(priorityNumber) || priorityNumber < 0) {
      collected.push("Priority must be a whole number of 0 or more.");
    }

    let actionValue: unknown;
    if (kind === "CARRIER_RATE") {
      const built = buildCarrierAction(carrierDraft);
      if (built.action === null) {
        collected.push(...built.errors);
      } else {
        const check = CarrierRateActionSchema.safeParse(built.action);
        if (!check.success) {
          collected.push(...check.error.issues.map(function describe(issue: ZodIssue) {
            return issue.message;
          }));
        }
      }
      actionValue = built.action;
    } else {
      const built = buildFunctionAction(kind, functionDraft);
      if (built.action === null) {
        collected.push(...built.errors);
      } else {
        const check = ActionSchema.safeParse(built.action);
        if (!check.success) {
          collected.push("The action is incomplete.");
        }
      }
      actionValue = built.action;
    }

    if (collected.length > 0) {
      setErrors(collected);
      return;
    }
    setErrors([]);

    onSubmit({
      name: trimmedName,
      kind,
      priority: priorityNumber,
      stopOnMatch,
      zoneId,
      conditions,
      action: actionValue,
    });
  }

  const displayErrors = serverError ? [...errors, serverError] : errors;

  const zoneOptions = [
    { label: "No zone (all destinations)", value: NO_ZONE_VALUE },
    ...zones.map(function toOption(zone) {
      return { label: zone.name, value: zone.id };
    }),
  ];

  return (
    <Card>
      <BlockStack gap="500">
        {displayErrors.length > 0 ? (
          <Banner tone="critical" title="Fix before saving">
            <BlockStack gap="100">
              {displayErrors.map(function renderError(message, index) {
                return (
                  <Text key={index} as="p" variant="bodySm">
                    {message}
                  </Text>
                );
              })}
            </BlockStack>
          </Banner>
        ) : null}

        <InlineStack gap="200" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {mode === "create" ? "New rule" : "Edit rule"}
          </Text>
          <KindChip kind={kind} />
        </InlineStack>

        <RuleFormSection label="Basics">
          <InlineStack gap="300" wrap>
            <TextField
              label="Rule name"
              autoComplete="off"
              value={name}
              onChange={setName}
              disabled={busy}
            />
            <Select
              label="Rule kind"
              options={KIND_OPTIONS}
              value={kind}
              onChange={handleKindChange}
              disabled={busy}
            />
            <TextField
              label="Priority"
              type="number"
              min={0}
              autoComplete="off"
              value={priority}
              onChange={setPriority}
              helpText="Lower runs first."
              disabled={busy}
            />
            <Select
              label="Zone"
              options={zoneOptions}
              value={zoneId}
              onChange={setZoneId}
              helpText="Optional — narrows the rule to destinations inside the zone."
              disabled={busy}
            />
          </InlineStack>
          <SettingToggle
            label="Stop on match"
            helpText="In ALL_MATCH mode, lower-priority rules are skipped once this rule matches."
            enabled={stopOnMatch}
            disabled={busy}
            onChange={setStopOnMatch}
          />
        </RuleFormSection>

        <RuleFormSection label="IF — conditions" divider>
          <ConditionGroupEditor group={conditions} depth={1} ruleKind={kind} disabled={busy} onChange={setConditions} />
        </RuleFormSection>

        <RuleFormSection label="THEN — action" divider>
          <ActionEditor
            kind={kind}
            functionDraft={functionDraft}
            carrierDraft={carrierDraft}
            disabled={busy}
            onFunctionChange={setFunctionDraft}
            onCarrierChange={setCarrierDraft}
          />
        </RuleFormSection>

        <Box borderBlockStartWidth="025" borderColor="border" paddingBlockStart="400">
          <InlineStack gap="300" align="end">
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} loading={busy}>
              {submitLabel}
            </Button>
          </InlineStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
