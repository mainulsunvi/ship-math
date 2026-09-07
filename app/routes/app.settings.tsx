/**
 * Settings (spec 007, plan Task 6) — general info + the Go-live card, the
 * SINGLE source of truth for test mode and carrier service registration.
 *
 * Intents (action):
 *   - toggle-test-mode : reversible flip. Turning it ON pauses carrier rates
 *     (callback answers empty while the registration stays intact).
 *   - enter-test-mode  : full teardown — test mode ON *and* the carrier
 *     service deleted at Shopify (plan: "Enter-test-mode button (removes
 *     carrier service)").
 *   - go-live          : gated on testMode OFF + CCS eligibility. Runs the
 *     probe first (§A3: never register without a successful eligibility
 *     signal), then ensureCarrierService (create + persist GID, LIST
 *     self-heal). FUNCTIONS_ONLY shops see the probe fail with CCS_OFF.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { BlockStack, Card, Layout, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import ShipMathPage from "../components/global/ShipMathPage";
import GoLiveCard from "../components/settings/GoLiveCard";
import prisma, { getOrCreateShop } from "../db.server";
import { writeAudit } from "../lib/audit";
import { syncAfterOwnerEnsure } from "../lib/sync";
import {
  carrierCallbackUrl,
  ensureCarrierService,
  findCarrierService,
  probeCcs,
  removeCarrierService,
} from "../services/carrier-registration";
import { authenticate } from "../shopify.server";

interface ActionReply {
  ok?: boolean;
  message?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  let liveOnShopify = false;
  let carrierName: string | null = null;
  let active: boolean | null = null;
  let scopeError = false;
  if (shop.carrierServiceId) {
    try {
      const service = await findCarrierService(admin, shop.carrierServiceId);
      liveOnShopify = service !== null;
      carrierName = service?.name ?? null;
      active = service?.active ?? null;
    } catch {
      // Transport or scope failure — surface as a re-auth hint, never a crash.
      scopeError = true;
    }
  }

  return json({
    shopDomain: shop.shopDomain,
    testMode: shop.testMode,
    carrierServiceId: shop.carrierServiceId,
    liveOnShopify,
    carrierName,
    active,
    callbackUrl: carrierCallbackUrl(),
    scopeError,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "toggle-test-mode") {
      const next = String(formData.get("value") || "") === "1";
      await prisma.shop.update({ where: { id: shop.id }, data: { testMode: next } });
      // The checkout Function embeds testMode in its config — flip requires a
      // sync for the Function lane (the carrier lane reads the DB directly).
      const sync = await syncAfterOwnerEnsure(admin, shop.id);
      await writeAudit(
        shop.id,
        "MERCHANT",
        next ? "Test mode on (registration kept)" : "Test mode off",
        { testMode: !next },
        { testMode: next },
      );
      if (sync.ok === false) {
        return json<ActionReply>({
          ok: false,
          message: `Test mode saved, but syncing the checkout Function failed: ${sync.error}`,
        });
      }
      return json<ActionReply>({
        ok: true,
        message: next
          ? "Test mode is on. Checkout stops receiving ShipMath rates until you turn it off."
          : "Test mode is off. Press \u201CGo live\u201D to serve carrier rates at checkout.",
      });
    }

    if (intent === "enter-test-mode") {
      await prisma.shop.update({
        where: { id: shop.id },
        data: { testMode: true },
      });
      const sync = await syncAfterOwnerEnsure(admin, shop.id);
      await removeCarrierService(admin, shop.id);
      await writeAudit(
        shop.id,
        "MERCHANT",
        "Entered test mode, carrier service removed",
        { testMode: false, carrierServiceId: shop.carrierServiceId },
        { testMode: true, carrierServiceId: null },
      );
      if (sync.ok === false) {
        return json<ActionReply>({
          ok: false,
          message: `Test mode on and carrier service removed, but syncing the checkout Function failed: ${sync.error}`,
        });
      }
      return json<ActionReply>({
        ok: true,
        message: "Test mode is on. The carrier service was removed from Shopify.",
      });
    }

    if (intent === "go-live") {
      if (shop.testMode) {
        return json<ActionReply>(
          { ok: false, message: "Turn test mode off before going live." },
          { status: 422 },
        );
      }
      const probe = await probeCcs(admin, shop.id);
      if (probe === "CCS_OFF") {
        return json<ActionReply>(
          {
            ok: false,
            message:
              "Carrier calculated shipping is not available on this store's plan, so ShipMath cannot serve checkout rates.",
          },
          { status: 422 },
        );
      }
      if (probe === "ERROR") {
        return json<ActionReply>(
          { ok: false, message: "Could not verify carrier shipping eligibility. Please try again." },
          { status: 502 },
        );
      }
      const result = await ensureCarrierService(admin, shop.id);
      await writeAudit(
        shop.id,
        "MERCHANT",
        result.created
          ? "Went live, carrier service created"
          : "Went live, carrier service restored",
        { carrierServiceId: shop.carrierServiceId },
        { carrierServiceId: result.id },
      );
      return json<ActionReply>({
        ok: true,
        message: result.created
          ? "You're live. Checkout now calls ShipMath for rates."
          : "Carrier service restored. You're live again.",
      });
    }

    return json<ActionReply>({ ok: false, message: `Unknown intent: ${intent}` }, { status: 400 });
  } catch (error) {
    return json<ActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export default function SettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const reply = fetcher.data as ActionReply | undefined;

  function submit(intent: string, extra: Record<string, string> = {}) {
    fetcher.submit({ intent, ...extra }, { method: "post" });
  }

  return (
    <ShipMathPage title="Settings" backAction={{ content: "Dashboard", url: "/app" }}>
      <TitleBar title="Settings" />
      <Layout>
        {reply?.message ? (
          <Layout.Section>
            <Card>
              <Text as="p" variant="bodySm" tone={reply.ok ? "success" : "critical"}>
                {reply.message}
              </Text>
            </Card>
          </Layout.Section>
        ) : null}
        <Layout.Section>
          <GoLiveCard
            testMode={loaderData.testMode}
            registeredId={loaderData.carrierServiceId}
            liveOnShopify={loaderData.liveOnShopify}
            active={loaderData.active}
            carrierName={loaderData.carrierName}
            callbackUrl={loaderData.callbackUrl}
            scopeError={loaderData.scopeError}
            busy={busy}
            onGoLive={function goLive() {
              submit("go-live");
            }}
            onEnterTestMode={function enterTestMode() {
              submit("enter-test-mode");
            }}
            onToggleTestMode={function toggleTestMode(next: boolean) {
              submit("toggle-test-mode", { value: next ? "1" : "0" });
            }}
          />
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Store
              </Text>
              <Text as="p" variant="bodyMd">
                Connected store: {loaderData.shopDomain}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                General settings arrive with a future release.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </ShipMathPage>
  );
}
