import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ChoiceList,
  InlineStack,
  Select,
  Text,
  Tooltip,
} from "@shopify/polaris";
import { DeleteIcon, EditIcon } from "@shopify/polaris-icons";
import type {
  Condition,
  ConditionGroup,
  RuleKind,
} from "../../lib/config-schema";
import {
  CARRIER_CONTEXT_TOOLTIP,
  CARRIER_RATE_FORBIDDEN_FIELDS,
  CLOCK_CONTEXT_TOOLTIP,
  describeCondition,
  groupUsesClockFields,
  makeDefaultCondition,
} from "./ConditionRow";
import ConditionModal from "./ConditionModal";
import { SOFT_CAP_BYTES } from "../../lib/budget";

/**
 * Spec 021 condition builder: chips + modals (user directive 2026-09-09).
 *   - Conditions render as one-line summary chips; edit opens the
 *     ConditionModal seeded with the chip, delete removes it.
 *   - "+ Add condition" opens the ConditionModal's field catalog step.
 *   - The ROOT group offers All / Any / None match types (NONE is root-only;
 *     the Zod refine in config-schema is the backstop). Nested groups keep
 *     the compact All/Any pill.
 *   - Nested sub-groups still hang off a thin left connector rail, depth
 *     capped at 3 (a deeper tree costs config bytes for zero power).
 *   - a subtle byte warning appears near ~10% of the per-shop config cap.
 */

const MAX_DEPTH = 3;
// Warn near ~10% of the per-shop config cap (SOFT_CAP_BYTES / 10 ≈ 950 bytes).
const RULE_BYTE_WARN_BYTES = Math.round(SOFT_CAP_BYTES / 10);

const COMBINATOR_OPTIONS = [
  { label: "All", value: "AND" },
  { label: "Any", value: "OR" },
];

const ROOT_MATCH_CHOICES = [
  { label: "All conditions must match", value: "AND" },
  { label: "Any condition can match", value: "OR" },
  { label: "None of the conditions match", value: "NONE" },
];

/**
 * Thin connector rail that nests sub-groups under their parent with no boxed
 * chrome. Polaris 12.27 ships no --p-color-border-strong token (verified
 * against build/esm/styles.css, the stylesheet app.tsx loads), so the
 * standard border color is the fallback; sizes stay on --p-space-* tokens.
 * Raw element because Box exposes no logical-margin props and no style prop,
 * and the rail needs left-edge styling only.
 */
const NESTED_GROUP_INDENT_STYLE: CSSProperties = {
  borderLeft: "2px solid var(--p-color-border)",
  paddingInlineStart: "var(--p-space-400)",
  marginInlineStart: "var(--p-space-100)",
};

/**
 * Nested editors fill the row next to their parent-owned remove button;
 * minWidth 0 keeps long chips from stretching the connector rail.
 */
const NESTED_CONTENT_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
};

/**
 * The AND/OR connector badge centers over the chip below it via align-self,
 * which scopes the centering to the badge alone. A BlockStack-level
 * align="center" would center the chips too (that is the trap: alignment
 * props on a stack apply to every child, not one).
 */
const CONNECTOR_BADGE_STYLE: CSSProperties = {
  alignSelf: "center",
};

/** Strip fields a rule kind cannot use (called when the kind switches). */
export function sanitizeConditionsForKind(group: ConditionGroup, kind: RuleKind): ConditionGroup {
  if (kind !== "CARRIER_RATE") {
    return group;
  }
  return pruneForbiddenFields(group);
}

function pruneForbiddenFields(group: ConditionGroup): ConditionGroup {
  const kept: Array<Condition | ConditionGroup> = [];
  for (const node of group.conditions) {
    if ("combinator" in node) {
      const pruned = pruneForbiddenFields(node);
      if (pruned.conditions.length > 0) {
        kept.push(pruned);
      }
      continue;
    }
    if (!CARRIER_RATE_FORBIDDEN_FIELDS.includes(node.field)) {
      kept.push(node);
    }
  }
  return { combinator: group.combinator, conditions: kept };
}

