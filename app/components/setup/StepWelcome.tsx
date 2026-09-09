import { BlockStack, Card, Text } from "@shopify/polaris";
import { DeliveryIcon, ListBulletedIcon, PlayCircleIcon, StoreIcon } from "@shopify/polaris-icons";
import StepHeader, { FeatureRow } from "./StepHeader";

/**
 * Wizard step 1: greeting + one-sentence value pitch + what the walkthrough
 * covers (spec 003, plan Task 4). Purely presentational. Follows the unified
 * step layout (2026-09-10): StepHeader, one Card body, muted footnote.
 */

interface StepWelcomeProps {
  shopName: string | null;
  /** Whether the walkthrough includes the Carrier Rates step (CCS plans only). */
  carrierStepIncluded: boolean;
}

function StepWelcome({ shopName, carrierStepIncluded }: StepWelcomeProps) {
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={StoreIcon}
        title={shopName ? `Welcome to ShipMath, ${shopName}` : "Welcome to ShipMath"}
        description="ShipMath controls how shipping options appear and are priced at checkout."
      />
      <Card>
        <BlockStack gap="300">
          <FeatureRow
            icon={ListBulletedIcon}
            title="Delivery rules"
            description="Hide, rename, and reorder the shipping options your store already shows."
          />
          {carrierStepIncluded ? (
            <FeatureRow
              icon={DeliveryIcon}
              title="Carrier rates"
              description="Replace checkout rates with your own, calculated live."
            />
          ) : null}
          <FeatureRow
            icon={PlayCircleIcon}
            title="Safe testing"
            description="Test mode starts on, so nothing reaches customers until you go live."
          />
        </BlockStack>
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">
        Every step is optional. You can skip ahead and finish later; nothing turns on until you
        press Finish setup.
      </Text>
    </BlockStack>
  );
}

export default StepWelcome;
