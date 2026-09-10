import { useEffect, useState } from "react";
import { Banner, BlockStack, Modal, Select, Text } from "@shopify/polaris";
import type { RuleKind } from "../../lib/config-schema";
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

/**
 * Spec 021 action editor modal (user directive 2026-09-09: the action form
 * lives in a modal). Wraps the shared ActionEditor in a Polaris Modal with
 * local draft state; Save validates through the same build helpers RuleForm
 * uses on submit, so a draft can only leave the modal when it would pass the
 * form's own validation. The parent owns where the draft lands (THEN list,
 * ELSE list, or the carrier slot).
 *
 * 2026-09-11: there is no separate rule-kind select anymore. While the rule
 * has NO actions, this modal shows the "What the rule does" picker and the
 * first saved action commits the rule's kind (allowKindChange).
 */

const KIND_CHOICES: Array<{ label: string; value: string }> = [
  { label: "Hide delivery options", value: "HIDE" },
  { label: "Rename delivery options", value: "RENAME" },
  { label: "Move delivery options", value: "MOVE" },
  { label: "Set a shipping rate", value: "CARRIER_RATE" },
];

export interface ActionModalProps {
  open: boolean;
  mode: "create" | "edit";
  kind: RuleKind;
  /** True while the rule has no actions: the picker decides the kind. */
  allowKindChange?: boolean;
  /** Edit mode seeds; create mode starts from the defaults. */
  initialFunction?: FunctionActionDraft;
  initialCarrier?: CarrierDraft;
  onClose(): void;
  onSaved(payload: {
    kind: RuleKind;
    functionDraft: FunctionActionDraft;
    carrierDraft: CarrierDraft;
  }): void;
}

export default function ActionModal({
  open,
  mode,
  kind,
  allowKindChange = false,
  initialFunction,
  initialCarrier,
  onClose,
  onSaved,
}: ActionModalProps) {
  const [functionDraft, setFunctionDraft] = useState<FunctionActionDraft>(
    function initFunction() {
      return initialFunction ?? makeDefaultFunctionDraft();
    },
  );
  const [carrierDraft, setCarrierDraft] = useState<CarrierDraft>(function initCarrier() {
    return initialCarrier ?? makeDefaultCarrierDraft();
  });
  const [kindChoice, setKindChoice] = useState<RuleKind>(kind);
  const [errors, setErrors] = useState<string[]>([]);

  const effectiveKind = allowKindChange ? kindChoice : kind;

  // Re-seed on open so stale drafts never leak between chips.
  useEffect(function syncOnOpen() {
    if (open) {
      setFunctionDraft(initialFunction ?? makeDefaultFunctionDraft());
      setCarrierDraft(initialCarrier ?? makeDefaultCarrierDraft());
      setKindChoice(kind);
      setErrors([]);
    }
  }, [open, kind, initialFunction, initialCarrier]);

  function handleSave() {
    const built =
      effectiveKind === "CARRIER_RATE"
        ? buildCarrierAction(carrierDraft)
        : buildFunctionAction(effectiveKind, functionDraft);
    if (built.action === null || built.errors.length > 0) {
      setErrors(built.errors.length > 0 ? built.errors : ["The action is incomplete."]);
      return;
    }
    onSaved({ kind: effectiveKind, functionDraft, carrierDraft });
  }

  const title =
    effectiveKind === "CARRIER_RATE"
      ? mode === "edit"
        ? "Edit Rate"
        : "Add Rate"
      : mode === "edit"
        ? "Edit Action"
        : "Add Action";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      primaryAction={{
        content:
          effectiveKind === "CARRIER_RATE"
            ? mode === "edit"
              ? "Save rate"
              : "Add rate"
            : mode === "edit"
              ? "Save action"
              : "Add action",
        onAction: handleSave,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {errors.length > 0 ? (
            <Banner tone="critical" title="Fix Before Saving">
              <BlockStack gap="100">
                {errors.map(function renderError(message, index) {
                  return (
                    <Text key={index} as="p" variant="bodySm">
                      {message}
                    </Text>
                  );
                })}
              </BlockStack>
            </Banner>
          ) : null}
          {allowKindChange ? (
            <Select
              label="What the rule does"
              options={KIND_CHOICES}
              value={effectiveKind}
              onChange={function changeKind(next: string) {
                setKindChoice(next as RuleKind);
              }}
              helpText="The first action decides this for the whole rule. All actions in one rule make the same kind of change."
            />
          ) : null}
          <ActionEditor
            kind={effectiveKind}
            functionDraft={functionDraft}
            carrierDraft={carrierDraft}
            onFunctionChange={function updateFunction(next: FunctionActionDraft) {
              setFunctionDraft(next);
            }}
            onCarrierChange={function updateCarrier(next: CarrierDraft) {
              setCarrierDraft(next);
            }}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
