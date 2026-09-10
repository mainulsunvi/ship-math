import { useState } from "react";
import {
  BlockStack,
  Button,
  ChoiceList,
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
  "Carrier rates run without full cart context, so tags and login state are not available";

/**
 * Spec 021 §9: date and time fields run ONLY in the carrier lane and the
 * simulator — the checkout Function has no clock, so the config sync
 * excludes them from the function mirror with an explicit reason.
 */
export const CLOCK_ONLY_FIELDS: ReadonlyArray<ConditionField> = [
  "date",
  "day_of_week",
  "time_of_day",
];

export const CLOCK_CONTEXT_TOOLTIP =
  "Date and time conditions run in the carrier lane and the simulator. They cannot run in the checkout Function, which has no clock.";

type FieldInputKind = "number" | "text" | "tags" | "boolean" | "date" | "time" | "weekday";

interface FieldMeta {
  label: string;
  input: FieldInputKind;
  operators: Operator[];
}

/** Field labels + value editors. Exported for the picker/modal catalogs. */
export const FIELD_META: Record<ConditionField, FieldMeta> = {
  subtotal: { label: "Cart - Subtotal", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  total: { label: "Cart - Total", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  weight: { label: "Cart - Weight", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  quantity: { label: "Item - Quantity", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  price: { label: "Item - Price", input: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  product_tag: { label: "Product - Tag", input: "tags", operators: ["eq", "neq", "in", "not_in"] },
  sku: { label: "Item - SKU", input: "text", operators: ["eq", "neq", "in", "not_in", "contains"] },
  vendor: { label: "Item - Vendor", input: "text", operators: ["eq", "neq", "in", "not_in", "contains"] },
  customer_tag: { label: "Customer - Tag", input: "tags", operators: ["eq", "neq", "in", "not_in"] },
  logged_in: { label: "Customer - Logged in", input: "boolean", operators: ["eq"] },
  city: { label: "City", input: "text", operators: ["eq", "neq", "in", "not_in", "contains"] },
  date: { label: "Date", input: "date", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  day_of_week: { label: "Day of Week", input: "weekday", operators: ["in", "not_in"] },
  time_of_day: { label: "Time of Day", input: "time", operators: ["eq", "neq", "gt", "gte", "lt", "lte"] },
  destination_country: { label: "Destination - Country", input: "text", operators: ["eq", "neq", "in", "not_in"] },
  destination_province: { label: "Destination - Province", input: "text", operators: ["eq", "neq", "in", "not_in"] },
  destination_postal: { label: "Destination - Postal Code", input: "text", operators: ["eq", "neq", "in", "not_in"] },
};

export const OPERATOR_LABELS: Record<Operator, string> = {
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

/** Weekday display order Monday-first; values are the 3-letter wire codes. */
export const WEEKDAY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Monday", value: "mon" },
  { label: "Tuesday", value: "tue" },
  { label: "Wednesday", value: "wed" },
  { label: "Thursday", value: "thu" },
  { label: "Friday", value: "fri" },
  { label: "Saturday", value: "sat" },
  { label: "Sunday", value: "sun" },
];

const WEEKDAY_LABELS: Record<string, string> = WEEKDAY_OPTIONS.reduce(function toMap(map, option) {
  map[option.value] = option.label;
  return map;
}, {} as Record<string, string>);

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
  if (meta.input === "weekday") {
    return [];
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

// ---------------------------------------------------------------------------
// Chip summaries (spec 021: condition chips inside the builder)
// ---------------------------------------------------------------------------

function describeValue(field: ConditionField, value: Condition["value"]): string {
  const meta = FIELD_META[field];
  if (Array.isArray(value)) {
    if (meta.input === "weekday") {
      const labels = value.map(function label(code: string) {
        return WEEKDAY_LABELS[code.toLowerCase()] ?? code;
      });
      return labels.length > 0 ? labels.join(", ") : "no days";
    }
    return value.length > 0 ? value.join(", ") : "nothing";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  const text = String(value ?? "");
  return text !== "" ? text : "empty";
}

/** One-line chip summary: "Cart subtotal is at least 50". */
export function describeCondition(condition: Condition): string {
  const meta = FIELD_META[condition.field];
  const operator = OPERATOR_LABELS[condition.operator] ?? condition.operator;
  return `${meta.label} - ${operator} ${describeValue(condition.field, condition.value)}`;
}

interface ConditionGroupLike {
  combinator: string;
  conditions: Array<Condition | ConditionGroupLike>;
}

/** True when any leaf under the group uses a clock-only field (spec 021 §9). */
export function groupUsesClockFields(node: Condition | ConditionGroupLike): boolean {
  if ("combinator" in node) {
    return node.conditions.some(groupUsesClockFields);
  }
  return CLOCK_ONLY_FIELDS.includes(node.field);
}

// ---------------------------------------------------------------------------
// Shared value editor (legacy row body + spec 021 ConditionModal body)
// ---------------------------------------------------------------------------

export interface ConditionValueInputProps {
  condition: Condition;
  disabled?: boolean;
  error?: string;
  onChange(next: Condition): void;
}

/**
 * Operator + typed-value editor. The value input follows the field (number /
 * text / tag list / boolean / date / time / weekday choices); `in`/`not_in`
 * render the tag-list editor because Condition.value stores string arrays
 * for them. Spec 021: also the body of ConditionModal's editor step, with an
 * optional inline error for save-time validation.
 */
export function ConditionValueInput({ condition, disabled, error, onChange }: ConditionValueInputProps) {
  const meta = FIELD_META[condition.field];
  const listMode = isListOperator(condition.operator);

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
    <BlockStack gap="200">
      <Select
        label="Operator"
        labelHidden
        options={operatorOptions(condition.field)}
        value={condition.operator}
        onChange={handleOperatorChange}
        disabled={disabled}
      />
      {meta.input === "weekday" ? (
        <ChoiceList
          title="Days"
          titleHidden
          allowMultiple
          choices={WEEKDAY_OPTIONS}
          selected={toStringArray(condition.value)}
          onChange={function setDays(next: string[]) {
            onChange({ ...condition, value: next });
          }}
          disabled={disabled}
        />
      ) : null}
      {listMode && meta.input !== "weekday" ? (
        <TagListInput
          values={toStringArray(condition.value)}
          disabled={disabled}
          error={error}
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
          error={error}
        />
      ) : null}
      {!listMode && meta.input === "boolean" ? (
        <Select
          label="Value"
          labelHidden
          options={[
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ]}
          value={condition.value === true ? "true" : "false"}
          onChange={function setBoolean(next: string) {
            onChange({ ...condition, value: next === "true" });
          }}
          disabled={disabled}
        />
      ) : null}
      {!listMode && meta.input === "date" ? (
        <TextField
          label="Value"
          labelHidden
          type="date"
          autoComplete="off"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={function setDate(next: string) {
            onChange({ ...condition, value: next });
          }}
          disabled={disabled}
          error={error}
          helpText="Compared in the shop time zone."
        />
      ) : null}
      {!listMode && meta.input === "time" ? (
        <TextField
          label="Value"
          labelHidden
          type="time"
          autoComplete="off"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={function setTime(next: string) {
            onChange({ ...condition, value: next });
          }}
          disabled={disabled}
          error={error}
          helpText="24-hour clock in the shop time zone, for example 9:00 or 14:30."
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
          error={error}
        />
      ) : null}
    </BlockStack>
  );
}

interface ConditionRowProps {
  condition: Condition;
  ruleKind: RuleKind;
  disabled?: boolean;
  onChange(next: Condition): void;
  onRemove(): void;
}

/**
 * Legacy inline dropdown row. Spec 021 ConditionGroupEditor renders chips +
 * ConditionModal instead; this row stays for compatibility and reuses the
 * shared ConditionValueInput so both surfaces can never diverge.
 */
export default function ConditionRow({
  condition,
  ruleKind,
  disabled,
  onChange,
  onRemove,
}: ConditionRowProps) {
  function handleFieldChange(next: string) {
    const field = next as ConditionField;
    const nextMeta = FIELD_META[field];
    const operator = nextMeta.operators.includes(condition.operator)
      ? condition.operator
      : nextMeta.operators[0];
    onChange({ field, operator, value: defaultValueFor(nextMeta, operator) });
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
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <ConditionValueInput condition={condition} disabled={disabled} onChange={onChange} />
      </div>
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
  error?: string;
  onChange(next: string[]): void;
}

/** Tag-list editor for `in` / `not_in` values (comma separated entry). */
function TagListInput({ values, disabled, error, onChange }: TagListInputProps) {
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
          error={error}
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
