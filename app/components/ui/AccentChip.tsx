import { Text } from "@shopify/polaris";
import type { ReactNode } from "react";

interface AccentChipProps {
  children: ReactNode;
}

/**
 * Small brand-accent chip (subdued accent background, accent text, hairline
 * accent border). Applied to tiny inline labels only (rule kinds, postal
 * previews) per the brand-token rules in app/styles/brand.css — large
 * surfaces stay Polaris-native. Rendered as a plain span because Polaris
 * Box/Text take token props (no arbitrary style), so the custom --sm-*
 * vars live here; the inner Text uses tone="inherit" to pick up the color.
 */
function AccentChip({ children }: AccentChipProps) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        background: "var(--sm-accent-subdued)",
        border: "var(--p-border-width-025) solid var(--sm-accent-border)",
        borderRadius: "var(--p-border-radius-100)",
        color: "var(--sm-accent-text)",
      }}
    >
      <Text as="span" variant="bodySm" tone="inherit">
        {children}
      </Text>
    </span>
  );
}

export default AccentChip;
