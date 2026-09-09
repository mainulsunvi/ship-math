import { BlockStack, Box, Card, Text } from "@shopify/polaris";
import { StoreIcon } from "@shopify/polaris-icons";
import { PLAN_CLASS_LABELS, type PlanClass } from "../../lib/plan";
import StepHeader, { StateRow } from "./StepHeader";

/**
 * Wizard step 2: the classified plan (friendly label only, never the raw
 * enum) plus a short plain-English explanation per class (spec 003, plan
 * Task 4). FUNCTIONS_ONLY shops are steered to the delivery-customization
 * path; CCS_ELIGIBLE/ALL shops learn the carrier lane exists. The
 * 2026-09-10 redesign adds capability rows (delivery rules / carrier rates)
 * with included/excluded state icons.
 */

interface StepPlanGuidanceProps {
  planClass: PlanClass;
}

const PLAN_STEP_EXPLANATIONS: Record<PlanClass, string> = {
  FUNCTIONS_ONLY:
    "Your Shopify plan supports delivery customization rules, so you can hide, rename, and reorder the shipping options your store already shows. Carrier-calculated rates are not included on this plan; they need a higher plan or annual billing. This walkthrough focuses on delivery rules, which work on every plan.",
  CCS_ELIGIBLE:
    "Your Shopify plan can use carrier-calculated shipping, so ShipMath can calculate live rates on its own server and show them at checkout. Delivery rules for hiding, renaming, and reordering options are included too.",
  ALL:
    "This is a development store, so every ShipMath feature is unlocked: delivery rules and carrier-calculated rates. You can try both safely before anything reaches a live checkout.",
};

function StepPlanGuidance({ planClass }: StepPlanGuidanceProps) {
  const carrierIncluded = planClass !== "FUNCTIONS_ONLY";
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={StoreIcon}
        title="Your Plan"
        description="ShipMath checked your store's Shopify plan. Here is what it unlocks."
      />
      <Card>
        <BlockStack gap="300">
          <Text as="p" variant="headingMd">
            {PLAN_CLASS_LABELS[planClass]}
          </Text>
          <Text as="p" variant="bodyMd">
            {PLAN_STEP_EXPLANATIONS[planClass]}
          </Text>
          <Box borderBlockStartWidth="025" borderColor="border" />
          <BlockStack gap="200">
            <StateRow
              included
              title="Delivery rules"
              description="Hide, rename, and reorder the shipping options checkout already shows."
            />
            <StateRow
              included={carrierIncluded}
              title="Carrier rates"
              description={
                carrierIncluded
                  ? "ShipMath calculates live rates and shows them at checkout."
                  : "Needs a Shopify plan with carrier-calculated shipping, or annual billing."
              }
            />
          </BlockStack>
        </BlockStack>
      </Card>
      <Text as="p" variant="bodySm" tone="subdued">
        If you switch plans later, ShipMath updates its guidance automatically.
      </Text>
    </BlockStack>
  );
}

export default StepPlanGuidance;
