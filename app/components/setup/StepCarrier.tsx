import { BlockStack, Box, Card, Text } from "@shopify/polaris";
import { DeliveryIcon } from "@shopify/polaris-icons";
import SettingToggle from "../ui/SettingToggle";
import StepHeader from "./StepHeader";

/**
 * Wizard step 5 (CCS_ELIGIBLE/ALL shops only; FUNCTIONS_ONLY never renders
 * it, so no carrier registration is ever attempted on Basic). Its value
 * feeds carrier: "1" into the wizard-complete intent. Follows the unified
 * step layout (2026-09-10), structurally mirroring the Plan step: one-line
 * header description, a Card holding the explanation paragraph then a
 * divider then the Register carrier rates switch, and a muted footnote
 * outside. The control stays the app-wide Switch via SettingToggle
 * (convention: every boolean toggle uses app/components/ui/Switch.tsx).
 */

interface StepCarrierProps {
  enabled: boolean;
  onChange(next: boolean): void;
}

function StepCarrier({ enabled, onChange }: StepCarrierProps) {
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={DeliveryIcon}
        title="Carrier Rates"
        description="ShipMath can calculate live rates on its own server and show them at checkout."
      />
      <Card>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            When a customer checks out, Shopify will ask ShipMath for a price through a secure
            callback, and your rules decide it. Turning this on registers carrier rates as part
            of finishing setup.
          </Text>
          <Box borderBlockStartWidth="025" borderColor="border" />
          <SettingToggle
            label="Register carrier rates"
            helpText="Checkout will call ShipMath for live rates through a secure callback."
            enabled={enabled}
            onChange={onChange}
          />
        </BlockStack>
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">
        Leave this off to finish with delivery rules only. You can register carrier rates any
        time from Settings.
      </Text>
    </BlockStack>
  );
}

export default StepCarrier;
