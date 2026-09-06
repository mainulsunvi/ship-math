import {
  BlockStack,
  Box,
  Button,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import {
  POSTAL_MODES,
  type PostalMode,
  type PostalRule,
} from "../../lib/config-schema";
import { formatForDisplay, PARTIAL_COUNTRIES } from "../../lib/postal";
import AccentChip from "../ui/AccentChip";

/**
 * Single postal rule editor (spec 004 Task 2) — mode picker constrained per
 * country selection (PARTIAL is UK/CA only, validated with
 * validatePartialPattern), numeric RANGE with min < max, EXACT/PREFIX as
 * free strings, and a human preview via formatForDisplay.
 *
 * validatePostalRuleForCountries lives in app/lib/postal.ts so the zone
 * route action and the modal share it without a server→components import
 * (review 004/005); this editor imports the PARTIAL country list from
 * there too.
 */

const MODE_LABELS: Record<PostalMode, string> = {
  EXACT: "Exact match",
  PREFIX: "Starts with (prefix)",
  RANGE: "Numeric range",
  PARTIAL: "Partial code (UK/CA)",
};

function allowsPartial(countries: string[]): boolean {
  if (countries.length !== 1) {
    return false;
  }
  return PARTIAL_COUNTRIES.includes(countries[0].trim().toUpperCase());
}

function modeOptionsFor(countries: string[]): Array<{ label: string; value: PostalMode }> {
  const partialAllowed = allowsPartial(countries);
  return POSTAL_MODES.filter(function allowed(mode) {
    return mode !== "PARTIAL" || partialAllowed;
  }).map(function toOption(mode) {
    return { label: MODE_LABELS[mode], value: mode };
  });
}

interface PostalRuleEditorProps {
  rule: PostalRule;
  countries: string[];
  disabled?: boolean;
  error?: string;
  onChange(next: PostalRule): void;
  onRemove(): void;
}

export default function PostalRuleEditor({
  rule,
  countries,
  disabled,
  error,
  onChange,
  onRemove,
}: PostalRuleEditorProps) {
  const currentModeAllowed = modeOptionsFor(countries).some(function matches(option) {
    return option.value === rule.mode;
  });

  function handleModeChange(next: string) {
    const mode = next as PostalMode;
    onChange({
      id: rule.id,
      mode,
      value: rule.value,
      ...(mode === "RANGE" && rule.rangeEnd !== undefined ? { rangeEnd: rule.rangeEnd } : {}),
    });
  }

  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="end" wrap>
          <Select
            label="Match mode"
            options={
              currentModeAllowed
                ? modeOptionsFor(countries)
                : [{ label: MODE_LABELS[rule.mode], value: rule.mode }, ...modeOptionsFor(countries)]
            }
            value={rule.mode}
            onChange={handleModeChange}
            helpText={rule.mode === "PARTIAL" ? "Only for a single UK or Canada selection." : undefined}
            disabled={disabled}
          />
          <TextField
            label={rule.mode === "RANGE" ? "From" : "Value"}
            autoComplete="off"
            value={rule.value}
            onChange={function setValue(next: string) {
              onChange({ ...rule, value: next });
            }}
            disabled={disabled}
          />
          {rule.mode === "RANGE" ? (
            <TextField
              label="To"
              autoComplete="off"
              value={rule.rangeEnd ?? ""}
              onChange={function setRangeEnd(next: string) {
                onChange({ ...rule, rangeEnd: next });
              }}
              disabled={disabled}
            />
          ) : null}
          <Button
            icon={DeleteIcon}
            variant="plain"
            tone="critical"
            accessibilityLabel="Remove postal rule"
            onClick={onRemove}
            disabled={disabled}
          />
        </InlineStack>
        <BlockStack gap="100">
          <InlineStack gap="150" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              Preview:
            </Text>
            <AccentChip>{formatForDisplay(rule.mode, rule)}</AccentChip>
          </InlineStack>
          {error ? (
            <Text as="span" variant="bodySm" tone="critical">
              {error}
            </Text>
          ) : null}
        </BlockStack>
      </BlockStack>
    </Box>
  );
}
