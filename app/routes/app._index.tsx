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
  Tooltip,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { ShippingRule } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma, {
  getOrCreateShop,
  countFunctionRules,
  isFunctionSyncStale,
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
  deleteRule,
  duplicateRule,
  listRules,
  listZones,
  setEvaluationMode,
  setRuleEnabled,
  swapPriority,
  updateRule,
} from "../lib/repositories/rules";
// CarrierRateActionSchema lives in the carrier module (shared with the function),
// not in config-schema.
import { CarrierRateActionSchema } from "../lib/carrier/action-schema";
import {
  ActionSchema,
  ConditionGroupSchema,
  RuleKindSchema,
  type RuleInput,
  type RuleKind,
} from "../lib/config-schema";
import ShipMathPage from "../components/global/ShipMathPage";
import SettingToggle from "../components/ui/SettingToggle";
import SyncStatusCard from "../components/rules/SyncStatusCard";
import RulesTable, { type RuleRow } from "../components/rules/RulesTable";
import SyncReportWarnings from "../components/rules/SyncReportWarnings";

/** Mirrors the repository page size used by listRules (spec 005 criterion 7). */
const RULES_PAGE_SIZE = 50;
/** Soft-cap warning threshold (005 criterion 7); the cap itself is 500. */
const RULES_CAP_WARN = 400;
const RULES_SOFT_CAP = 500;

function parseConditionGroup(raw: string): unknown {
  try {
    const result = ConditionGroupSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : { combinator: "AND", conditions: [] };
  } catch {
    return { combinator: "AND", conditions: [] };
  }
}

function parseActionJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toRuleRow(rule: ShippingRule): RuleRow {
  const kindResult = RuleKindSchema.safeParse(rule.kind);
  return {
    id: rule.id,
    uid: rule.uid ?? undefined,
    name: rule.name,
    kind: kindResult.success ? kindResult.data : "HIDE",
    enabled: rule.enabled,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    zoneId: rule.zoneId,
    conditions: parseConditionGroup(rule.conditions),
    action: parseActionJson(rule.action),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
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
    zones: zones.map(function toOption(zone) {
      return { id: zone.id, name: zone.name };
    }),
  });
}

type AdminApiClient = Parameters<typeof syncAfterOwnerEnsure>[0];

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

function zodIssuesText(error: z.ZodError): string {
  return error.issues
    .map(function describe(issue) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

function parseConditionsField(
  formData: FormData,
): { ok: true; value: RuleInput["conditions"] } | { ok: false; message: string } {
  try {
    const result = ConditionGroupSchema.safeParse(JSON.parse(String(formData.get("conditions") ?? "null")));
    if (!result.success) {
      return { ok: false, message: `Conditions failed validation — ${zodIssuesText(result.error)}` };
    }
    return { ok: true, value: result.data as RuleInput["conditions"] };
  } catch {
    return { ok: false, message: "Conditions are not valid JSON." };
  }
}

function parseActionField(
  kind: RuleKind,
  formData: FormData,
): { ok: true; value: RuleInput["action"] } | { ok: false, message: string } {
  try {
    const rawAction: unknown = JSON.parse(String(formData.get("action") ?? "null"));
    const result =
      kind === "CARRIER_RATE"
        ? CarrierRateActionSchema.safeParse(rawAction)
        : ActionSchema.safeParse(rawAction);
    if (!result.success) {
      return { ok: false, message: `Action failed validation — ${zodIssuesText(result.error)}` };
    }
    return { ok: true, value: result.data as RuleInput["action"] };
  } catch {
    return { ok: false, message: "Action is not valid JSON." };
  }
}

type RuleFormParse = { ok: true; input: RuleInput } | { ok: false; message: string };

function parseRuleForm(formData: FormData): RuleFormParse {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    return { ok: false, message: "Rule name is required." };
  }
  const kindResult = RuleKindSchema.safeParse(String(formData.get("kind") ?? ""));
  if (!kindResult.success) {
    return { ok: false, message: "Unknown rule kind." };
  }
  const priority = Number.parseInt(String(formData.get("priority") ?? ""), 10);
  if (!Number.isFinite(priority) || priority < 0) {
    return { ok: false, message: "Priority must be a whole number of 0 or more." };
  }
  const conditions = parseConditionsField(formData);
  if (!conditions.ok) {
    return conditions;
  }
  const action = parseActionField(kindResult.data, formData);
  if (!action.ok) {
    return action;
  }
  const input: RuleInput = {
    name,
    kind: kindResult.data,
    priority,
    stopOnMatch: formData.get("stopOnMatch") === "1",
    zoneId: String(formData.get("zoneId") ?? "").trim() || null,
    conditions: conditions.value,
    action: action.value,
  };
  return { ok: true, input };
}

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

async function handleTestModeIntent(admin: AdminApiClient, shop: ShopRef, formData: FormData) {
  const next = formData.get("value") === "1";
  await prisma.shop.update({ where: { id: shop.id }, data: { testMode: next } });
  const sync = await syncAfterOwnerEnsure(admin, shop.id);
  await writeAudit(
    shop.id,
    "MERCHANT",
    next ? "Test mode enabled" : "Test mode disabled",
    { testMode: !next },
    { testMode: next },
  );
  return json<ActionReply>({ ok: true, sync });
}

// The load-bearing order for every rule mutation (architecture §A1):
//   1. repository call (Prisma, source of truth)
//   2. ensureFunctionOwner
//   3. pushFunctionConfig — failures become a sync REPORT, never a throw
//   4. writeAudit (fail-open)

async function handleRuleCreate(admin: AdminApiClient, shopId: string, formData: FormData) {
  const parsed = parseRuleForm(formData);
  if (!parsed.ok) {
    return json<ActionReply>({ ok: false, message: parsed.message }, { status: 422 });
  }
  const rule = await createRule(shopId, parsed.input);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Created rule "${rule.name}"`, null, {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    priority: rule.priority,
  });
  return json<ActionReply>({ ok: true, sync });
}

async function handleRuleUpdate(admin: AdminApiClient, shopId: string, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.shippingRule.findFirst({ where: { id, shopId } });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  const parsed = parseRuleForm(formData);
  if (!parsed.ok) {
    return json<ActionReply>({ ok: false, message: parsed.message }, { status: 422 });
  }
  const rule = await updateRule(shopId, id, parsed.input);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Updated rule "${rule.name}"`,
    { id: existing.id, name: existing.name, enabled: existing.enabled, priority: existing.priority, zoneId: existing.zoneId },
    { id: rule.id, name: rule.name, enabled: rule.enabled, priority: rule.priority, zoneId: rule.zoneId },
  );
  return json<ActionReply>({ ok: true, sync });
}

