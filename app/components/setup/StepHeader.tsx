import { BlockStack, Icon, InlineStack, Text } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";
import { CheckIcon, MinusCircleIcon } from "@shopify/polaris-icons";

interface StepHeaderProps {
  icon: IconSource;
  title: string;
  description?: string;
}

/**
 * Shared wizard step header (2026-09-10 redesign): brand icon tile, step
 * title, and a one-line muted description, so every step opens with the
 * same visual rhythm. The modal title stays fixed ("Set Up ShipMath"); each
 * step carries its own heading here.
 */
function StepHeader({ icon, title, description }: StepHeaderProps) {
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <span className="sm-wizard-tile" aria-hidden="true">
        <Icon source={icon} />
      </span>
      <BlockStack gap="025">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {description ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        ) : null}
      </BlockStack>
    </InlineStack>
  );
}

interface FeatureRowProps {
  icon: IconSource;
  title: string;
  description: string;
}

/** Icon tile + stacked title/description row (welcome features). */
export function FeatureRow({ icon, title, description }: FeatureRowProps) {
  return (
    <InlineStack gap="300" blockAlign="center">
      <span className="sm-wizard-tile sm-wizard-tile--small" aria-hidden="true">
        <Icon source={icon} />
      </span>
      <BlockStack gap="025">
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

interface StateRowProps {
  included: boolean;
  title: string;
  description: string;
}

/** Check/minus state row (plan capabilities, finish checklist). */
export function StateRow({ included, title, description }: StateRowProps) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <span className={included ? "sm-wizard-ok" : "sm-wizard-no"} aria-hidden="true">
        <Icon source={included ? CheckIcon : MinusCircleIcon} />
      </span>
      <BlockStack gap="025">
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {title}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </InlineStack>
  );
}

export default StepHeader;
