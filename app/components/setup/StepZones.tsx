import { Badge, BlockStack, Button, Card, Icon, InlineStack, Text } from "@shopify/polaris";
import { GlobeIcon, PlusIcon } from "@shopify/polaris-icons";
import ZoneForm, { type ZoneFormSubmitInput } from "../zones/ZoneForm";
import StepHeader from "./StepHeader";
import { pluralCount, type WizardZone } from "./wizard-shared";

/**
 * Wizard step 3: zones list from the loader + the inline Add-a-zone form.
 * Drafts are zones with enabled === false (wizard-zone-create rows); they
 * carry a Draft badge and stay disabled until the wizard completes. Since
 * 2026-09-10 the SHARED ZoneForm renders inline in the step (user request:
 * no second popup stacked on the wizard modal; mirrors how the Rates step
 * embeds RuleForm) — the same component the Zones page modal wraps, so the
 * surfaces cannot drift. SetupWizard owns the fetcher; a successful draft
 * collapses the form and the revalidated list shows the new zone.
 */

interface StepZonesProps {
  zones: WizardZone[];
  formOpen: boolean;
  busy: boolean;
  serverError: string | null;
  fieldErrors: Record<string, string> | null;
  onOpenForm(): void;
  onCloseForm(): void;
  onSubmitDraft(input: ZoneFormSubmitInput): void;
}

function StepZones({
  zones,
  formOpen,
  busy,
  serverError,
  fieldErrors,
  onOpenForm,
  onCloseForm,
  onSubmitDraft,
}: StepZonesProps) {
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={GlobeIcon}
        title="Delivery Zones"
        description="Zones group destinations by country, province, and postal code, so a rule can target exactly where it applies."
      />
      {formOpen ? (
        <Card>
          <ZoneForm
            submitLabel="Save draft"
            busy={busy}
            serverError={serverError}
            fieldErrors={fieldErrors}
            draft
            onSubmit={onSubmitDraft}
            onCancel={onCloseForm}
          />
        </Card>
      ) : (
        <Card>
          <BlockStack gap="300">
            {zones.length === 0 ? (
              <div className="sm-wizard-empty">
                <Text as="p" variant="bodySm" tone="subdued">
                  No zones yet. Add one now, or skip this step and manage zones later on the Zones
                  page.
                </Text>
                <Button icon={PlusIcon} onClick={onOpenForm}>
                  Add a zone
                </Button>
              </div>
            ) : (
              <>
                <Text as="p" variant="bodySm" tone="subdued">
                  {pluralCount(zones.length, "zone")} total. Draft zones turn on when you finish
                  setup.
                </Text>
                <BlockStack gap="200">
                  {zones.map(function renderZone(zone) {
                    return (
                      <div key={zone.id} className="sm-wizard-row">
                        <span className="sm-wizard-row__icon" aria-hidden="true">
                          <Icon source={GlobeIcon} />
                        </span>
                        <Text as="span" variant="bodyMd">
                          {zone.name}
                        </Text>
                        {zone.enabled ? null : <Badge tone="attention">Draft</Badge>}
                      </div>
                    );
                  })}
                </BlockStack>
                <InlineStack>
                  <Button icon={PlusIcon} onClick={onOpenForm}>
                    Add a zone
                  </Button>
                </InlineStack>
              </>
            )}
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

export default StepZones;
