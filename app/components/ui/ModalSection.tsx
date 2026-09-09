import { BlockStack, Box, InlineStack, Text } from "@shopify/polaris";
import type { ReactNode } from "react";
import HelpTooltip from "./HelpTooltip";

interface ModalSectionProps {
  /** Small headingSm label for the major form area (e.g. "Identity"). */
  label: string;
  /** Optional longer explanation, shown through the HelpTooltip icon. */
  help?: string;
  /** Omit the top divider — use for the first section in a modal. */
  divider?: boolean;
  children: ReactNode;
}

/**
 * Labeled, divided major form area inside an editor modal (rules and zones
 * editors share this treatment per docs/INSTRUCTION.md — heading + hairline
 * top border so long forms scan in blocks). Layout only; no behavior.
 */
function ModalSection({ label, help, divider = true, children }: ModalSectionProps) {
  return (
    <Box
      borderBlockStartWidth={divider ? "025" : undefined}
      borderColor={divider ? "border" : undefined}
      paddingBlockStart={divider ? "300" : undefined}
    >
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {label}
          </Text>
          {help ? <HelpTooltip content={help} /> : null}
        </InlineStack>
        {children}
      </BlockStack>
    </Box>
  );
}

export default ModalSection;
