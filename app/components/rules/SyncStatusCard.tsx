import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  List,
  ProgressBar,
  Text,
} from "@shopify/polaris";

/**
 * Checkout Function status card — extracted verbatim from the rules dashboard
 * (spec 005 Task 4) so the same status surface can be reused elsewhere.
 * Behavior is unchanged: owner state, enabled function rules, last sync,
 * evaluation mode, live byte budget meter, sync/seed/test-mode actions.
 */

interface SyncStatusCardProps {
  ownerId: string | null;
  syncedAt: string | null;
  ruleCount: number;
  evaluationMode: string;
  testMode: boolean;
  bytes: number;
  budgetError: string | null;
  cap: number;
  busy: boolean;
  onSync(): void;
  onSeed(): void;
}

export default function SyncStatusCard({
  ownerId,
  syncedAt,
  ruleCount,
  evaluationMode,
  testMode,
  bytes,
  budgetError,
  cap,
  busy,
  onSync,
  onSeed,
}: SyncStatusCardProps) {
  const budgetPct = Math.min(100, Math.round((bytes / cap) * 100));

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            Checkout Function status
          </Text>
          <Badge tone={ownerId ? "success" : "attention"}>
            {ownerId ? "Owner created" : "No owner yet"}
          </Badge>
        </InlineStack>
        <List>
          <List.Item>
            Delivery customization owner:{" "}
            {ownerId ? (
              <Text as="span" variant="bodySm" tone="subdued">
                {ownerId}
              </Text>
            ) : (
              "— (created on first sync)"
            )}
          </List.Item>
          <List.Item>Function rules enabled: {ruleCount}</List.Item>
          <List.Item>Last synced: {syncedAt ? new Date(syncedAt).toLocaleString() : "never"}</List.Item>
          <List.Item>Evaluation mode: {evaluationMode === "ALL_MATCH" ? "all matches" : "first match"}</List.Item>
          <List.Item>Health: {budgetPct > 90 ? "Critical" : "Good"}</List.Item>
        </List>
        <Box paddingBlockStart="200">
          <Text as="p" variant="bodySm">
            Config budget: {bytes} / {cap} bytes (checkout Functions can&apos;t read past this)
          </Text>
          <Box paddingBlockStart="200">
            <ProgressBar progress={budgetPct} tone={budgetPct > 90 ? "critical" : "highlight"} size="small" />
          </Box>
          {budgetError ? (
            <Box paddingBlockStart="200">
              <Banner tone="critical">{budgetError}</Banner>
            </Box>
          ) : null}
        </Box>
        <InlineStack gap="300">
          <Button variant="primary" loading={busy} onClick={onSync}>
            Sync config to checkout
          </Button>
          <Button loading={busy} onClick={onSeed}>
            Add sample rules
          </Button>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Test mode is {testMode ? "ON (the Function applies no operations)" : "off"} ·{" "}
          go-live and test mode are managed in Settings.
        </Text>
      </BlockStack>
    </Card>
  );
}
