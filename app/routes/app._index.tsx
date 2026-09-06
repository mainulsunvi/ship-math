import { useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  Badge,
  Banner,
  InlineStack,
  ProgressBar,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma, {
  getOrCreateShop,
  countFunctionRules,
  isFunctionSyncStale,
} from "../db.server";
import { ensureFunctionOwner } from "../services/function-owner";
import {
  pushFunctionConfig,
  buildFunctionConfig,
  SOFT_CAP_BYTES,
  ConfigTooLargeError,
} from "../lib/function-config";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  // Build (without pushing) to show the live byte budget.
  let bytes = 0;
  let budgetError: string | null = null;
  try {
    bytes = (await buildFunctionConfig(shop.id)).bytes;
  } catch (error) {
    budgetError = error instanceof ConfigTooLargeError ? error.message : String(error);
  }

  return json({
    shopDomain: shop.shopDomain,
    testMode: shop.testMode,
    evaluationMode: shop.evaluationMode,
    ownerId: shop.functionOwnerId,
    syncedAt: shop.functionSyncedAt,
    stale: await isFunctionSyncStale(shop),
    ruleCount: await countFunctionRules(shop.id),
    bytes,
    budgetError,
    cap: SOFT_CAP_BYTES,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "seed") {
      // Sample zone + rules so the pathway can be exercised end-to-end
      // (replaced by the rule builder UI in spec 005).
      const zone = await prisma.zone.create({
        data: {
          shopId: shop.id,
          name: "California metro",
          countries: JSON.stringify(["US"]),
          provinces: JSON.stringify(["CA"]),
          postalRules: JSON.stringify([
            { id: "seed-1", mode: "PREFIX", value: "94" },
          ]),
        },
      });
      await prisma.shippingRule.createMany({
        data: [
          {
            shopId: shop.id,
            name: "Hide pickup for big carts",
            priority: 10,
            stopOnMatch: false,
            kind: "HIDE",
            zoneId: zone.id,
            conditions: JSON.stringify({
              combinator: "AND",
              conditions: [{ field: "subtotal", operator: "gte", value: 100 }],
            }),
            action: JSON.stringify({ target: { method: "PICK_UP" } }),
          },
          {
            shopId: shop.id,
            name: "Rename standard shipping",
            priority: 20,
            stopOnMatch: false,
            kind: "RENAME",
            zoneId: null,
            conditions: JSON.stringify({
              combinator: "AND",
              conditions: [],
            }),
            action: JSON.stringify({
              target: { titleContains: "Standard" },
              title: "Standard (3-5 days)",
            }),
          },
        ],
      });
    } else if (intent === "testMode") {
      const next = formData.get("value") === "1";
      await prisma.shop.update({ where: { id: shop.id }, data: { testMode: next } });
    }

    // Sync (also runs after the mutations above so the mirror follows every change).
    const owner = await ensureFunctionOwner(admin, shop.id);
    const result = await pushFunctionConfig(admin, shop.id);
    const excludedNote =
      result.excluded.length > 0
        ? ` Excluded ${result.excluded.length} rule(s): ${result.excluded.map((entry) => entry.reason).join("; ")}.`
        : "";
    return json({
      ok: true,
      message: `Synced ${result.bytes} bytes to the ${owner.created ? "newly created" : "existing"} delivery customization.${excludedNote}`,
    });
  } catch (error) {
    return json(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const busy = fetcher.state !== "idle";
  const message = fetcher.data?.message;
  const budgetPct = Math.min(100, Math.round((loaderData.bytes / loaderData.cap) * 100));

  const sync = useCallback(function sync() {
    fetcher.submit({ intent: "sync" }, { method: "POST" });
  }, [fetcher]);

  const seed = useCallback(function seed() {
    fetcher.submit({ intent: "seed" }, { method: "POST" });
  }, [fetcher]);

  const toggleTestMode = useCallback(function toggleTestMode() {
    fetcher.submit(
      { intent: "testMode", value: loaderData.testMode ? "0" : "1" },
      { method: "POST" },
    );
  }, [fetcher, loaderData.testMode]);

  return (
    <Page>
      <TitleBar title="ShipMath — delivery rules" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {message ? (
              <Banner tone={fetcher.data?.ok ? "success" : "critical"}>
                {message}
              </Banner>
            ) : null}
            {loaderData.stale && !busy ? (
              <Banner tone="warning">
                Configuration changed since the last sync — checkout is still
                using the previous rules until you sync.
              </Banner>
            ) : null}
            {loaderData.testMode ? (
              <Banner tone="info">
                Test mode is ON: the checkout Function applies no operations.
                Rules are previewed in the simulator.
              </Banner>
            ) : null}
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Checkout Function status
                </Text>
                <Badge tone={loaderData.ownerId ? "success" : "attention"}>
                  {loaderData.ownerId ? "Owner created" : "No owner yet"}
                </Badge>
              </InlineStack>
              <List>
                <List.Item>
                  Delivery customization owner:{" "}
                  {loaderData.ownerId ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {loaderData.ownerId}
                    </Text>
                  ) : (
                    "— (created on first sync)"
                  )}
                </List.Item>
                <List.Item>Function rules enabled: {loaderData.ruleCount}</List.Item>
                <List.Item>
                  Last synced:{" "}
                  {loaderData.syncedAt ? new Date(loaderData.syncedAt).toLocaleString() : "never"}
                </List.Item>
                <List.Item>
                  Evaluation mode:{" "}
                  {loaderData.evaluationMode === "ALL_MATCH" ? "all matches" : "first match"}
                </List.Item>
              </List>
              <Box paddingBlockStart="200">
                <Text as="p" variant="bodySm">
                  Config budget: {loaderData.bytes} / {loaderData.cap} bytes
                  (checkout Functions can&apos;t read past this)
                </Text>
                <Box paddingBlockStart="200">
                  <ProgressBar progress={budgetPct} tone={budgetPct > 90 ? "critical" : "highlight"} size="small" />
                </Box>
                {loaderData.budgetError ? (
                  <Box paddingBlockStart="200">
                    <Banner tone="critical">{loaderData.budgetError}</Banner>
                  </Box>
                ) : null}
              </Box>
              <InlineStack gap="300">
                <Button variant="primary" loading={busy} onClick={sync}>
                  Sync config to checkout
                </Button>
                <Button loading={busy} onClick={seed}>
                  Add sample rules
                </Button>
                <Button loading={busy} onClick={toggleTestMode}>
                  {loaderData.testMode ? "Go live" : "Turn on test mode"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How this works
              </Text>
              <Text as="p" variant="bodySm">
                Rules live in the database (source of truth). Syncing pushes a
                compact copy to a Shopify-managed metafield on your delivery
                customization; the checkout Function reads it live on every
                checkout — no redeploy needed.
              </Text>
              <Text as="p" variant="bodySm">
                If the metafield is missing or unreadable, checkout shows stock
                delivery options (fail-open).
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
