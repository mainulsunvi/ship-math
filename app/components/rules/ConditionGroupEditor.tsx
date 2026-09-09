import type { CSSProperties } from "react";
import {
  BlockStack,
  Box,
  Button,
  InlineStack,
  Select,
  Text,
  Tooltip,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import type {
  Condition,
  ConditionField,
  ConditionGroup,
  RuleKind,
} from "../../lib/config-schema";
import ConditionRow, {
  CARRIER_CONTEXT_TOOLTIP,
  CARRIER_RATE_FORBIDDEN_FIELDS,
  makeDefaultCondition,
} from "./ConditionRow";
import ConditionPicker from "./ConditionPicker";
import { SOFT_CAP_BYTES } from "../../lib/budget";

/**
 * Recursive AND/OR condition group editor (spec 005 Task 5), restyled to the
 * reference rule-builder look: no boxed group containers — condition rows are
 * the primary visual, each group leads with a compact "All/Any" pill plus
 * trailing copy, and nested sub-groups hang off a thin left connector rail.
 * "+ Add condition" opens the ConditionPicker popover (Ref 2) instead of
 * appending a blank dropdown row. Presentation + add-flow only — the tree
 * operations (update/remove/add, depth cap, kind sanitization) are
 * behavior-frozen.
 *   - depth cap of 3 nested groups mirrors the mirror-budget guard: a deeper
 *     tree costs bytes in the 9.5 KB function config for zero matching power.
 *   - a subtle byte warning appears when the serialized group approaches the
 *     per-rule share of the config cap (SOFT_CAP_BYTES in lib/budget — a
 *     pure, client-safe constants module).
 */

const MAX_DEPTH = 3;
// Warn near ~10% of the per-shop config cap (SOFT_CAP_BYTES / 10 ≈ 950 bytes).
const RULE_BYTE_WARN_BYTES = Math.round(SOFT_CAP_BYTES / 10);

const COMBINATOR_OPTIONS = [
  { label: "All", value: "AND" },
  { label: "Any", value: "OR" },
];

const DEFAULT_CONDITION: Condition = { field: "subtotal", operator: "gte", value: 0 };

/**
 * Thin connector rail that nests sub-groups under their parent with no boxed
 * chrome (Ref 1). Polaris 12.27 ships no --p-color-border-strong token
 * (verified against build/esm/styles.css, the stylesheet app.tsx loads), so
 * the standard border color is the fallback; sizes stay on --p-space-* tokens.
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
 * minWidth 0 keeps long condition rows from stretching the connector rail.
 */
const NESTED_CONTENT_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
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

export default function ConditionGroupEditor({
  group,
  depth,
  ruleKind,
  disabled,
  onChange,
}: ConditionGroupEditorProps) {
  const byteEstimate = JSON.stringify(group).length;

  // Visual partition only (flat builder look): rows render before
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

  /**
   * Appends a condition row. With defaultField (the ConditionPicker flow) the
   * row starts with that field preselected; without it the subtotal default
   * applies — identical outputs, since makeDefaultCondition("subtotal") is
   * the DEFAULT_CONDITION.
   */
  function addCondition(defaultField?: string) {
    const condition =
      defaultField !== undefined && defaultField !== ""
        ? makeDefaultCondition(defaultField as ConditionField)
        : { ...DEFAULT_CONDITION };
    onChange({ ...group, conditions: [...group.conditions, condition] });
  }

  function addGroup() {
    onChange({
      ...group,
      conditions: [...group.conditions, { combinator: "AND", conditions: [{ ...DEFAULT_CONDITION }] }],
    });
  }

  return (
    <BlockStack gap="200">
      {/* Header line is the group's only chrome (Ref 1): a compact All/Any
          pill — a label-hidden Select wrapped in a soft surface — followed
          by subdued copy. No boxes, no header bar. */}
      <InlineStack gap="200" blockAlign="center" wrap>
        <Box background="bg-surface-secondary" borderRadius="200" padding="100">
          <Select
            label="Match type"
            labelHidden
            options={COMBINATOR_OPTIONS}
            value={group.combinator}
            onChange={function changeCombinator(next: string) {
              onChange({ ...group, combinator: next === "OR" ? "OR" : "AND" });
            }}
            disabled={disabled}
          />
        </Box>
        <Text as="span" variant="bodySm" tone="subdued">
          of the following:
        </Text>
        {byteEstimate > RULE_BYTE_WARN_BYTES ? (
          <Tooltip
            content={`The conditions take about ${byteEstimate} bytes. The checkout config budget is about 9.5 KB for the whole shop, so large condition trees can push a sync over the budget.`}
          >
            <Text as="span" variant="bodySm" tone="caution">
              Large condition set (about {byteEstimate} bytes)
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
      <BlockStack gap="200">
        {leafEntries.map(function renderRow(entry) {
          return (
            <ConditionRow
              key={entry.index}
              condition={entry.node}
              ruleKind={ruleKind}
              disabled={disabled}
              onChange={function update(next: Condition) {
                updateChild(entry.index, next);
              }}
              onRemove={function remove() {
                removeChild(entry.index);
              }}
            />
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
                      contract is untouched; in the flat design the icon sits
                      level with the sub-group's header pill. */}
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
        <ConditionPicker
          ruleKind={ruleKind}
          activator={
            <Button variant="plain" disabled={disabled}>
              + Add condition
            </Button>
          }
          onPick={function pickField(field: ConditionField) {
            addCondition(field);
          }}
        />
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
    </BlockStack>
  );
}