async function handleRuleDelete(admin: AdminApiClient, shopId: string, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true, kind: true, priority: true },
  });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  await deleteRule(shopId, id);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Deleted rule "${existing.name}"`, existing, null);
  return json<ActionReply>({ ok: true, sync });
}

async function handleRuleDuplicate(admin: AdminApiClient, shopId: string, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  const copy = await duplicateRule(shopId, id);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Duplicated rule "${existing.name}" as "${copy.name}" (disabled, adjacent priority)`,
    { id: existing.id },
    { id: copy.id, name: copy.name, enabled: copy.enabled, priority: copy.priority },
  );
  return json<ActionReply>({ ok: true, sync });
}

async function handleRuleToggle(admin: AdminApiClient, shopId: string, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const next = formData.get("value") === "1";
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true, enabled: true },
  });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  await setRuleEnabled(shopId, id, next);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Rule "${existing.name}" ${next ? "enabled" : "disabled"}`,
    { enabled: existing.enabled },
    { enabled: next },
  );
  return json<ActionReply>({ ok: true, sync });
}

async function handleRulePriority(admin: AdminApiClient, shopId: string, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const dirRaw = String(formData.get("dir") ?? "");
  if (dirRaw !== "up" && dirRaw !== "down") {
    return json<ActionReply>({ ok: false, message: "Direction must be up or down." }, { status: 422 });
  }
  const dir: "up" | "down" = dirRaw;
  const existing = await prisma.shippingRule.findFirst({
    where: { id, shopId },
    select: { id: true, name: true },
  });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  await swapPriority(shopId, id, dir);
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(
    shopId,
    "MERCHANT",
    `Moved rule "${existing.name}" ${dir === "up" ? "up" : "down"}`,
    { id, dir },
    null,
  );
  return json<ActionReply>({ ok: true, sync });
}

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
    if (intent === "testMode") {
      return await handleTestModeIntent(admin, shop, formData);
    }
    if (intent === "rule-create") {
      return await handleRuleCreate(admin, shop.id, formData);
    }
    if (intent === "rule-update") {
      return await handleRuleUpdate(admin, shop.id, formData);
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

  const toggleTestMode = useCallback(function toggleTestModeNow() {
    tableFetcher.submit(
      { intent: "testMode", value: loaderData.testMode ? "0" : "1" },
      { method: "post" },
    );
  }, [tableFetcher, loaderData.testMode]);

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
      title="Shipping rules"
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
            onToggleTestMode={toggleTestMode}
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
              <SettingToggle
                label="Test mode"
                helpText="The checkout Function applies no operations; rules are previewed in the simulator."
                enabled={loaderData.testMode}
                disabled={busy}
                onChange={toggleTestMode}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                {loaderData.ruleCount} function rule(s) enabled · soft cap {RULES_SOFT_CAP} rules.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="500">
            {reply && reply.ok === false && reply.message ? (
              <Banner tone="critical">{reply.message}</Banner>
            ) : null}
            {reply && reply.ok === true && reply.message ? (
              <Banner tone="success">{reply.message}</Banner>
            ) : null}
            {syncFailure ? (
              <Banner
                tone="critical"
                title="Checkout mirror out of date"
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
            {loaderData.total >= RULES_CAP_WARN ? (
              <Banner tone="warning" title="Approaching the rule soft cap">
                {loaderData.total} of {RULES_SOFT_CAP} rules. Sync size and evaluation time grow
                with rule count — archive or merge rules you no longer need.
              </Banner>
            ) : null}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300">
                    <Tooltip content="Rate simulator arrives with the simulator spec — not wired up yet.">
                      <span>
                        <Button disabled>Simulate rates</Button>
                      </span>
                    </Tooltip>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {loaderData.total} rule(s) · page {loaderData.page} of {loaderData.totalPages}
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
                How this works
              </Text>
              <Text as="p" variant="bodySm">
                Rules live in the database (source of truth). Every change re-pushes a
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

      {deleteTarget ? (
        <Modal
          open
          onClose={function closeDelete() {
            setDeleteTarget(null);
          }}
          title="Delete rule?"
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
