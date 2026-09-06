import { useState } from "react";
import {
  BlockStack,
  Button,
  InlineStack,
  Select,
  Tag,
  TextField,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import {
  CONDITION_FIELDS,
  type Condition,
  type ConditionField,
  type Operator,
  type RuleKind,
} from "../../lib/config-schema";

/**
 * §A3 lane capability matrix — the carrier payload has no product tags, no
 * customer identity, and no login state. The UI hides these fields for
 * CARRIER_RATE rules (the Zod refine in config-schema is only the backstop).
 */
export const CARRIER_RATE_FORBIDDEN_FIELDS: ReadonlyArray<ConditionField> = [
  "product_tag",
  "customer_tag",
  "logged_in",
];

export const CARRIER_CONTEXT_TOOLTIP =
  "Carrier service rates run without cart context — tags and login state are unavailable";

type FieldInputKind = "number" | "text" | "tags" | "boolean";

interface FieldMeta {
  label: string;
  input: FieldInputKind;
  operators: Operator[];
}

/** Exported for ConditionPicker's catalog (labels) — no behavior change. */
export const FIELD_META: Record<ConditionField, FieldMeta> = {
  subtotal: { label: "Cart subtotal", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  weight: { label: "Cart weight", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  quantity: { label: "Item quantity", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  product_tag: { label: "Product tag", input: "tags", operators: ["eq", "neq", "in", "not_in"] },
  sku: { label: "SKU", input: "text", operators: ["eq", "neq", "in", "not_in", "contains"] },
  vendor: { label: "Vendor", input: "text", operators: ["eq", "neq", "in", "not_in", "contains"] },
  customer_tag: { label: "Customer tag", input: "tags", operators: ["eq", "neq", "in", "not_in"] },
  logged_in: { label: "Customer logged in", input: "boolean", operators: ["eq"] },
  destination_country: { label: "Destination country", input: "text", operators: ["eq", "neq", "in", "not_in"] },
  destination_province: { label: "Destination province", input: "text", operators: ["eq", "neq", "in", "not_in"] },
  destination_postal: { label: "Destination postal code", input: "text", operators: ["eq", "neq", "in", "not_in"] },
};

const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  in: "is one of",
  not_in: "is not one of",
  contains: "contains",
};

const LIST_OPERATORS: ReadonlyArray<Operator> = ["in", "not_in"];

function isListOperator(operator: Operator): boolean {
  return LIST_OPERATORS.includes(operator);
}

function operatorOptions(field: ConditionField): Array<{ label: string; value: string }> {
  return FIELD_META[field].operators.map(function toOption(operator) {
    return { label: OPERATOR_LABELS[operator], value: operator };
  });
}

function fieldOptions(ruleKind: RuleKind): Array<{ label: string; value: string }> {
  return CONDITION_FIELDS.filter(function allowed(field) {
    return ruleKind !== "CARRIER_RATE" || !CARRIER_RATE_FORBIDDEN_FIELDS.includes(field);
  }).map(function toOption(field) {
    return { label: FIELD_META[field].label, value: field };
  });
}

function defaultValueFor(meta: FieldMeta, operator: Operator): string | number | boolean | string[] {
  if (isListOperator(operator)) {
    return [];
  }
  if (meta.input === "number") {
    return 0;
  }
  if (meta.input === "boolean") {
    return true;
  }
  return "";
}

/**
 * Default condition for a freshly picked field — identical to what the row's
 * own field dropdown produces on a manual switch (first operator +
 * defaultValueFor). Shared with ConditionPicker so picker-inserted rows and
 * field-switched rows can never diverge.
 */
export function makeDefaultCondition(field: ConditionField): Condition {
  const meta = FIELD_META[field];
  const operator = meta.operators[0];
  return { field, operator, value: defaultValueFor(meta, operator) };
}

function convertValue(
  meta: FieldMeta,
  nextOperator: Operator,
  value: Condition["value"],
): Condition["value"] {
  const wasList = Array.isArray(value);
  const isList = isListOperator(nextOperator);
  if (wasList === isList) {
    return value;
  }
  if (isList) {
    return typeof value === "string" && value.trim().length > 0 ? [value.trim()] : [];
  }
  if (meta.input === "number") {
    const list = Array.isArray(value) ? value : undefined;
    const first = list?.find(function firstEntry(entry: string) {
      return entry.trim().length > 0;
    });
    const parsed = first !== undefined ? Number(first) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (meta.input === "boolean") {
    return true;
  }
  const list = Array.isArray(value) ? value : undefined;
  const text = list?.find(function firstEntry(entry: string) {
    return typeof entry === "string";
  });
  return typeof text === "string" ? text : "";
}

function toStringArray(value: Condition["value"]): string[] {
  return Array.isArray(value) ? value : [];
}

interface ConditionRowProps {
  condition: Condition;
  ruleKind: RuleKind;
  disabled?: boolean;
  onChange(next: Condition): void;
  onRemove(): void;
}

/**
 * One field → operator → typed-value row. The value input type follows the
 * field (number / text / tag list / boolean); `in`/`not_in` always render the
 * tag-list editor because Condition.value stores string arrays for them.
 */
export default function ConditionRow({
  condition,
  ruleKind,
  disabled,
  onChange,
  onRemove,
}: ConditionRowProps) {
  const meta = FIELD_META[condition.field];
  const listMode = isListOperator(condition.operator);

  function handleFieldChange(next: string) {
    const field = next as ConditionField;
    const nextMeta = FIELD_META[field];
    const operator = nextMeta.operators.includes(condition.operator)
      ? condition.operator
      : nextMeta.operators[0];
    onChange({ field, operator, value: defaultValueFor(nextMeta, operator) });
  }

  function handleOperatorChange(next: string) {
    const operator = next as Operator;
    onChange({ ...condition, operator, value: convertValue(meta, operator, condition.value) });
  }

  function handleNumberChange(text: string) {
    const trimmed = text.trim();
    const parsed = Number(trimmed);
    const value = trimmed !== "" && Number.isFinite(parsed) ? parsed : text;
    onChange({ ...condition, value });
  }

  return (
    <InlineStack gap="200" blockAlign="end" wrap>
      <Select
        label="Field"
        labelInline={false}
        labelHidden
        options={fieldOptions(ruleKind)}
        value={condition.field}
        onChange={handleFieldChange}
        disabled={disabled}
      />
      <Select
        label="Operator"
        labelHidden
        options={operatorOptions(condition.field)}
        value={condition.operator}
        onChange={handleOperatorChange}
        disabled={disabled}
      />
      {listMode ? (
        <TagListInput
          values={toStringArray(condition.value)}
          disabled={disabled}
          onChange={function setList(next: string[]) {
            onChange({ ...condition, value: next });
          }}
        />
      ) : null}
      {!listMode && meta.input === "number" ? (
        <TextField
          label="Value"
          labelHidden
          type="number"
          min={0}
          autoComplete="off"
          value={typeof condition.value === "number" ? String(condition.value) : String(condition.value ?? "")}
          onChange={handleNumberChange}
          disabled={disabled}
        />
      ) : null}
      {!listMode && meta.input === "boolean" ? (
        <Select
          label="Value"
          labelHidden
          options={[
            { label: "true", value: "true" },
            { label: "false", value: "false" },
          ]}
          value={condition.value === true ? "true" : "false"}
          onChange={function setBoolean(next: string) {
            onChange({ ...condition, value: next === "true" });
          }}
          disabled={disabled}
        />
      ) : null}
      {!listMode && (meta.input === "text" || meta.input === "tags") ? (
        <TextField
          label="Value"
          labelHidden
          autoComplete="off"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={function setText(next: string) {
            onChange({ ...condition, value: next });
          }}
          disabled={disabled}
        />
      ) : null}
      <Button
        icon={DeleteIcon}
        variant="plain"
        tone="critical"
        accessibilityLabel="Remove condition"
        onClick={onRemove}
        disabled={disabled}
      />
    </InlineStack>
  );
}

interface TagListInputProps {
  values: string[];
  disabled?: boolean;
  onChange(next: string[]): void;
}

/** Tag-list editor for `in` / `not_in` values (comma separated entry). */
function TagListInput({ values, disabled, onChange }: TagListInputProps) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const parts = draft
      .split(",")
      .map(function trim(part) {
        return part.trim();
      })
      .filter(function nonEmpty(part) {
        return part.length > 0;
      });
    if (parts.length === 0) {
      return;
    }
    onChange(Array.from(new Set([...values, ...parts])));
    setDraft("");
  }

  return (
    <BlockStack gap="150">
      <InlineStack gap="200" blockAlign="center">
        <TextField
          label="Value"
          labelHidden
          placeholder="Value (comma separated for several)"
          autoComplete="off"
          value={draft}
          onChange={setDraft}
          disabled={disabled}
        />
        <Button
          icon={PlusIcon}
          onClick={addDraft}
          disabled={disabled || draft.trim().length === 0}
          accessibilityLabel="Add value"
        >
          Add
        </Button>
      </InlineStack>
      {values.length > 0 ? (
        <InlineStack gap="150" wrap>
          {values.map(function renderTag(value: string) {
            return (
              <Tag
                key={value}
                onRemove={
                  disabled
                    ? undefined
                    : function remove() {
                        onChange(
                          values.filter(function keep(entry) {
                            return entry !== value;
                          }),
                        );
                      }
                }
              >
                {value}
              </Tag>
            );
          })}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}
