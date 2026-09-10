import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Banner,
  InlineStack,
  Modal,
  Pagination,
  Select,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { Shop } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma, {
  getOrCreateShop,
  countFunctionRules,
  isFunctionSyncStale,
  appendWizardDraftId,
  readPrefs,
  readWizardDraftIds,
  updatePrefs,
} from "../db.server";
import { SOFT_CAP_BYTES } from "../lib/budget";
import {
  buildFunctionConfig,
  ConfigTooLargeError,
} from "../lib/function-config";
import { syncAfterOwnerEnsure, type MirrorSyncReport } from "../lib/sync";
import { writeAudit } from "../lib/audit";
import {
  createRule,
  listRules,
  listZones,
  setEvaluationMode,
} from "../lib/repositories/rules";
import {
  AdminApiClient,
  handleRuleDelete,
  handleRuleDuplicate,
  handleRulePriority,
  handleRuleToggle,
  RULES_PAGE_SIZE,
  toRuleRow,
} from "../lib/rule-table-actions";
import { planClassFromShop } from "../lib/plan";
import { parseZoneForm } from "../lib/zone-form";
import { parseRuleForm } from "../lib/rule-form";
import { ensureShopPlanDetails } from "../services/shop-details";
import { ensureCarrierService, probeCcs } from "../services/carrier-registration";
import ShipMathPage from "../components/global/ShipMathPage";
import SyncStatusCard from "../components/rules/SyncStatusCard";
import RulesTable, { type RuleRow } from "../components/rules/RulesTable";
import SyncReportWarnings from "../components/rules/SyncReportWarnings";
import SetupWizard from "../components/setup/SetupWizard";

/** Soft-cap warning threshold (005 criterion 7); the cap itself is 500. */
const RULES_CAP_WARN = 400;
const RULES_SOFT_CAP = 500;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  let shop = await getOrCreateShop(session.shop);

  // First-load plan backfill (spec 003 §3): the shop/update webhook only
  // fires on changes, so a fresh install backfills plan/name once here before
  // the wizard classifies the plan. ensureShopPlanDetails never throws;
  // re-read so classification uses the stored row either way.
  if (shop.plan === null || shop.name === null) {
    await ensureShopPlanDetails(admin, session.shop);
    shop = await getOrCreateShop(session.shop);
  }
  const planClass = planClassFromShop(shop);

  // Build (without pushing) to show the live byte budget.
  let bytes = 0;
  let budgetError: string | null = null;
  try {
    bytes = (await buildFunctionConfig(shop.id)).bytes;
  } catch (error) {
    budgetError = error instanceof ConfigTooLargeError ? error.message : String(error);
  }

  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const requestedPage = Number.isFinite(requested) && requested >= 1 ? requested : 1;
  const firstPage = await listRules(shop.id, requestedPage);
  const totalPages = Math.max(1, Math.ceil(firstPage.total / RULES_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const { rules, total } =
    page === requestedPage ? firstPage : await listRules(shop.id, page);

  const zones = await listZones(shop.id);

  return json({
    shopDomain: shop.shopDomain,
    shopName: shop.name,
    testMode: shop.testMode,
    evaluationMode: shop.evaluationMode,
    ownerId: shop.functionOwnerId,
    syncedAt: shop.functionSyncedAt ? shop.functionSyncedAt.toISOString() : null,
    stale: await isFunctionSyncStale(shop),
    ruleCount: await countFunctionRules(shop.id),
    bytes,
    budgetError,
    cap: SOFT_CAP_BYTES,
    rules: rules.map(toRuleRow),
    total,
    page,
    totalPages,
    planClass,
    onboardedAt: shop.onboardedAt ? shop.onboardedAt.toISOString() : null,
    // enabled rides along for the setup wizard's draft labeling (wizard
    // zones are created disabled); RulesTable only reads id/name.
    zones: zones.map(function toOption(zone) {
      return { id: zone.id, name: zone.name, enabled: zone.enabled };
    }),
  });
}

interface ShopRef {
  id: string;
  testMode: boolean;
  evaluationMode: string;
}

interface ActionReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
  fieldErrors?: Record<string, string>;
  /** Present on wizard-zone-create success (plan 003 Task 4). */
  zone?: { id: string; name: string };
  /** Present on wizard-rule-create success (plan 003 Task 4). */
  rule?: { id: string; name: string };
}

