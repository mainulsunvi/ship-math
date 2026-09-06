import {
  BlockStack,
  Box,
  Button,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import type { OptionTarget, RuleAction, RuleKind } from "../../lib/config-schema";
import {
  CarrierRateActionSchema,
  RATE_MODES,
  type CarrierRateAction,
  type RateMode,
} from "../../lib/carrier/action-schema";
import Switch from "../ui/Switch";

/**
 * Kind-specific THEN editor (spec 005 Task 5):
 *   - HIDE / RENAME / MOVE edit the stored function action
 *     ({ target, title?, position? } per config-schema).
 *   - CARRIER_RATE edits the CarrierRateActionSchema payload (architecture
 *     §A3). All money is kept as decimal STRINGS end to end — values are
 *     never passed through Number() — so no float rounding can creep in
 *     before the carrier callback converts to cents.
 *
 * Draft helpers are exported because RuleForm serializes the drafts
 * into the rule-create / rule-update payloads.
 */

const METHOD_OPTIONS = [
  { label: "Any delivery method", value: "" },
  { label: "Shipping", value: "SHIPPING" },
  { label: "Pick up", value: "PICK_UP" },
  { label: "Local delivery", value: "LOCAL" },
  { label: "Retail", value: "RETAIL" },
];

const RATE_MODE_OPTIONS: Array<{ label: string; value: RateMode }> = [
  { label: "Flat rate", value: "flat" },
  { label: "Free", value: "free" },
  { label: "Tiered", value: "tiered" },
  { label: "Percentage of option price", value: "percentage" },
];

const TIER_BASIS_OPTIONS = [
  { label: "Weight", value: "weight" },
  { label: "Subtotal", value: "subtotal" },
  { label: "Quantity", value: "quantity" },
];

const WEIGHT_UNIT_OPTIONS = [
  { label: "per kg", value: "kg" },
  { label: "per lb", value: "lb" },
];

const MONEY_HELP_TEXT = "Decimal string, e.g. 12.50 — stored as text to avoid float rounding.";

// ---------------------------------------------------------------------------
// Function action drafts (HIDE / RENAME / MOVE)
// ---------------------------------------------------------------------------

export interface FunctionActionDraft {
  method: string;
  titleContains: string;
  title: string;
  position: string;
}

export function makeDefaultFunctionDraft(): FunctionActionDraft {
  return { method: "", titleContains: "", title: "", position: "" };
}

export function draftFromFunctionAction(action: unknown): FunctionActionDraft {
  const source = (action ?? {}) as Partial<RuleAction>;
  return {
    method: source.target?.method ?? "",
    titleContains: source.target?.titleContains ?? "",
    title: source.title ?? "",
    position: typeof source.position === "number" ? String(source.position) : "",
  };
}

export function buildFunctionAction(
  kind: RuleKind,
  draft: FunctionActionDraft,
): { action: RuleAction | null; errors: string[] } {
  const target: OptionTarget = {};
  if (draft.method !== "") {
    target.method = draft.method;
  }
  if (draft.titleContains.trim() !== "") {
    target.titleContains = draft.titleContains.trim();
  }
  if (kind === "HIDE") {
    return { action: { target }, errors: [] };
  }
  if (kind === "RENAME") {
    const title = draft.title.trim();
    if (title === "") {
      return { action: null, errors: ["New title is required for rename rules."] };
    }
    return { action: { target, title }, errors: [] };
  }
  if (kind === "MOVE") {
    const parsed = Number.parseInt(draft.position, 10);
    const position = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; // clamp on submit
    return { action: { target, position }, errors: [] };
  }
  return { action: null, errors: ["Unsupported rule kind for a function action."] };
}

// ---------------------------------------------------------------------------
// Carrier rate drafts (CARRIER_RATE)
// ---------------------------------------------------------------------------

export interface TierDraft {
  basis: "weight" | "subtotal" | "quantity";
  from: string;
  to: string;
  amount: string;
  openEnded: boolean;
}

export interface CarrierDraft {
  mode: RateMode;
  serviceName: string;
  serviceCode: string;
  description: string;
  amount: string;
  percentage: string;
  handlingFee: string;
  cap: string;
  perItemEnabled: boolean;
  perItemAmount: string;
  perItemFreeItems: string;
  perWeightEnabled: boolean;
  perWeightAmount: string;
  perWeightUnit: "kg" | "lb";
  tiers: TierDraft[];
}

export function makeDefaultCarrierDraft(): CarrierDraft {
  return {
    mode: "flat",
    serviceName: "",
    serviceCode: "",
    description: "",
    amount: "",
    percentage: "",
    handlingFee: "",
    cap: "",
    perItemEnabled: false,
    perItemAmount: "",
    perItemFreeItems: "",
    perWeightEnabled: false,
    perWeightAmount: "",
    perWeightUnit: "kg",
    tiers: [{ basis: "weight", from: "0", to: "10", amount: "", openEnded: false }],
  };
}

export function draftFromCarrierAction(action: unknown): CarrierDraft {
  const parsed = CarrierRateActionSchema.safeParse(action ?? {});
  if (!parsed.success) {
    return makeDefaultCarrierDraft();
  }
  const source = parsed.data;
  return {
    mode: source.mode,
    serviceName: source.serviceName,
    serviceCode: source.serviceCode,
    description: source.description ?? "",
    amount: source.amount ?? "",
    percentage: source.percentage !== undefined ? String(source.percentage) : "",
    handlingFee: source.handlingFee ?? "",
    cap: source.cap ?? "",
    perItemEnabled: source.perItem !== undefined,
    perItemAmount: source.perItem?.amount ?? "",
    perItemFreeItems: source.perItem?.freeItems !== undefined ? String(source.perItem.freeItems) : "",
    perWeightEnabled: source.perWeight !== undefined,
    perWeightAmount: source.perWeight?.amount ?? "",
    perWeightUnit: source.perWeight?.per ?? "kg",
    tiers:
      source.tiers !== undefined && source.tiers.length > 0
        ? source.tiers.map(function toDraft(tier) {
            return {
              basis: tier.basis,
              from: String(tier.from),
              to: tier.to !== undefined ? String(tier.to) : "",
              amount: tier.amount,
              openEnded: tier.to === undefined,
            };
          })
        : makeDefaultCarrierDraft().tiers,
  };
}

export function buildCarrierAction(
  draft: CarrierDraft,
): { action: CarrierRateAction | null; errors: string[] } {
  const errors: string[] = [];
  const serviceName = draft.serviceName.trim();
  const serviceCode = draft.serviceCode.trim();
  if (serviceName === "") {
    errors.push("Service name is required (Shopify rejects empty carrier service names).");
  }
  if (serviceCode === "") {
    errors.push("Service code is required.");
  }

  const candidate: Record<string, unknown> = { mode: draft.mode, serviceName, serviceCode };
  if (draft.description.trim() !== "") {
    candidate.description = draft.description.trim();
  }
  if (draft.amount.trim() !== "") {
    candidate.amount = draft.amount.trim();
  }
  const percentageText = draft.percentage.trim();
  if (percentageText !== "") {
    const parsed = Number(percentageText);
    if (Number.isFinite(parsed)) {
      candidate.percentage = parsed;
    } else {
      errors.push("Percentage must be a number between 0 and 100.");
    }
  }
  if (draft.handlingFee.trim() !== "") {
    candidate.handlingFee = draft.handlingFee.trim();
  }
  if (draft.cap.trim() !== "") {
    candidate.cap = draft.cap.trim();
  }
  if (draft.perItemEnabled) {
    const perItem: Record<string, unknown> = { amount: draft.perItemAmount.trim() };
    const freeItemsText = draft.perItemFreeItems.trim();
    if (freeItemsText !== "") {
      const freeItems = Number.parseInt(freeItemsText, 10);
      if (Number.isFinite(freeItems) && freeItems >= 0) {
        perItem.freeItems = freeItems;
      } else {
        errors.push("Free items must be a whole number of 0 or more.");
      }
    }
    candidate.perItem = perItem;
  }
  if (draft.perWeightEnabled) {
    candidate.perWeight = { amount: draft.perWeightAmount.trim(), per: draft.perWeightUnit };
  }
  if (draft.mode === "tiered") {
    candidate.tiers = draft.tiers.map(function toTier(tier) {
      const from = Number(tier.from.trim());
      const builtTier: Record<string, unknown> = {
        basis: tier.basis,
        from: Number.isFinite(from) ? from : tier.from.trim(),
        amount: tier.amount.trim(),
      };
      if (!tier.openEnded) {
        const to = Number(tier.to.trim());
        builtTier.to = Number.isFinite(to) ? to : tier.to.trim();
      }
      return builtTier;
    });
  }

  if (errors.length > 0) {
    return { action: null, errors };
  }
  const validated = CarrierRateActionSchema.safeParse(candidate);
  if (!validated.success) {
    return {
      action: null,
      errors: validated.error.issues.map(function describe(issue) {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      }),
    };
  }
  return { action: validated.data, errors: [] };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActionEditorProps {
  kind: RuleKind;
  functionDraft: FunctionActionDraft;
  carrierDraft: CarrierDraft;
  disabled?: boolean;
  onFunctionChange(next: FunctionActionDraft): void;
  onCarrierChange(next: CarrierDraft): void;
}

export default function ActionEditor({
  kind,
  functionDraft,
  carrierDraft,
  disabled,
  onFunctionChange,
  onCarrierChange,
}: ActionEditorProps) {
  if (kind === "CARRIER_RATE") {
    return <CarrierRateFields draft={carrierDraft} disabled={disabled === true} onChange={onCarrierChange} />;
  }

  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">
        Delivery option filters — optional, leave empty to target every option
      </Text>
      <InlineStack gap="300" wrap>
        <Select
          label="Method"
          options={METHOD_OPTIONS}
          value={functionDraft.method}
          onChange={function setMethod(next: string) {
            onFunctionChange({ ...functionDraft, method: next });
          }}
          disabled={disabled}
        />
        <TextField
          label="Title contains"
          autoComplete="off"
          value={functionDraft.titleContains}
          onChange={function setTitleContains(next: string) {
            onFunctionChange({ ...functionDraft, titleContains: next });
          }}
          helpText="Case-insensitive substring match on the delivery option title."
          disabled={disabled}
        />
      </InlineStack>
      {kind === "RENAME" ? (
        <TextField
          label="New title"
          autoComplete="off"
          value={functionDraft.title}
          onChange={function setTitle(next: string) {
            onFunctionChange({ ...functionDraft, title: next });
          }}
          helpText="Replaces the option title when the rule applies."
          disabled={disabled}
        />
      ) : null}
      {kind === "MOVE" ? (
        <TextField
          label="Position (0 = first)"
          type="number"
          min={0}
          autoComplete="off"
          value={functionDraft.position}
          onChange={function setPosition(next: string) {
            onFunctionChange({ ...functionDraft, position: next });
          }}
          helpText="Whole number; smaller values move the option earlier. Clamped to 0 on save."
          disabled={disabled}
        />
      ) : null}
    </BlockStack>
  );
}

interface CarrierRateFieldsProps {
  draft: CarrierDraft;
  disabled: boolean;
  onChange(next: CarrierDraft): void;
}

function CarrierRateFields({ draft, disabled, onChange }: CarrierRateFieldsProps) {
  function patch(next: Partial<CarrierDraft>) {
    onChange({ ...draft, ...next });
  }

  function patchTier(index: number, next: Partial<TierDraft>) {
    patch({
      tiers: draft.tiers.map(function update(tier, tierIndex) {
        return tierIndex === index ? { ...tier, ...next } : tier;
      }),
    });
  }

  function addTier() {
    patch({
      tiers: [
        ...draft.tiers,
        { basis: "weight", from: "0", to: "10", amount: "", openEnded: false },
      ],
    });
  }

  function removeTier(index: number) {
    patch({
      tiers: draft.tiers.filter(function keep(_, tierIndex) {
        return tierIndex !== index;
      }),
    });
  }

  return (
    <BlockStack gap="400">
      <InlineStack gap="300" wrap>
        <TextField
          label="Service name"
          autoComplete="off"
          value={draft.serviceName}
          onChange={function setServiceName(next: string) {
            patch({ serviceName: next });
          }}
          helpText="Shown to customers as the rate name."
          disabled={disabled}
        />
        <TextField
          label="Service code"
          autoComplete="off"
          value={draft.serviceCode}
          onChange={function setServiceCode(next: string) {
            patch({ serviceCode: next });
          }}
          helpText="Stable code used by the carrier callback."
          disabled={disabled}
        />
      </InlineStack>
      <TextField
        label="Description (optional)"
        autoComplete="off"
        value={draft.description}
        onChange={function setDescription(next: string) {
          patch({ description: next });
        }}
        disabled={disabled}
      />
      <Select
        label="Rate mode"
        options={RATE_MODE_OPTIONS}
        value={draft.mode}
        onChange={function setMode(next: string) {
          patch({ mode: next as RateMode });
        }}
        disabled={disabled}
      />
      {draft.mode === "flat" ? (
        <TextField
          label="Flat amount"
          autoComplete="off"
          placeholder="0.00"
          value={draft.amount}
          onChange={function setAmount(next: string) {
            patch({ amount: next });
          }}
          helpText={MONEY_HELP_TEXT}
          disabled={disabled}
        />
      ) : null}
      {draft.mode === "percentage" ? (
        <TextField
          label="Percentage (0–100)"
          type="number"
          min={0}
          max={100}
          autoComplete="off"
          value={draft.percentage}
          onChange={function setPercentage(next: string) {
            patch({ percentage: next });
          }}
          helpText="Applied to the matched delivery option's price."
          disabled={disabled}
        />
      ) : null}
      {draft.mode === "tiered" ? (
        <BlockStack gap="200">
          <Text as="h4" variant="headingSm">
            Tiered bands
          </Text>
          {draft.tiers.map(function renderTier(tier, index) {
            return (
              <InlineStack key={index} gap="200" blockAlign="end" wrap>
                <Select
                  label={index === 0 ? "Basis" : ""}
                  labelHidden={index !== 0}
                  options={TIER_BASIS_OPTIONS}
                  value={tier.basis}
                  onChange={function setBasis(next: string) {
                    patchTier(index, { basis: next as TierDraft["basis"] });
                  }}
                  disabled={disabled}
                />
                <TextField
                  label={index === 0 ? "From" : ""}
                  labelHidden={index !== 0}
                  type="number"
                  min={0}
                  autoComplete="off"
                  value={tier.from}
                  onChange={function setFrom(next: string) {
                    patchTier(index, { from: next });
                  }}
                  disabled={disabled}
                />
                <TextField
                  label={index === 0 ? "To" : ""}
                  labelHidden={index !== 0}
                  type="number"
                  min={0}
                  autoComplete="off"
                  value={tier.to}
                  onChange={function setTo(next: string) {
                    patchTier(index, { to: next });
                  }}
                  helpText={tier.openEnded ? "Open-ended band." : undefined}
                  disabled={disabled || tier.openEnded}
                />
                <Switch
                  label="Open-ended"
                  checked={tier.openEnded}
                  onChange={function setOpenEnded(next: boolean) {
                    patchTier(index, { openEnded: next });
                  }}
                  disabled={disabled}
                />
                <TextField
                  label={index === 0 ? "Amount" : ""}
                  labelHidden={index !== 0}
                  autoComplete="off"
                  placeholder="0.00"
                  value={tier.amount}
                  onChange={function setTierAmount(next: string) {
                    patchTier(index, { amount: next });
                  }}
                  helpText={index === 0 ? MONEY_HELP_TEXT : undefined}
                  disabled={disabled}
                />
                <Button
                  icon={DeleteIcon}
                  variant="plain"
                  tone="critical"
                  accessibilityLabel="Remove tier"
                  onClick={function remove() {
                    removeTier(index);
                  }}
                  disabled={disabled}
                />
              </InlineStack>
            );
          })}
          <Box>
            <Button icon={PlusIcon} onClick={addTier} disabled={disabled}>
              Add tier
            </Button>
          </Box>
        </BlockStack>
      ) : null}
      <BlockStack gap="300">
        <Switch
          label="Charge per item"
          checked={draft.perItemEnabled}
          onChange={function togglePerItem(next: boolean) {
            patch({ perItemEnabled: next });
          }}
          disabled={disabled}
        />
        {draft.perItemEnabled ? (
          <InlineStack gap="300" wrap>
            <TextField
              label="Per-item amount"
              autoComplete="off"
              placeholder="0.00"
              value={draft.perItemAmount}
              onChange={function setPerItemAmount(next: string) {
                patch({ perItemAmount: next });
              }}
              helpText={MONEY_HELP_TEXT}
              disabled={disabled}
            />
            <TextField
              label="Free items"
              type="number"
              min={0}
              autoComplete="off"
              value={draft.perItemFreeItems}
              onChange={function setFreeItems(next: string) {
                patch({ perItemFreeItems: next });
              }}
              helpText="First N items are free (optional)."
              disabled={disabled}
            />
          </InlineStack>
        ) : null}
        <Switch
          label="Charge per weight"
          checked={draft.perWeightEnabled}
          onChange={function togglePerWeight(next: boolean) {
            patch({ perWeightEnabled: next });
          }}
          disabled={disabled}
        />
        {draft.perWeightEnabled ? (
          <InlineStack gap="300" wrap>
            <TextField
              label="Per-weight amount"
              autoComplete="off"
              placeholder="0.00"
              value={draft.perWeightAmount}
              onChange={function setPerWeightAmount(next: string) {
                patch({ perWeightAmount: next });
              }}
              helpText={MONEY_HELP_TEXT}
              disabled={disabled}
            />
            <Select
              label="Weight unit"
              options={WEIGHT_UNIT_OPTIONS}
              value={draft.perWeightUnit}
              onChange={function setUnit(next: string) {
                patch({ perWeightUnit: next === "lb" ? "lb" : "kg" });
              }}
              disabled={disabled}
            />
          </InlineStack>
        ) : null}
        <InlineStack gap="300" wrap>
          <TextField
            label="Handling fee (optional)"
            autoComplete="off"
            placeholder="0.00"
            value={draft.handlingFee}
            onChange={function setHandlingFee(next: string) {
              patch({ handlingFee: next });
            }}
            helpText={MONEY_HELP_TEXT}
            disabled={disabled}
          />
          <TextField
            label="Cap (optional)"
            autoComplete="off"
            placeholder="0.00"
            value={draft.cap}
            onChange={function setCap(next: string) {
              patch({ cap: next });
            }}
            helpText={`Maximum total rate. ${MONEY_HELP_TEXT}`}
            disabled={disabled}
          />
        </InlineStack>
      </BlockStack>
    </BlockStack>
  );
}
