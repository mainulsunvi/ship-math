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
  Badge,
} from "@shopify/polaris";
import { DeleteIcon, EditIcon } from "@shopify/polaris-icons";
import { CarrierRateActionSchema } from "../../lib/carrier/action-schema";
import {
  ActionSchema,
  ConditionGroupSchema,
  RuleKindSchema,
  normalizeFunctionActions,
  type ConditionGroup,
  type RuleKind,
} from "../../lib/config-schema";
import type { ZodIssue } from "zod";
import {
  buildCarrierAction,
  buildFunctionAction,
  describeCarrierDraft,
  describeFunctionDraft,
  draftFromCarrierAction,
  draftFromFunctionAction,
  makeDefaultCarrierDraft,
  type CarrierDraft,
  type FunctionActionDraft,
} from "./ActionEditor";
import ActionModal from "./ActionModal";
import ConditionGroupEditor, { sanitizeConditionsForKind } from "./ConditionGroupEditor";
import KindChip from "./KindChip";
import SettingToggle from "../ui/SettingToggle";
import HelpTooltip from "../ui/HelpTooltip";

/**
 * Spec 021 scenario rule builder. ONE component for create (/app/rules/new)
 * and edit (/app/rules/:uid/edit) per the user decision of 2026-09-07.
 *
 * Structure (user directive 2026-09-09: condition + action forms live in
 * modals; card flow improvised per spec 021 §6; 2026-09-11: no kind select —
 * the FIRST action's "What the rule does" picker IS the kind):
 *   - Basics card: name / priority / zone / stop on match
 *   - Conditions card: tier selector (Basic today, Advanced coming soon)
 *     + the chip builder (ConditionGroupEditor + ConditionModal)
 *   - Then card: ordered action chips, each edited in the ActionModal
 *   - Else card (function kinds): optional actions that run when the
 *     conditions do NOT match; serialized as { actions, elseActions }
 *   - Carrier kind keeps the single rate action edited in the ActionModal
 */

const NO_ZONE_VALUE = "";

