import { useEffect, useState } from "react";
import { BlockStack, Button, Modal, Text } from "@shopify/polaris";
import type { Condition, RuleKind } from "../../lib/config-schema";
import {
  CLOCK_CONTEXT_TOOLTIP,
  CLOCK_ONLY_FIELDS,
  FIELD_META,
  makeDefaultCondition,
} from "./ConditionRow";
import { ConditionValueInput } from "./ConditionRow";
import { ConditionCatalog } from "./ConditionPicker";

/**
 * Spec 021 condition editor modal (user directive 2026-09-09: the condition
 * form lives in a modal). Two steps:
 *   1. create — the field catalog (search + grouped entries + lane notes)
 *   2. editor — field dropdown (changeable), operator, typed value
 *
 * Edit mode skips straight to the editor seeded with the existing condition.
 * Save validates the value shape (number finite, text non-empty, date
 * YYYY-MM-DD, time HH:mm, weekday list non-empty) and calls onSaved with the
 * normalized condition; the parent owns where it lands in the tree.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ConditionModalProps {
  open: boolean;
  mode: "create" | "edit";
  ruleKind: RuleKind;
  /** Edit mode only: the condition being edited. */
  condition?: Condition;
  onClose(): void;
  onSaved(condition: Condition): void;
}

function validate(condition: Condition): string | undefined {
  const meta = FIELD_META[condition.field];
  const value = condition.value;
  if (meta.input === "weekday" || Array.isArray(value)) {
    if (!Array.isArray(value) || value.length === 0) {
      return "Choose at least one value.";
    }
    return undefined;
  }
  if (meta.input === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? undefined
      : "Enter a number.";
  }
  if (meta.input === "boolean") {
    return undefined;
  }
  if (meta.input === "date") {
    return typeof value === "string" && DATE_PATTERN.test(value)
      ? undefined
      : "Choose a date.";
  }
  if (meta.input === "time") {
    return typeof value === "string" && TIME_PATTERN.test(value)
      ? undefined
      : "Choose a time.";
  }
  return typeof value === "string" && value.trim().length > 0
    ? undefined
    : "Enter a value.";
}

export default function ConditionModal({
  open,
  mode,
  ruleKind,
  condition,
  onClose,
  onSaved,
}: ConditionModalProps) {
  const [step, setStep] = useState<"catalog" | "editor">("catalog");
  const [draft, setDraft] = useState<Condition>(function initDraft() {
    return condition ?? makeDefaultCondition("subtotal");
  });
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-seed whenever the modal (re)opens so stale drafts never leak across
  // sessions; edit mode starts directly on the editor step.
  useEffect(function syncOnOpen() {
    if (open) {
      setStep(mode === "edit" ? "editor" : "catalog");
      setDraft(condition ?? makeDefaultCondition("subtotal"));
      setError(undefined);
    }
  }, [open, mode, condition]);

  function handleSave() {
    const message = validate(draft);
    if (message !== undefined) {
      setError(message);
      return;
    }
    onSaved(draft);
  }

  const meta = FIELD_META[draft.field];
  const showClockNote = CLOCK_ONLY_FIELDS.includes(draft.field);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "edit" ? "Edit Condition" : "Add Condition"}
      primaryAction={{
        content: mode === "edit" ? "Save condition" : "Add condition",
        onAction: handleSave,
        disabled: step === "catalog",
      }}
      secondaryActions={
        step === "catalog"
          ? undefined
          : [
              {
                content: "Back",
                onAction: function back() {
                  setStep("catalog");
                },
              },
            ]
      }
    >
      <Modal.Section>
        {step === "catalog" ? (
          <ConditionCatalog
            ruleKind={ruleKind}
            onPick={function pick(field) {
              setDraft(makeDefaultCondition(field));
              setError(undefined);
              setStep("editor");
            }}
          />
        ) : (
          <BlockStack gap="300">
            <BlockStack gap="150">
              <Text as="p" variant="bodyMd" fontWeight="medium">
                {meta.label}
              </Text>
              <Button
                variant="plain"
                onClick={function backToCatalog() {
                  setStep("catalog");
                }}
              >
                Change field
              </Button>
              <ConditionValueInput
                condition={draft}
                error={error}
                onChange={function update(next: Condition) {
                  setDraft(next);
                  setError(undefined);
                }}
              />
              {showClockNote ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {CLOCK_CONTEXT_TOOLTIP}
                </Text>
              ) : null}
            </BlockStack>
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}