const EVALUATION_MODES = ["FIRST_MATCH", "ALL_MATCH"] as const;

type EvaluationMode = (typeof EVALUATION_MODES)[number];

/** Narrow the DB string to the union the RulesTable Behavior column expects. */
function toEvaluationMode(value: string): EvaluationMode | undefined {
  if (value === "FIRST_MATCH" || value === "ALL_MATCH") {
    return value;
  }
  return undefined;
}

// Rule-form parsing lives in ../lib/rule-form (shared with the rule routes
// and the wizard draft intent; extracted per the 005 review). The rule-table
// mutations (delete/duplicate/toggle/priority) and toRuleRow live in
// ../lib/rule-table-actions, shared with /app/rules (2026-09-11) so the
// dashboard and the Rules page can never drift.

async function handleSyncIntent(admin: AdminApiClient, shopId: string) {
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  if (!sync.ok) {
    return json<ActionReply>({ ok: false, message: sync.error ?? "Mirror sync failed.", sync });
  }
  return json<ActionReply>({
    ok: true,
    message: `Synced ${sync.bytes ?? 0} bytes to the delivery customization.`,
    sync,
  });
}

async function handleSeedIntent(admin: AdminApiClient, shop: ShopRef) {
  // Sample zone + rules so the pathway can be exercised end-to-end.
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
  const sync = await syncAfterOwnerEnsure(admin, shop.id);
  await writeAudit(shop.id, "MERCHANT", "Seeded sample zone and rules", null, { zoneId: zone.id });
  if (!sync.ok) {
    return json<ActionReply>({ ok: false, message: "Sample rules created, but the mirror sync failed.", sync });
  }
  return json<ActionReply>({
    ok: true,
    message: `Sample rules added; synced ${sync.bytes ?? 0} bytes to the delivery customization.`,
    sync,
  });
}

// The load-bearing order for every rule mutation (architecture §A1) is
// documented in ../lib/rule-table-actions, where the four table handlers
// (delete/duplicate/toggle/priority) now live, shared with /app/rules
// (2026-09-11). rule-create/rule-update live on their own routes (005
// rules-on-routes); the wizard's draft create lives below.

async function handleSetEvaluationMode(admin: AdminApiClient, shop: ShopRef, formData: FormData) {
  const modeRaw = String(formData.get("mode") ?? "");
  if (!(EVALUATION_MODES as readonly string[]).includes(modeRaw)) {
    return json<ActionReply>({ ok: false, message: "Unknown evaluation mode." }, { status: 422 });
  }
  const mode = modeRaw as (typeof EVALUATION_MODES)[number];
  await setEvaluationMode(shop.id, mode);
  const sync = await syncAfterOwnerEnsure(admin, shop.id);
  await writeAudit(
    shop.id,
    "MERCHANT",
    `Evaluation mode set to ${mode}`,
    { evaluationMode: shop.evaluationMode },
    { evaluationMode: mode },
  );
  return json<ActionReply>({ ok: true, sync });
}

/** "1 rule" / "2 rules" — merchant-facing counts never use parentheses (UX rules). */
function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Wizard drafts (plan 003 Task 4): zone/rule steps create rows with
 * `enabled: false` and NO mirror sync — completion pushes the config once.
 * The parsed `enabled` form flag is deliberately ignored: enabled is FORCED
 * false until the `wizard-complete` intent flips the drafts. Every created
 * id is recorded in prefs (appendWizardDraftId) so completion flips EXACTLY
 * the wizard's drafts (003 review REQUIRED finding), never rows the merchant
 * deliberately switched off elsewhere. Read-modify-write is safe here: the
 * wizard submits one draft at a time.
 */
