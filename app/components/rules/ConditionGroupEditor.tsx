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
import type { Condition, ConditionGroup, RuleKind } from "../../lib/config-schema";
import ConditionRow, {
  CARRIER_CONTEXT_TOOLTIP,
  CARRIER_RATE_FORBIDDEN_FIELDS,
} from "./ConditionRow";
import { SOFT_CAP_BYTES } from "../../lib/budget";

/**
 * Recursive AND/OR condition group editor (spec 005 Task 5).
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
  { label: "ALL of the following (AND)", value: "AND" },
  { label: "ANY of the following (OR)", value: "OR" },
];

const DEFAULT_CONDITION: Condition = { field: "subtotal", operator: "gte", value: 0 };

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

  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, { ...DEFAULT_CONDITION }] });
  }

  function addGroup() {
    onChange({
      ...group,
      conditions: [...group.conditions, { combinator: "AND", conditions: [{ ...DEFAULT_CONDITION }] }],
    });
  }

  return (
    <BlockStack gap="300">
      <InlineStack gap="300" blockAlign="center" align="space-between">
        <Select
          label={depth === 1 ? "Match" : "Group match"}
          labelInline
          options={COMBINATOR_OPTIONS}
          value={group.combinator}
          onChange={function changeCombinator(next: string) {
            onChange({ ...group, combinator: next === "OR" ? "OR" : "AND" });
          }}
          disabled={disabled}
        />
        {byteEstimate > RULE_BYTE_WARN_BYTES ? (
          <Tooltip
            content={`Serialized conditions ≈ ${byteEstimate} bytes. The checkout mirror budget is ~9.5 KB for the whole shop — large condition trees can push a sync over budget.`}
          >
            <Text as="span" variant="bodySm" tone="caution">
              Large condition set (≈ {byteEstimate} bytes)
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
          No conditions yet — an empty group matches every checkout.
        </Text>
      ) : null}
      <BlockStack gap="300">
        {group.conditions.map(function renderChild(node, index) {
          if ("combinator" in node) {
            return (
              <Box
                key={index}
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
                borderWidth="025"
                borderColor="border"
              >
                <InlineStack align="end">
                  <Button
                    icon={DeleteIcon}
                    variant="plain"
                    tone="critical"
                    accessibilityLabel="Remove condition group"
                    onClick={function removeGroup() {
                      removeChild(index);
                    }}
                    disabled={disabled}
                  />
                </InlineStack>
                <ConditionGroupEditor
                  group={node}
                  depth={depth + 1}
                  ruleKind={ruleKind}
                  disabled={disabled}
                  onChange={function updateGroup(next: ConditionGroup) {
                    updateChild(index, next);
                  }}
                />
              </Box>
            );
          }
          return (
            <ConditionRow
              key={index}
              condition={node}
              ruleKind={ruleKind}
              disabled={disabled}
              onChange={function update(next: Condition) {
                updateChild(index, next);
              }}
              onRemove={function remove() {
                removeChild(index);
              }}
            />
          );
        })}
      </BlockStack>
      <InlineStack gap="300" blockAlign="center">
        <Button onClick={addCondition} disabled={disabled}>
          Add condition
        </Button>
        {depth < MAX_DEPTH ? (
          <Button onClick={addGroup} disabled={disabled}>
            Add condition group
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
