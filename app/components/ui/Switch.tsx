import { InlineStack, Text } from "@shopify/polaris";

/**
 * Boolean toggle switch — the app-wide toggle primitive (user directive
 * 2026-09-06: "whenever you need any kind of toggle just use the switch").
 * Polaris 12 has no Switch component, so this wraps a native
 * <button role="switch"> styled by .sm-switch in app/styles/brand.css using
 * only Polaris color tokens and the --sm-accent family (dark-mode safe).
 * A native button gives Space/Enter keyboard activation for free.
 *
 * Rendering: InlineStack [control, label?] — the label is always required
 * (it is the accessible name via aria-label) but can be visually hidden by
 * tables and SettingToggle rows that surface it elsewhere.
 */

interface SwitchProps {
  /** Always provided; used as the aria-label and rendered visibly unless labelHidden. */
  label: string;
  /** Tables + SettingToggle rows hide it (label shown elsewhere). */
  labelHidden?: boolean;
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}

export default function Switch({
  label,
  labelHidden = false,
  checked,
  disabled = false,
  onChange,
}: SwitchProps) {
  return (
    <InlineStack blockAlign="center" gap="200" wrap={false}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-disabled={disabled}
        disabled={disabled}
        className={`sm-switch${checked ? " sm-switch--on" : ""}`}
        onClick={function handleSwitchClick() {
          if (!disabled) {
            onChange(!checked);
          }
        }}
      >
        <span className="sm-switch__knob" />
      </button>
      {labelHidden ? null : (
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
      )}
    </InlineStack>
  );
}