async function handleWizardZoneCreate(shopId: string, formData: FormData) {
  const parsed = parseZoneForm(formData);
  if (!parsed.ok) {
    return json<ActionReply>({ ok: false, fieldErrors: parsed.fieldErrors }, { status: 422 });
  }
  const value = parsed.value;
  const zone = await prisma.zone.create({
    data: {
      shopId,
      name: value.name,
      enabled: false,
      countries: JSON.stringify(value.countries),
      provinces: JSON.stringify(value.provinces),
      postalRules: JSON.stringify(value.postalRules),
    },
  });
  await appendWizardDraftId(shopId, "wizardDraftZoneIds", zone.id);
  await writeAudit(shopId, "MERCHANT", `Wizard created zone "${zone.name}" (draft, disabled)`, null, {
    id: zone.id,
    name: zone.name,
    enabled: false,
  });
  return json<ActionReply>({ ok: true, zone: { id: zone.id, name: zone.name } });
}

/**
 * Wizard rule draft: reuses the dashboard's parseRuleForm verbatim, then
 * inserts through the repository with enabled: false (createRule accepts the
 * optional StoredRuleSchema flag; updateRule still never touches enabled).
 */
async function handleWizardRuleCreate(shopId: string, formData: FormData) {
  const parsed = parseRuleForm(formData);
  if (!parsed.ok) {
    return json<ActionReply>({ ok: false, message: parsed.message }, { status: 422 });
  }
  const rule = await createRule(shopId, { ...parsed.input, enabled: false });
  await appendWizardDraftId(shopId, "wizardDraftRuleIds", rule.id);
  await writeAudit(shopId, "MERCHANT", `Wizard created rule "${rule.name}" (draft, disabled)`, null, {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    enabled: false,
  });
  return json<ActionReply>({ ok: true, rule: { id: rule.id, name: rule.name } });
}

/**
 * Final wizard commit (plan 003 Task 4): flip EXACTLY the wizard's recorded
 * drafts on (prefs wizardDraftRuleIds/wizardDraftZoneIds — 003 review
 * REQUIRED finding: a blanket "every disabled row" flip would re-enable
 * rules the merchant deliberately switched off before a Restart-setup
 * rerun), stamp onboardedAt, push the mirror once, then optionally register
 * the carrier service. Order matters: the DB commit and the onboarding stamp
 * land BEFORE the sync and carrier steps, so a push or registration failure
 * never reopens the wizard — the dashboard's stale banner + retry covers a
 * failed sync, and a carrier note covers a failed registration. Draft lists
 * are cleared in the same pass. FUNCTIONS_ONLY shops are never probed or
 * registered (spec 003 criterion 2: a probe would create a junk carrier
 * service).
 */
