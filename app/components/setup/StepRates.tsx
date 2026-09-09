import { Badge, BlockStack, Box, Button, Card, Icon, InlineStack, Text } from "@shopify/polaris";
import {
  ListBulletedIcon,
  MagicIcon,
  PlusIcon,
  PriceListIcon,
} from "@shopify/polaris-icons";
import RuleForm, { type RuleFormSubmitInput } from "../rules/RuleForm";
import StepHeader from "./StepHeader";
import { pluralCount, type WizardZone } from "./wizard-shared";

/**
 * Wizard step 4: rate rules (spec 003, plan Task 4).
 *   - "Set up with AI" is a clearly marked placeholder card (criterion 5:
 *     offered, visibly not shipped yet; declining never blocks completion).
 *   - The manual path embeds the shared RuleForm (mode "create") and posts
 *     wizard-rule-create through SetupWizard's fetcher: rows land as
 *     disabled drafts and appear here after the loader revalidates.
 * The 2026-09-10 redesign styles the AI offer with a magic-icon tile plus a
 * Coming soon badge, and lists drafts as card rows.
 */

interface StepRatesProps {
  zones: WizardZone[];
  drafts: Array<{ id: string; name: string }>;
  formOpen: boolean;
  busy: boolean;
  serverError: string | null;
  suggestedPriority: number;
  onOpenForm(): void;
  onCloseForm(): void;
  onSubmitDraft(input: RuleFormSubmitInput): void;
}

function StepRates({
  zones,
  drafts,
  formOpen,
  busy,
  serverError,
  suggestedPriority,
  onOpenForm,
  onCloseForm,
  onSubmitDraft,
}: StepRatesProps) {
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={PriceListIcon}
        title="Rate Rules"
        description="Rules decide what checkout shows and what it costs. Build your first one now, or any time later."
      />
      {formOpen ? (
        <RuleForm
          mode="create"
          zones={zones}
          suggestedPriority={suggestedPriority}
          submitLabel="Save draft"
          busy={busy}
          serverError={serverError}
          onSubmit={onSubmitDraft}
          onCancel={onCloseForm}
        />
      ) : (
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <span className="sm-wizard-tile sm-wizard-tile--small" aria-hidden="true">
                <Icon source={MagicIcon} />
              </span>
              <Text as="h3" variant="headingSm">
                Set Up With AI
              </Text>
              <Badge tone="info">Coming soon</Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              AI setup is coming soon. You will describe your shipping needs in plain words and
              ShipMath will draft the rules for you.
            </Text>
            <InlineStack>
              <Button disabled>Set up with AI</Button>
            </InlineStack>
            <Box borderBlockStartWidth="025" borderColor="border" />
            <Text as="h3" variant="headingSm">
              Set Up Manually
            </Text>
            <Text as="p" variant="bodyMd">
              Build a rule step by step: choose when it applies, what it changes at checkout,
              and optionally which zone it targets.
            </Text>
            {drafts.length > 0 ? (
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  {pluralCount(drafts.length, "draft rule")} saved. Draft rules turn on when you
                  finish setup.
                </Text>
                {drafts.map(function renderDraft(draft) {
                  return (
                    <div key={draft.id} className="sm-wizard-row">
                      <span className="sm-wizard-row__icon" aria-hidden="true">
                        <Icon source={ListBulletedIcon} />
                      </span>
                      <Text as="span" variant="bodyMd">
                        {draft.name}
                      </Text>
                      <Badge tone="attention">Draft</Badge>
                    </div>
                  );
                })}
              </BlockStack>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                No draft rules yet. You can also skip this and create rules later on the Rules
                page.
              </Text>
            )}
            <InlineStack>
              <Button icon={PlusIcon} onClick={onOpenForm} disabled={busy}>
                Create a rule draft
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

export default StepRates;