interface ConditionGroupEditorProps {
  group: ConditionGroup;
  depth: number;
  ruleKind: RuleKind;
  disabled?: boolean;
  onChange(next: ConditionGroup): void;
}

interface ModalState {
  open: boolean;
  mode: "create" | "edit";
  /** Edit mode: the conditions-array slot being edited. */
  index?: number;
  condition?: Condition;
}

const CLOSED_MODAL: ModalState = { open: false, mode: "create" };

export default function ConditionGroupEditor({
  group,
  depth,
  ruleKind,
  disabled,
  onChange,
}: ConditionGroupEditorProps) {
  const [modal, setModal] = useState<ModalState>(CLOSED_MODAL);
  const byteEstimate = JSON.stringify(group).length;

  // Visual partition only (flat builder look): chips render before
  // sub-groups, but every child keeps its ORIGINAL conditions index so
  // updateChild/removeChild stay bound to the same slot as before.
  const leafEntries: Array<{ node: Condition; index: number }> = [];
  const groupEntries: Array<{ node: ConditionGroup; index: number }> = [];
  group.conditions.forEach(function classifyChild(node, index) {
    if ("combinator" in node) {
      groupEntries.push({ node, index });
    } else {
      leafEntries.push({ node, index });
    }
  });

  function updateChild(index: number, next: Condition | ConditionGroup) {
    const conditions = group.conditions.slice();
    conditions[index] = next;
    onChange({ ...group, conditions });
  }

  function removeChild(index: number) {
    onChange({
      ...group,
      conditions: group.conditions.filter(function keep(_, childIndex) {
        return childIndex !== index;
      }),
    });
  }

  function openCreate() {
    setModal({ open: true, mode: "create" });
  }

  function openEdit(index: number, node: Condition) {
    setModal({ open: true, mode: "edit", index, condition: node });
  }

  function handleModalSaved(condition: Condition) {
    if (modal.mode === "edit" && typeof modal.index === "number") {
      updateChild(modal.index, condition);
    } else {
      onChange({ ...group, conditions: [...group.conditions, condition] });
    }
    setModal(CLOSED_MODAL);
  }

  function addGroup() {
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { combinator: "AND", conditions: [makeDefaultCondition("subtotal")] },
      ],
    });
  }

  // Connector word between chips mirrors the combinator; a NONE group negates
  // the OR of its children, so "or" is the honest connector there too.
  const connectorWord = group.combinator === "AND" ? "and" : "or";
  const isRoot = depth <= 1;
  const combinator =
    group.combinator === "OR" || group.combinator === "NONE" ? group.combinator : "AND";

  return (
    <BlockStack gap="200">
      {isRoot ? (
        <ChoiceList
          title="Match type"
          choices={ROOT_MATCH_CHOICES}
          selected={[combinator]}
          onChange={function changeRootCombinator(selected: string[]) {
            const next = selected[0] === "OR" || selected[0] === "NONE" ? selected[0] : "AND";
            onChange({ ...group, combinator: next });
          }}
          disabled={disabled}
        />
      ) : (
        <InlineStack gap="200" blockAlign="center" wrap>
          <Box background="bg-surface-secondary" borderRadius="200" padding="100">
            <Select
              label="Match type"
              labelHidden
              options={COMBINATOR_OPTIONS}
              value={combinator === "OR" ? "OR" : "AND"}
              onChange={function changeCombinator(next: string) {
                onChange({ ...group, combinator: next === "OR" ? "OR" : "AND" });
              }}
              disabled={disabled}
            />
          </Box>
          <Text as="span" variant="bodySm" tone="subdued">
            of the following match:
          </Text>
        </InlineStack>
      )}
      <InlineStack gap="200" blockAlign="center" wrap>
        {byteEstimate > RULE_BYTE_WARN_BYTES ? (
          <Tooltip
            content={`The conditions take about ${byteEstimate} bytes. The checkout config budget is about 9.5 KB for the whole shop, so large condition trees can push a sync over the budget.`}
          >
            <Text as="span" variant="bodySm" tone="caution">
              Large condition set (about {byteEstimate} bytes)
            </Text>
          </Tooltip>
        ) : null}
        {ruleKind !== "CARRIER_RATE" && groupUsesClockFields(group) ? (
          <Tooltip content={CLOCK_CONTEXT_TOOLTIP}>
            <Text as="span" variant="bodySm" tone="subdued">
              Runs in the carrier lane and the simulator only.
            </Text>
          </Tooltip>
        ) : null}
      </InlineStack>
      {ruleKind === "CARRIER_RATE" ? (
        <Tooltip content={CARRIER_CONTEXT_TOOLTIP}>
          <Text as="span" variant="bodySm" tone="subdued">
            Tag and login conditions are hidden for carrier-rate rules.
          </Text>
        </Tooltip>
      ) : null}
      {group.conditions.length === 0 ? (
        <Text as="span" variant="bodySm" tone="subdued">
          No conditions yet. An empty group matches every checkout.
        </Text>
      ) : null}
      <BlockStack gap="150">
        {leafEntries.map(function renderChip(entry, position) {
          return (
            <BlockStack key={entry.index} gap="150">
              {position > 0 ? (
                <div style={CONNECTOR_BADGE_STYLE}>
                  <Badge size="small" tone={ connectorWord !== "and" ? "info" : "warning" }>
                    {connectorWord.toLocaleUpperCase()}
                  </Badge>
                </div>
              ) : null}
              <div className="sm-rule-chip">
                <span className="sm-rule-chip__label">{describeCondition(entry.node)}</span>
                <Button
                  icon={EditIcon}
                  variant="plain"
                  accessibilityLabel="Edit condition"
                  onClick={function edit() {
                    openEdit(entry.index, entry.node);
                  }}
                  disabled={disabled}
                />
                <Button
                  icon={DeleteIcon}
                  variant="plain"
                  tone="critical"
                  accessibilityLabel="Remove condition"
                  onClick={function remove() {
                    removeChild(entry.index);
                  }}
                  disabled={disabled}
                />
              </div>
            </BlockStack>
          );
        })}
      </BlockStack>
      {groupEntries.length > 0 ? (
        <BlockStack gap="200">
          {groupEntries.map(function renderGroup(entry) {
            return (
              <div key={entry.index} style={NESTED_GROUP_INDENT_STYLE}>
                <InlineStack gap="200" blockAlign="start">
                  <div style={NESTED_CONTENT_STYLE}>
                    <ConditionGroupEditor
                      group={entry.node}
                      depth={depth + 1}
                      ruleKind={ruleKind}
                      disabled={disabled}
                      onChange={function updateGroup(next: ConditionGroup) {
                        updateChild(entry.index, next);
                      }}
                    />
                  </div>
                  {/* Remove-group stays parent-owned so the editor's props
                      contract is untouched; the icon sits level with the
                      sub-group's header pill. */}
                  <Button
                    icon={DeleteIcon}
                    variant="plain"
                    tone="critical"
                    accessibilityLabel="Remove condition group"
                    onClick={function removeGroup() {
                      removeChild(entry.index);
                    }}
                    disabled={disabled}
                  />
                </InlineStack>
              </div>
            );
          })}
        </BlockStack>
      ) : null}
      <InlineStack gap="300" blockAlign="center">
        <Button variant="plain" onClick={openCreate} disabled={disabled}>
          + Add condition
        </Button>
        {depth < MAX_DEPTH ? (
          <Button variant="plain" onClick={addGroup} disabled={disabled}>
            + Add group
          </Button>
        ) : (
          <Text as="span" variant="bodySm" tone="subdued">
            Depth limit reached (3 levels).
          </Text>
        )}
      </InlineStack>
      <ConditionModal
        open={modal.open}
        mode={modal.mode}
        ruleKind={ruleKind}
        condition={modal.condition}
        onClose={function close() {
          setModal(CLOSED_MODAL);
        }}
        onSaved={handleModalSaved}
      />
    </BlockStack>
  );
}