async function handleWizardComplete(admin: AdminApiClient, shop: Shop, formData: FormData) {
  const wantsCarrier = String(formData.get("carrier") || "") === "1";
  const planClass = planClassFromShop(shop);
  const drafts = readWizardDraftIds(readPrefs(shop));

  // Empty id lists flip nothing (updateMany with id in [] matches no rows).
  const rules = await prisma.shippingRule.updateMany({
    where: { shopId: shop.id, id: { in: drafts.ruleIds }, enabled: false },
    data: { enabled: true },
  });
  const zones = await prisma.zone.updateMany({
    where: { shopId: shop.id, id: { in: drafts.zoneIds }, enabled: false },
    data: { enabled: true },
  });
  // null CLEARS the keys (updatePrefs semantics) — a later Restart setup
  // starts from a clean slate and cannot resurrect stale draft ids.
  await updatePrefs(shop.id, { wizardDraftRuleIds: null, wizardDraftZoneIds: null });

  await prisma.shop.update({
    where: { id: shop.id },
    data: { onboardedAt: new Date() },
  });

  const enabledLabel = `${countLabel(rules.count, "rule")} and ${countLabel(zones.count, "zone")} enabled`;
  const sync = await syncAfterOwnerEnsure(admin, shop.id);
  if (!sync.ok) {
    // Keep onboardedAt set — the wizard stays closed and the dashboard's
    // stale banner offers the retry.
    await writeAudit(shop.id, "MERCHANT", `Setup wizard completed (${enabledLabel}, sync failed)`, null, null);
    return json<ActionReply>({
      ok: false,
      message: `Setup saved ${enabledLabel}, but syncing the checkout Function failed: ${sync.error ?? "unknown error"}. Retry sync from the dashboard.`,
      sync,
    });
  }

  let carrierNote = " Your delivery rules are synced to checkout.";
  if (wantsCarrier && planClass === "FUNCTIONS_ONLY") {
    carrierNote = " Carrier rates need a Shopify plan with carrier calculated shipping, so delivery rules will handle checkout.";
  } else if (wantsCarrier) {
    const probe = await probeCcs(admin, shop.id);
    if (probe === "ELIGIBLE") {
      try {
        await ensureCarrierService(admin, shop.id);
        carrierNote = " Carrier rates are set up and synced to checkout.";
      } catch (error) {
        carrierNote = ` Carrier rates could not be turned on: ${error instanceof Error ? error.message : String(error)}. Delivery rules still work.`;
      }
    } else if (probe === "CCS_OFF") {
      carrierNote = " Carrier calculated shipping is not available on this store's plan, so delivery rules will handle checkout.";
    } else {
      carrierNote = " Carrier rates could not be verified, so delivery rules will handle checkout.";
    }
  }

  await writeAudit(
    shop.id,
    "MERCHANT",
    `Setup wizard completed (${enabledLabel}, carrier: ${wantsCarrier ? planClass : "not requested"})`,
    { onboardedAt: shop.onboardedAt },
    { onboardedAt: "set", rulesEnabled: rules.count, zonesEnabled: zones.count },
  );
  return json<ActionReply>({
    ok: true,
    message: `Setup complete. ${countLabel(rules.count, "rule")} and ${countLabel(zones.count, "zone")} enabled.${carrierNote}`,
    sync,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "sync") {
      return await handleSyncIntent(admin, shop.id);
    }
    if (intent === "seed") {
      return await handleSeedIntent(admin, shop);
    }
    if (intent === "rule-delete") {
      return await handleRuleDelete(admin, shop.id, formData);
    }
    if (intent === "rule-duplicate") {
      return await handleRuleDuplicate(admin, shop.id, formData);
    }
    if (intent === "rule-toggle") {
      return await handleRuleToggle(admin, shop.id, formData);
    }
    if (intent === "rule-priority") {
      return await handleRulePriority(admin, shop.id, formData);
    }
    if (intent === "set-evaluation-mode") {
      return await handleSetEvaluationMode(admin, shop, formData);
    }
    if (intent === "wizard-zone-create") {
      return await handleWizardZoneCreate(shop.id, formData);
    }
    if (intent === "wizard-rule-create") {
      return await handleWizardRuleCreate(shop.id, formData);
    }
    if (intent === "wizard-complete") {
      return await handleWizardComplete(admin, shop, formData);
    }
    return json<ActionReply>({ ok: false, message: `Unknown intent: ${intent}` }, { status: 400 });
  } catch (error) {
    return json<ActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

interface FetcherReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
}

const EVALUATION_MODE_OPTIONS = [
  { label: "First match wins (priority order)", value: "FIRST_MATCH" },
  { label: "All matches apply (priority order)", value: "ALL_MATCH" },
];

function firstSyncFailure(a: FetcherReply | undefined, b: FetcherReply | undefined): MirrorSyncReport | null {
  if (a?.sync && a.sync.ok === false) {
    return a.sync;
  }
  if (b?.sync && b.sync.ok === false) {
    return b.sync;
  }
  return null;
}

/** Mirror of firstSyncFailure for the success-path truncation/exclusion warnings. */
function firstSyncSuccess(a: FetcherReply | undefined, b: FetcherReply | undefined): MirrorSyncReport | null {
  if (a?.sync && a.sync.ok === true) {
    return a.sync;
  }
  if (b?.sync && b.sync.ok === true) {
    return b.sync;
  }
  return null;
}

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const tableFetcher = useFetcher<typeof action>();
  const modeFetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null);

  // Local latch, not a loader read: after wizard-complete the revalidation
  // sets onboardedAt, which would unmount the wizard (and its success
  // banner) mid-commit. Latching keeps it mounted for this page view only;
  // a fresh load re-evaluates from the loader (wizard stays closed once
  // onboarded, reappears after abandonment or Restart setup).
  const [wizardActive] = useState(function initWizardActive() {
    return loaderData.onboardedAt === null;
  });
  const wizardDraftRules = loaderData.rules
    .filter(function isDraftRule(rule) {
      return rule.enabled === false;
    })
    .map(function toDraft(rule) {
      return { id: rule.id, name: rule.name };
    });

  const busy = tableFetcher.state !== "idle" || modeFetcher.state !== "idle";
  const reply = tableFetcher.data as FetcherReply | undefined;
  const modeReply = modeFetcher.data as FetcherReply | undefined;
  const syncFailure = firstSyncFailure(reply, modeReply);
  const syncSuccess = firstSyncSuccess(reply, modeReply);

  const sync = useCallback(function syncNow() {
    tableFetcher.submit({ intent: "sync" }, { method: "post" });
  }, [tableFetcher]);

  const seed = useCallback(function seedNow() {
    tableFetcher.submit({ intent: "seed" }, { method: "post" });
  }, [tableFetcher]);

  function openNewRule() {
    navigate("/app/rules/new");
  }

  function openEditRule(rule: RuleRow) {
    navigate(`/app/rules/${rule.uid}/edit`);
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    tableFetcher.submit({ intent: "rule-delete", id: deleteTarget.id }, { method: "post" });
    setDeleteTarget(null);
  }

  function handleEvaluationModeChange(value: string) {
    modeFetcher.submit({ intent: "set-evaluation-mode", mode: value }, { method: "post" });
  }

  function changePage(next: number) {
    navigate(`/app?page=${next}`);
  }

  return (
    <ShipMathPage
      title="Shipping Rules"
      subtitle="Control how delivery options are shown and priced at checkout"
      primaryAction={{ content: "New rule", onAction: openNewRule, loading: busy }}
      secondaryActions={[
        {
          content: "Sync now",
          onAction: sync,
          loading: busy,
          disabled: busy,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <SyncStatusCard
            ownerId={loaderData.ownerId}
            syncedAt={loaderData.syncedAt}
            ruleCount={loaderData.ruleCount}
            evaluationMode={loaderData.evaluationMode}
            testMode={loaderData.testMode}
            bytes={loaderData.bytes}
            budgetError={loaderData.budgetError}
            cap={loaderData.cap}
            busy={busy}
            onSync={sync}
            onSeed={seed}
          />
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Environment
              </Text>
              <Select
                label="Evaluation mode"
                options={EVALUATION_MODE_OPTIONS}
                value={loaderData.evaluationMode}
                onChange={handleEvaluationModeChange}
                disabled={busy}
                helpText={
                  loaderData.evaluationMode === "ALL_MATCH"
                    ? "Every matching rule applies in priority order; stop-on-match rules short-circuit the rest."
                    : "Only the first matching rule (lowest priority number) applies."
                }
              />
              <Text as="p" variant="bodySm">
                Test mode: {loaderData.testMode ? "On" : "Off"} ·{" "}
                <Link url="/app/settings">manage in Settings</Link>
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {loaderData.ruleCount === 1
                  ? "1 function rule enabled"
                  : `${loaderData.ruleCount} function rules enabled`}{" "}
                · soft cap {RULES_SOFT_CAP} rules.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="500">
            {wizardActive ? (
              <SetupWizard
                shopName={loaderData.shopName}
                planClass={loaderData.planClass}
                testMode={loaderData.testMode}
                zones={loaderData.zones}
                draftRules={wizardDraftRules}
              />
            ) : null}
            {reply && reply.ok === false && reply.message ? (
              <Banner tone="critical">{reply.message}</Banner>
            ) : null}
            {reply && reply.ok === true && reply.message ? (
              <Banner tone="success">{reply.message}</Banner>
            ) : null}
            {syncFailure ? (
              <Banner
                tone="critical"
                title="Checkout Mirror Out of Date"
                action={{ content: "Retry sync", onAction: sync }}
              >
                <Text as="p" variant="bodySm">
                  The change was saved to the database, but pushing it to the checkout Function
                  failed: {syncFailure.error}
                </Text>
              </Banner>
            ) : null}
            <SyncReportWarnings sync={syncSuccess} />
            {loaderData.stale && !busy ? (
              <Banner tone="warning">
                Configuration changed since the last sync. Checkout is still
                using the previous rules until you sync.
              </Banner>
            ) : null}
            {loaderData.testMode ? (
              <Banner tone="info">
                Test mode is on: the checkout Function applies no operations.
                Rules are previewed in the simulator.
              </Banner>
            ) : null}
            {loaderData.total >= RULES_CAP_WARN ? (
              <Banner tone="warning" title="Approaching the Rule Soft Cap">
                {loaderData.total} of {RULES_SOFT_CAP} rules. Sync size and evaluation time grow
                with rule count. Archive or merge rules you no longer need.
              </Banner>
            ) : null}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300">
                    <Button
                      onClick={function openSimulator() {
                        navigate("/app/simulator");
                      }}
                    >
                      Simulate rates
                    </Button>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {loaderData.total === 1
                      ? "1 rule"
                      : `${loaderData.total} rules`}{" "}
                    · page {loaderData.page} of {loaderData.totalPages}
                  </Text>
                </InlineStack>
                {loaderData.rules.length === 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      No rules yet.
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Create your first rule with “New rule”, or add the sample rules from the
                      status card.
                    </Text>
                  </BlockStack>
                ) : (
                  <RulesTable
                    rules={loaderData.rules}
                    zones={loaderData.zones}
                    busy={busy}
                    evaluationMode={toEvaluationMode(loaderData.evaluationMode)}
                    onEdit={openEditRule}
                    onDelete={function askDelete(rule: RuleRow) {
                      setDeleteTarget(rule);
                    }}
                    onToggle={function toggleRule(rule: RuleRow, next: boolean) {
                      tableFetcher.submit(
                        { intent: "rule-toggle", id: rule.id, value: next ? "1" : "0" },
                        { method: "post" },
                      );
                    }}
                    onMove={function moveRule(rule: RuleRow, direction: "up" | "down") {
                      tableFetcher.submit(
                        { intent: "rule-priority", id: rule.id, dir: direction },
                        { method: "post" },
                      );
                    }}
                    onDuplicate={function duplicateRuleRow(rule: RuleRow) {
                      tableFetcher.submit({ intent: "rule-duplicate", id: rule.id }, { method: "post" });
                    }}
                  />
                )}
                {loaderData.totalPages > 1 ? (
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={loaderData.page > 1}
                      hasNext={loaderData.page < loaderData.totalPages}
                      onPrevious={function goPrevious() {
                        changePage(loaderData.page - 1);
                      }}
                      onNext={function goNext() {
                        changePage(loaderData.page + 1);
                      }}
                    />
                  </InlineStack>
                ) : null}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How This Works
              </Text>
              <Text as="p" variant="bodySm">
                Rules live in the database (source of truth). Every change re-pushes a
                compact copy to a Shopify-managed metafield on your delivery
                customization; the checkout Function reads it live on every
                checkout. No redeploy is needed.
              </Text>
              <Text as="p" variant="bodySm">
                If the metafield is missing or unreadable, checkout shows stock
                delivery options (fail-open).
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {deleteTarget ? (
        <Modal
          open
          onClose={function closeDelete() {
            setDeleteTarget(null);
          }}
          title="Delete Rule?"
          primaryAction={{ content: "Delete rule", destructive: true, onAction: confirmDelete, loading: busy }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: function cancelDelete() {
                setDeleteTarget(null);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Delete “{deleteTarget.name}”? The rule is removed everywhere and the
                checkout mirror updates on the next sync.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      ) : null}
    </ShipMathPage>
  );
}
