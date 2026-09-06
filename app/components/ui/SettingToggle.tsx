import { BlockStack, InlineStack, Text } from "@shopify/polaris";
import Switch from "./Switch";

/**
 * Reusable Polaris setting row: label + help text on the left, toggle on the
 * right. Used wherever a boolean setting is edited inline (rule editor's
 * stop-on-match, the zone editor's enabled state) so the markup lives in
 * exactly one place per docs/INSTRUCTION.md. The control is the app-wide
 * Switch primitive (user directive 2026-09-06); the label still doubles as
 * its accessible name even though it is visually hidden here.
 */

interface SettingToggleProps {
  label: string;
  helpText?: string;
  enabled: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}

export default function SettingToggle({
  label,
  helpText,
  enabled,
  disabled,
  onChange,
}: SettingToggleProps) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="400">
      <BlockStack gap="100">
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {label}
        </Text>
        {helpText ? (
          <Text as="span" variant="bodySm" tone="subdued">
            {helpText}
          </Text>
        ) : null}
      </BlockStack>
      <Switch
        label={label}
        labelHidden
        checked={enabled}
        disabled={disabled}
        onChange={onChange}
      />
    </InlineStack>
  );
}
