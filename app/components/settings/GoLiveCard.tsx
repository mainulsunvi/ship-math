import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";
import SettingToggle from "../ui/SettingToggle";
import HelpTooltip from "../ui/HelpTooltip";

/**
 * Go-live card (spec 007, plan Task 6) — the single source of truth for test
 * mode and carrier service registration. Presentational only: the settings
 * route owns the loader, the action intents, and the fetcher wiring (same
 * split as SyncStatusCard on the dashboard, which keeps STATUS only).
 *
 * States:
 *   - scope error   → Shopify API rejected the LIST call (stale scopes) →
 *                     banner asks the merchant to re-authenticate the app.
 *   - test mode     → carrier rates are not served; exit test mode to unlock
 *                     go-live.
 *   - ready         → "Go live" registers the carrier service (probe →
 *                     create) and the shop starts answering checkout calls.
 *   - live          → registration details + "Enter test mode" tears the
 *                     carrier service down again.
 *   - deleted remotely → shop still has a GID but LIST doesn't resolve it →
 *                     warning + "Go live" re-creates it (self-heal via LIST).
 */

interface GoLiveCardProps {
  testMode: boolean;
  /** GID stored on Shop.carrierServiceId (may be stale). */
  registeredId: string | null;
  /** Result of LIST lookup: null = unknown (no/failed check), false = deleted remotely. */
  liveOnShopify: boolean;
  active: boolean | null;
  carrierName: string | null;
  callbackUrl: string;
  scopeError: boolean;
  busy: boolean;
  onGoLive(): void;
  onEnterTestMode(): void;
  onToggleTestMode(next: boolean): void;
}

export default function GoLiveCard({
  testMode,
  registeredId,
  liveOnShopify,
  active,
  carrierName,
  callbackUrl,
  scopeError,
  busy,
  onGoLive,
  onEnterTestMode,
  onToggleTestMode,
}: GoLiveCardProps) {
  const live = registeredId !== null && liveOnShopify;
  const remotelyDeleted = registeredId !== null && !liveOnShopify;
  const goLiveUnlocked = !testMode && !live;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Go Live
            </Text>
            <HelpTooltip content="Going live registers a ShipMath carrier service with Shopify, so checkout starts asking ShipMath for shipping rates." />
          </InlineStack>
          <Badge tone={live ? "success" : testMode ? "attention" : "info"}>
            {live ? "Live (carrier rates on)" : testMode ? "Test mode" : "Not live yet"}
          </Badge>
        </InlineStack>

        {scopeError ? (
          <Banner tone="warning" title="Cannot Reach the Shopify Shipping API">
            <Text as="p" variant="bodySm">
              The app&apos;s access token predates the shipping scopes. Log out and back in
              (or reinstall the app) to grant them, then manage carrier services here.
            </Text>
          </Banner>
        ) : null}

        {remotelyDeleted ? (
          <Banner tone="warning" title="Carrier Service Was Deleted in Shopify Admin">
            <Text as="p" variant="bodySm">
              ShipMath still expects a carrier service, but Shopify no longer has it.
              Press &quot;Go live&quot; again to recreate it. Rates are not served until then.
            </Text>
          </Banner>
        ) : null}

        <List>
          <List.Item>
            Status: {live ? "Registered. ShipMath answers rate requests at checkout." : "Not registered. Checkout uses your store's own rates only."}
          </List.Item>
          <List.Item>Test mode: {testMode ? "On (no carrier rates are served)" : "Off"}</List.Item>
          <List.Item>
            Registration: {registeredId ?? "—"}{carrierName ? ` (${carrierName}${active === false ? ", inactive" : ""})` : ""}
          </List.Item>
          <List.Item>Callback URL: {callbackUrl}</List.Item>
        </List>

        <InlineStack gap="300">
          {goLiveUnlocked ? (
            <Button variant="primary" loading={busy} onClick={onGoLive}>
              Go live
            </Button>
          ) : null}
          {live ? (
            <Button tone="critical" loading={busy} onClick={onEnterTestMode}>
              Enter test mode (remove carrier service)
            </Button>
          ) : null}
        </InlineStack>
        <SettingToggle
          label="Test mode"
          helpText="While on, ShipMath applies no operations and serves no rates. The carrier registration is kept, so rates resume when you switch it off."
          enabled={testMode}
          disabled={busy}
          onChange={onToggleTestMode}
        />

        <Text as="p" variant="bodySm" tone="subdued">
          {live
            ? "Entering test mode removes the carrier service at Shopify, so checkout stops calling ShipMath immediately."
            : "Going live registers one \u201CShipMath\u201D carrier service; checkout then calls ShipMath for rates before falling back to your standard rates."}
        </Text>
      </BlockStack>
    </Card>
  );
}