function toConditionGroup(input: unknown): ConditionGroup {
  const parsed = ConditionGroupSchema.safeParse(input);
  if (parsed.success) {
    const candidate = parsed.data as unknown as ConditionGroup;
    if (Array.isArray(candidate.conditions)) {
      return {
        combinator:
          candidate.combinator === "OR" || candidate.combinator === "NONE"
            ? candidate.combinator
            : "AND",
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

function RuleFormSection({ label, help, divider, children }: {
  label: string;
  /** Optional longer explanation, shown through the HelpTooltip icon. */
  help?: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <BlockStack gap="400">
      {divider ? (
        <Box borderBlockStartWidth="025" borderColor="border" />
      ) : null}
      <InlineStack gap="100" blockAlign="center">
        <Text as="h3" variant="headingSm">
          {label}
        </Text>
        {help ? <HelpTooltip content={help} /> : null}
      </InlineStack>
      {children}
    </BlockStack>
  );
}

interface ActionModalState {
  open: boolean;
  branch: 0 | 1;
  editMode: "create" | "edit";
  index?: number;
}

const CLOSED_ACTION_MODAL: ActionModalState = { open: false, branch: 0, editMode: "create" };

function initialDraftsFor(kind: RuleKind, action: unknown, isCreate: boolean): {
  then: FunctionActionDraft[];
  else: FunctionActionDraft[];
} {
  // No seeding: the first action the merchant adds (and its "What the rule
  // does" picker) decides the kind, so a fresh form starts genuinely empty.
  if (isCreate || kind === "CARRIER_RATE") {
    return { then: [], else: [] };
  }
  const wrapper = normalizeFunctionActions(action);
  const then = wrapper.actions.map(function toDraft(entry: unknown) {
    return draftFromFunctionAction(entry);
  });
  const elseBranch = wrapper.elseActions.map(function toDraft(entry: unknown) {
    return draftFromFunctionAction(entry);
  });
  return { then, else: elseBranch };
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
  const [thenDrafts, setThenDrafts] = useState<FunctionActionDraft[]>(function initThen() {
    return initialDraftsFor(
      RuleKindSchema.safeParse(initial?.kind).success
        ? (RuleKindSchema.parse(initial?.kind) as RuleKind)
        : "HIDE",
      initial?.action,
      mode === "create",
    ).then;
  });
  const [elseDrafts, setElseDrafts] = useState<FunctionActionDraft[]>(function initElse() {
    return initialDraftsFor(
      RuleKindSchema.safeParse(initial?.kind).success
        ? (RuleKindSchema.parse(initial?.kind) as RuleKind)
        : "HIDE",
      initial?.action,
      mode === "create",
    ).else;
  });
  const [carrierDraft, setCarrierDraft] = useState<CarrierDraft>(function initCarrierDraft() {
    return kind === "CARRIER_RATE" ? draftFromCarrierAction(initial?.action) : makeDefaultCarrierDraft();
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [actionModal, setActionModal] = useState<ActionModalState>(CLOSED_ACTION_MODAL);
  const [carrierModalOpen, setCarrierModalOpen] = useState(false);

  // The kind is derived from the actions (2026-09-11): it is locked while
  // any then/else draft or a saved rate exists, and re-choosable inside the
  // ActionModal once the rule has no actions at all.
  const carrierConfigured = kind === "CARRIER_RATE" && carrierDraft.serviceName.trim() !== "";
  const actionsLocked = thenDrafts.length > 0 || elseDrafts.length > 0 || carrierConfigured;

  function applyKind(nextKind: RuleKind) {
    setKind(nextKind);
    // §A3: switching to CARRIER_RATE drops conditions it can never evaluate.
    setConditions(function prune(current: ConditionGroup) {
      return sanitizeConditionsForKind(current, nextKind);
    });
  }

  function removeCarrierRate() {
    setCarrierDraft(makeDefaultCarrierDraft());
    setKind("HIDE");
  }

  function openActionModal(branch: 0 | 1, editMode: "create" | "edit", index?: number) {
    setActionModal({ open: true, branch, editMode, index });
  }

  function handleActionModalSaved(payload: {
    kind: RuleKind;
    functionDraft: FunctionActionDraft;
    carrierDraft: CarrierDraft;
  }) {
    const { branch, editMode, index } = actionModal;
    // The modal's kind choice is the rule's kind (the picker only shows
    // while the rule has no actions, so no existing draft is invalidated).
    if (payload.kind === "CARRIER_RATE") {
      applyKind("CARRIER_RATE");
      setCarrierDraft(payload.carrierDraft);
      setActionModal(CLOSED_ACTION_MODAL);
      return;
    }
    if (payload.kind !== kind) {
      applyKind(payload.kind);
    }
    if (editMode === "edit" && typeof index === "number") {
      const next = (branch === 0 ? thenDrafts : elseDrafts).slice();
      next[index] = payload.functionDraft;
      if (branch === 0) {
        setThenDrafts(next);
      } else {
        setElseDrafts(next);
      }
    } else if (branch === 0) {
      setThenDrafts([...thenDrafts, payload.functionDraft]);
    } else {
      setElseDrafts([...elseDrafts, payload.functionDraft]);
    }
    setActionModal(CLOSED_ACTION_MODAL);
  }

  function removeDraft(branch: 0 | 1, index: number) {
    if (branch === 0) {
      setThenDrafts(
        thenDrafts.filter(function keep(_, position) {
          return position !== index;
        }),
      );
    } else {
      setElseDrafts(
        elseDrafts.filter(function keep(_, position) {
          return position !== index;
        }),
      );
    }
  }

  function renderActionChips(branch: 0 | 1) {
    const drafts = branch === 0 ? thenDrafts : elseDrafts;
    if (drafts.length === 0) {
      return (
        <Text as="span" variant="bodySm" tone="subdued">
          {branch === 0
            ? "No actions yet. Add at least one."
            : "No else actions. Else is optional."}
        </Text>
      );
    }
    return (
      <BlockStack gap="150">
        {drafts.map(function renderChip(draft, index) {
          return (
            <div className="sm-rule-chip" key={`${branch}-${index}`}>
              <span className="sm-rule-chip__index">{index + 1}</span>
              <span className="sm-rule-chip__label">{describeFunctionDraft(kind, draft)}</span>
              <Button
                icon={EditIcon}
                variant="plain"
                accessibilityLabel="Edit action"
                onClick={function edit() {
                  openActionModal(branch, "edit", index);
                }}
                disabled={busy}
              />
              <Button
                icon={DeleteIcon}
                variant="plain"
                tone="critical"
                accessibilityLabel="Remove action"
                onClick={function remove() {
                  removeDraft(branch, index);
                }}
                disabled={busy}
              />
            </div>
          );
        })}
      </BlockStack>
    );
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
      // THEN branch (min 1 action, in chip order).
      const thenActions: unknown[] = [];
      thenDrafts.forEach(function build(draft, index) {
        const built = buildFunctionAction(kind, draft);
        if (built.action === null) {
          collected.push(...built.errors.map(function prefix(message: string) {
            return `Then action ${index + 1}: ${message}`;
          }));
          return;
        }
        const check = ActionSchema.safeParse(built.action);
        if (!check.success) {
          collected.push(`Then action ${index + 1}: the action is incomplete.`);
          return;
        }
        thenActions.push(built.action);
      });
      if (thenActions.length === 0 && thenDrafts.length === 0) {
        collected.push("Add at least one action for the Then branch.");
      }

      // ELSE branch (optional, also in chip order).
      const elseActions: unknown[] = [];
      elseDrafts.forEach(function build(draft, index) {
        const built = buildFunctionAction(kind, draft);
        if (built.action === null) {
          collected.push(...built.errors.map(function prefix(message: string) {
            return `Else action ${index + 1}: ${message}`;
          }));
          return;
        }
        const check = ActionSchema.safeParse(built.action);
        if (!check.success) {
          collected.push(`Else action ${index + 1}: the action is incomplete.`);
          return;
        }
        elseActions.push(built.action);
      });

      actionValue = { actions: thenActions, elseActions };
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
          <Banner tone="critical" title="Fix Before Saving">
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
            {mode === "create" ? "New Rule" : "Edit Rule"}
          </Text>
          {actionsLocked ? <KindChip kind={kind} /> : null}
        </InlineStack>

        <RuleFormSection label="Basics">
          <InlineStack gap="300" wrap>
            <TextField
              label="Rule name"
              helpText="Enter a Rule name for reference."
              autoComplete="off"
              value={name}
              onChange={setName}
              disabled={busy}
            />
            <TextField
              label="Priority"
              type="number"
              min={0}
              autoComplete="off"
              value={priority}
              onChange={setPriority}
              helpText="Rules with lower numbers run first."
              disabled={busy}
            />
            <Select
              label="Zone"
              options={zoneOptions}
              value={zoneId}
              onChange={setZoneId}
              helpText="Optional. Limits the rule to destinations inside the zone."
              disabled={busy}
            />
          </InlineStack>
          <SettingToggle
            label="Stop on match"
            helpText='With the in  evaluation mode, rules after this one are skipped once it matches.'
            enabled={stopOnMatch}
            disabled={busy}
            onChange={setStopOnMatch}
          />
        </RuleFormSection>

        <RuleFormSection
          label="Conditions"
          help="The rule runs its Then actions only when these conditions match. An empty group matches every checkout."
          divider
        >
          <InlineStack gap="300" wrap blockAlign="stretch">
            <div className="sm-tier-card sm-tier-card--selected">
              <InlineStack gap="200" blockAlign="center">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Basic
                </Text>
                <Badge tone="info">Selected</Badge>
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                Cart, product, customer, and date and time fields.
              </Text>
            </div>
            <div className="sm-tier-card sm-tier-card--disabled">
              <InlineStack gap="200" blockAlign="center">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Advanced
                </Text>
                <Badge>Coming soon</Badge>
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                Line item properties, discount codes, and more.
              </Text>
            </div>
          </InlineStack>
          <ConditionGroupEditor
            group={conditions}
            depth={1}
            ruleKind={kind}
            disabled={busy}
            onChange={setConditions}
          />
        </RuleFormSection>

        {kind === "CARRIER_RATE" ? (
          <RuleFormSection
            label="Rate"
            help="The rate this rule offers through the carrier lane when the conditions match."
            divider
          >
            <BlockStack gap="200">
              {carrierDraft.serviceName.trim() !== "" || carrierDraft.serviceCode.trim() !== "" ? (
                <div className="sm-rule-chip">
                  <span className="sm-rule-chip__label">{describeCarrierDraft(carrierDraft)}</span>
                  <Button
                    icon={EditIcon}
                    variant="plain"
                    accessibilityLabel="Edit rate"
                    onClick={function edit() {
                      setCarrierModalOpen(true);
                    }}
                    disabled={busy}
                  />
                  <Button
                    icon={DeleteIcon}
                    variant="plain"
                    tone="critical"
                    accessibilityLabel="Remove rate"
                    onClick={removeCarrierRate}
                    disabled={busy}
                  />
                </div>
              ) : null}
              <Button
                variant="plain"
                onClick={function openCarrier() {
                  setCarrierModalOpen(true);
                }}
                disabled={busy}
              >
                + Set rate
              </Button>
            </BlockStack>
          </RuleFormSection>
        ) : (
          <>
            <RuleFormSection
              label="Then"
              help="Actions run in order when the conditions match. A later rename overwrites an earlier one."
              divider
            >
              {renderActionChips(0)}
              <InlineStack gap="300">
                <Button
                  variant="plain"
                  onClick={function add() {
                    openActionModal(0, "create");
                  }}
                  disabled={busy}
                >
                  + Add action
                </Button>
              </InlineStack>
            </RuleFormSection>

            <div className="sm-else-connector">
              <Text as="span" variant="bodySm" tone="subdued">
                When the conditions do not match:
              </Text>
            </div>

            <RuleFormSection label="Else" help="Optional actions that run when the conditions do not match.">
              {renderActionChips(1)}
              <InlineStack gap="300">
                <Button
                  variant="plain"
                  onClick={function add() {
                    openActionModal(1, "create");
                  }}
                  disabled={busy}
                >
                  + Add else action
                </Button>
              </InlineStack>
            </RuleFormSection>
          </>
        )}

        <Box
          borderBlockStartWidth="025"
          borderColor="border"
          paddingBlockStart="400"
        >
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

      <ActionModal
        open={actionModal.open}
        mode={actionModal.editMode}
        kind={kind}
        allowKindChange={!actionsLocked}
        initialFunction={
          actionModal.editMode === "edit" && typeof actionModal.index === "number"
            ? (actionModal.branch === 0 ? thenDrafts : elseDrafts)[actionModal.index]
            : undefined
        }
        onClose={function close() {
          setActionModal(CLOSED_ACTION_MODAL);
        }}
        onSaved={handleActionModalSaved}
      />
      {kind === "CARRIER_RATE" ? (
        <ActionModal
          open={carrierModalOpen}
          mode={carrierDraft.serviceName.trim() !== "" ? "edit" : "create"}
          kind="CARRIER_RATE"
          initialCarrier={carrierDraft}
          onClose={function close() {
            setCarrierModalOpen(false);
          }}
          onSaved={function saveCarrier(payload: {
            kind: RuleKind;
            carrierDraft: CarrierDraft;
          }) {
            setCarrierDraft(payload.carrierDraft);
            setCarrierModalOpen(false);
          }}
        />
      ) : null}
    </Card>
  );
}

