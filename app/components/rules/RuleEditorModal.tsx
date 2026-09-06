import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
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
import type { RuleRow } from "./RulesTable";
import SettingToggle from "../ui/SettingToggle";
import ModalSection from "../ui/ModalSection";

/**
 * Create AND edit rule modal (spec 005 Task 5) — no per-rule routes per
 * docs/INSTRUCTION.md. The modal holds the full draft state and posts either
 * `rule-create` or `rule-update` to the owning route with useFetcher; the
 * route action runs the load-bearing orchestration (Prisma → ensure owner →
 * push mirror → audit) and the modal closes on an `ok` reply.
 */

const KIND_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Hide delivery options", value: "HIDE" },
  { label: "Rename delivery option", value: "RENAME" },
  { label: "Move delivery option", value: "MOVE" },
  { label: "Custom carrier rate (server lane)", value: "CARRIER_RATE" },
];

const NO_ZONE_VALUE = "";

interface FetcherReply {
  ok?: boolean;
  message?: string;
}

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

interface RuleEditorModalProps {
  /** null = create a new rule. */
  rule: RuleRow | null;
  zones: Array<{ id: string; name: string }>;
  suggestedPriority: number;
  onClose(): void;
}

export default function RuleEditorModal({
  rule,
  zones,
  suggestedPriority,
  onClose,
}: RuleEditorModalProps) {
  const fetcher = useFetcher();
  const submitResult = fetcher.data as FetcherReply | undefined;
  const busy = fetcher.state !== "idle";

  const [name, setName] = useState(function initName() {
    return rule?.name ?? "";
  });
  const [kind, setKind] = useState<RuleKind>(function initKind() {
    const parsed = RuleKindSchema.safeParse(rule?.kind);
    return parsed.success ? parsed.data : "HIDE";
  });
  const [priority, setPriority] = useState(function initPriority() {
    return rule ? String(rule.priority) : String(suggestedPriority);
  });
  const [stopOnMatch, setStopOnMatch] = useState(function initStop() {
    return rule?.stopOnMatch ?? false;
  });
  const [zoneId, setZoneId] = useState(function initZone() {
    return rule?.zoneId ?? NO_ZONE_VALUE;
  });
  const [conditions, setConditions] = useState<ConditionGroup>(function initConditions() {
    return toConditionGroup(rule?.conditions);
  });
  const [functionDraft, setFunctionDraft] = useState<FunctionActionDraft>(
    function initFunctionDraft() {
      return kind === "CARRIER_RATE" ? makeDefaultFunctionDraft() : draftFromFunctionAction(rule?.action);
    },
  );
  const [carrierDraft, setCarrierDraft] = useState<CarrierDraft>(function initCarrierDraft() {
    return kind === "CARRIER_RATE" ? draftFromCarrierAction(rule?.action) : makeDefaultCarrierDraft();
  });
  const [errors, setErrors] = useState<string[]>([]);

  // Close only after the action confirms success; failures stay visible in-modal.
  useEffect(
    function closeOnSuccess() {
      if (!busy && submitResult?.ok === true) {
        onClose();
      }
    },
    [busy, submitResult, onClose],
  );

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

    fetcher.submit(
      {
        intent: rule ? "rule-update" : "rule-create",
        ...(rule ? { id: rule.id } : {}),
        name: trimmedName,
        kind,
        priority: String(priorityNumber),
        stopOnMatch: stopOnMatch ? "1" : "0",
        zoneId,
        conditions: JSON.stringify(conditions),
        action: JSON.stringify(actionValue),
      },
      { method: "post" },
    );
  }

  const serverError =
    !busy && submitResult?.ok === false && submitResult.message
      ? submitResult.message
      : null;
  const displayErrors = serverError ? [...errors, serverError] : errors;

  const zoneOptions = [
    { label: "No zone (all destinations)", value: NO_ZONE_VALUE },
    ...zones.map(function toOption(zone) {
      return { label: zone.name, value: zone.id };
    }),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <InlineStack gap="200" blockAlign="center">
          <span>{rule ? `Edit rule — ${rule.name}` : "New rule"}</span>
          <KindChip kind={kind} />
        </InlineStack>
      }
      size="large"
      primaryAction={{ content: rule ? "Save changes" : "Create rule", onAction: handleSubmit, loading: busy }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
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
          <ModalSection label="Basics" divider={false}>
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
          </ModalSection>
          <ModalSection label="IF — conditions">
            <ConditionGroupEditor group={conditions} depth={1} ruleKind={kind} disabled={busy} onChange={setConditions} />
          </ModalSection>
          <ModalSection label="THEN — action">
            <ActionEditor
              kind={kind}
              functionDraft={functionDraft}
              carrierDraft={carrierDraft}
              disabled={busy}
              onFunctionChange={setFunctionDraft}
              onCarrierChange={setCarrierDraft}
            />
          </ModalSection>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
