import { BlockStack, Box, Card, Link, Text } from "@shopify/polaris";
import { PlayCircleIcon } from "@shopify/polaris-icons";
import StepHeader from "./StepHeader";

/**
 * Wizard step 6: test mode reassurance. Fresh installs start with test mode
 * ON, so the copy explains checkout stays safe, points at the Simulator for
 * previewing, and at Settings for going live (spec 003, plan Task 4).
 * Follows the unified step layout (2026-09-10), mirroring the Plan/Carrier
 * cards: one-line header description, Card with the current state paragraph
 * then a divider then the preview guidance, muted footnote outside.
 */

interface StepTestModeProps {
  testMode: boolean;
}

function StepTestMode({ testMode }: StepTestModeProps) {
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={PlayCircleIcon}
        title="Test Mode"
        description="Test mode keeps your live checkout safe while you set things up."
      />
      <Card>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            {testMode
              ? "Test mode is on right now, so nothing you set up in this walkthrough changes what customers see until you go live."
              : "Test mode is off right now, so changes can reach checkout once you finish. You can turn it on in Settings first if you prefer to preview."}
          </Text>
          <Box borderBlockStartWidth="025" borderColor="border" />
          <Text as="p" variant="bodyMd">
            Preview your rules on the <Link url="/app/simulator">Simulator</Link> page, then turn
            test mode off and press Go live in <Link url="/app/settings">Settings</Link> when you
            are ready.
          </Text>
        </BlockStack>
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">
        Finishing setup does not skip that step for you; going live stays in your hands.
      </Text>
    </BlockStack>
  );
}

export default StepTestMode;
