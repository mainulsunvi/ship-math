import { BlockStack, Card, Text } from "@shopify/polaris";
import { DeliveryIcon } from "@shopify/polaris-icons";
import SettingToggle from "../ui/SettingToggle";
import StepHeader from "./StepHeader";

/**
 * Wizard step 5 (CCS_ELIGIBLE/ALL shops only; FUNCTIONS_ONLY never renders
 * it, so no carrier registration is ever attempted on Basic). Plain-word
 * explanation of carrier rates plus the Register carrier rates switch; its
 * value feeds carrier: "1" into the wizard-complete intent. The 2026-09-10
 * redesign gives the toggle a card of its own under the delivery-icon
 * header. The control stays the app-wide Switch via SettingToggle
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
        description="Carrier rates let ShipMath calculate shipping costs on its own server and send them to checkout. When a customer checks out, Shopify asks ShipMath for rates through a secure callback, and your rules decide the price."
      />
      <Card>
        <BlockStack gap="300">
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
