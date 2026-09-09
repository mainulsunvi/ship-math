import { Banner, BlockStack, Card, Text } from "@shopify/polaris";
import { ClipboardChecklistIcon } from "@shopify/polaris-icons";
import type { MirrorSyncReport } from "../../lib/sync";
import SyncReportWarnings from "../rules/SyncReportWarnings";
import StepHeader, { StateRow } from "./StepHeader";
import { pluralCount } from "./wizard-shared";

/**
 * Wizard final step: summary of what Finish setup does, plus the outcome of
 * the wizard-complete post. On ok the wizard closes and SetupWizard renders
 * a page-level success banner (with Simulator/Settings links and the shared
 * SyncReportWarnings for a lossy success report). On ok: false (mirror sync
 * failed AFTER the drafts were enabled and onboardedAt was stamped) the
 * wizard stays open with the message in a critical banner, the shared
 * SyncReportWarnings renders underneath for any report detail, and the
 * merchant is pointed at the dashboard's retry. The 2026-09-10 redesign
 * renders the summary as a checklist with state icons.
 */

interface StepDoneProps {
  ruleCount: number;
  zoneDraftCount: number;
  carrierOffered: boolean;
  carrierOn: boolean;
  /** null = not submitted yet; true = completed; false = completed with a failed sync. */
  replyOk: boolean | null;
  replyMessage: string | null;
  sync: MirrorSyncReport | null;
}

function StepDone({
  ruleCount,
  zoneDraftCount,
  carrierOffered,
  carrierOn,
  replyOk,
  replyMessage,
  sync,
}: StepDoneProps) {
  return (
    <BlockStack gap="400">
      <StepHeader
        icon={ClipboardChecklistIcon}
        title="Finish Setup"
        description="A quick summary of what happens when you press Finish setup."
      />
      {replyOk === true ? (
        <Banner tone="success" title="Setup Complete">
          <Text as="p" variant="bodySm">
            {replyMessage}
          </Text>
        </Banner>
      ) : null}
      {replyOk === false ? (
        <>
          <Banner tone="critical" title="Setup Saved, Sync Failed">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {replyMessage}
              </Text>
              <Text as="p" variant="bodySm">
                Close this wizard and use Retry sync on the dashboard to push your
                configuration.
              </Text>
            </BlockStack>
          </Banner>
          <SyncReportWarnings sync={sync} />
        </>
      ) : null}
      <Card>
        <BlockStack gap="300">
          {ruleCount === 0 && zoneDraftCount === 0 ? (
            <StateRow
              included
              title="No draft rules or zones turn on"
              description="Your configuration syncs to the checkout Function as is."
            />
          ) : (
            <StateRow
              included
              title={`${pluralCount(ruleCount, "draft rule")} and ${pluralCount(zoneDraftCount, "draft zone")} turn on`}
              description="Drafts were kept off while you explored; finishing switches them on."
            />
          )}
          <StateRow
            included
            title="ShipMath syncs your configuration"
            description="The checkout Function picks up the new configuration on the next checkout."
          />
          {carrierOffered && carrierOn ? (
            <StateRow
              included
              title="Carrier rates are registered"
              description="Shopify starts asking ShipMath for live rates at checkout."
            />
          ) : carrierOffered ? (
            <StateRow
              included={false}
              title="Carrier rates stay off"
              description="You can register them any time from Settings."
            />
          ) : (
            <StateRow
              included
              title="Delivery rules handle checkout"
              description="Your Shopify plan runs checkout through delivery customization."
            />
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

export default StepDone;
