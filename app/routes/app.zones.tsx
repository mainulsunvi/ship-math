import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  DataTable,
  InlineStack,
  Layout,
  Modal,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma, { getOrCreateShop } from "../db.server";
import { listZones } from "../lib/repositories/rules";
import { PostalRuleSchema, type PostalRule } from "../lib/config-schema";
import { formatForDisplay, parseCodeArray, validatePostalRuleForCountries } from "../lib/postal";
import { syncAfterOwnerEnsure, type MirrorSyncReport } from "../lib/sync";
import { writeAudit } from "../lib/audit";
import ZoneEditorModal, { type ZoneEditorZone } from "../components/zones/ZoneEditorModal";
import SyncReportWarnings from "../components/rules/SyncReportWarnings";
import ShipMathPage from "../components/global/ShipMathPage";
import Switch from "../components/ui/Switch";

/**
 * Zones page (spec 004/005 Task 2). Loader lists zones newest-first via the
 * repository. Every mutation (zone-create | zone-update | zone-delete |
 * zone-toggle, plus a bare `sync` retry) follows the load-bearing order:
 * Prisma write → ensureFunctionOwner → pushFunctionConfig → writeAudit
 * (fail-open). Push failures return `{ ok, sync: { ok: false } }` — never a
 * throw — so the page can surface the stale-mirror banner with a retry.
 */

interface ZoneSummary extends ZoneEditorZone {
  usageCount: number;
}

function parsePostalRules(raw: string): PostalRule[] {
  try {
    const result = z.array(PostalRuleSchema).safeParse(JSON.parse(raw));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const zones = await listZones(shop.id);
  const zoneRules = await prisma.shippingRule.findMany({
    where: { shopId: shop.id, zoneId: { not: null } },
    select: { zoneId: true },
  });
  const usage = new Map<string, number>();
  for (const row of zoneRules) {
    if (row.zoneId !== null) {
      usage.set(row.zoneId, (usage.get(row.zoneId) ?? 0) + 1);
    }
  }

  return json({
    zones: zones.map(function toSummary(zone): ZoneSummary {
      return {
        id: zone.id,
        name: zone.name,
        enabled: zone.enabled,
        countries: parseCodeArray(zone.countries),
        provinces: parseCodeArray(zone.provinces),
        postalRules: parsePostalRules(zone.postalRules),
        usageCount: usage.get(zone.id) ?? 0,
      };
    }),
  });
}

interface ActionReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
  fieldErrors?: Record<string, string>;
}

interface ZoneFormValue {
  name: string;
  enabled: boolean;
  countries: string[];
  provinces: string[];
  postalRules: PostalRule[];
}

function parseZoneForm(formData: FormData): { ok: true; value: ZoneFormValue } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    fieldErrors.name = "Zone name is required.";
  }
  const enabled = formData.get("enabled") === "1";

  const countries = parseCodeArray(String(formData.get("countries") ?? "[]"));
  if (countries.length === 0) {
    fieldErrors.countries = "Select at least one destination country (or worldwide).";
  }
  // Provinces are only meaningful for a single-country zone (spec 004): a
  // multi-country or worldwide zone normalizes to ["*"] on write.
  const provinces =
    countries.length === 1 && countries[0] !== "*" ? parseCodeArray(String(formData.get("provinces") ?? "[]")) : ["*"];

  let postalRules: PostalRule[] = [];
  const postalRaw = String(formData.get("postalRules") ?? "[]");
  try {
    const result = z.array(PostalRuleSchema).safeParse(JSON.parse(postalRaw));
    if (!result.success) {
      fieldErrors.postal = "Postal rules are malformed.";
    } else {
      postalRules = result.data;
    }
  } catch {
    fieldErrors.postal = "Postal rules are malformed.";
  }

  if (fieldErrors.postal === undefined) {
    for (const rule of postalRules) {
      const message = validatePostalRuleForCountries(rule, countries);
      if (message !== null) {
        fieldErrors.postal = `Postal rule “${formatForDisplay(rule.mode, rule)}”: ${message}`;
        break;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, value: { name, enabled, countries, provinces, postalRules } };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
    if (intent === "zone-create") {
      return await handleZoneCreate(admin, shop.id, formData);
    }
    if (intent === "zone-update") {
      return await handleZoneUpdate(admin, shop.id, formData);
    }
    if (intent === "zone-delete") {
      return await handleZoneDelete(admin, shop.id, formData);
    }
    if (intent === "zone-toggle") {
      return await handleZoneToggle(admin, shop.id, formData);
    }
    if (intent === "sync") {
      const sync = await syncAfterOwnerEnsure(admin, shop.id);
      if (!sync.ok) {
        return json<ActionReply>({ ok: false, message: sync.error ?? "Mirror sync failed.", sync });
      }
      return json<ActionReply>({ ok: true, message: `Synced ${sync.bytes ?? 0} bytes to the delivery customization.`, sync });
    }
    return json<ActionReply>({ ok: false, message: `Unknown intent: ${intent}` }, { status: 400 });
  } catch (error) {
    return json<ActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

type AdminApiClient = Parameters<typeof syncAfterOwnerEnsure>[0];

async function handleZoneCreate(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const parsed = parseZoneForm(formData);
  if (!parsed.ok) {
    return json<ActionReply>({ ok: false, fieldErrors: parsed.fieldErrors }, { status: 422 });
  }
  const value = parsed.value;
  const zone = await prisma.zone.create({
    data: {
      shopId,
      name: value.name,
      enabled: value.enabled,
      countries: JSON.stringify(value.countries),
      provinces: JSON.stringify(value.provinces),
      postalRules: JSON.stringify(value.postalRules),
    },
  });
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Created zone "${zone.name}"`, null, { id: zone.id, name: zone.name, enabled: zone.enabled });
  return json<ActionReply>({ ok: true, sync });
}

async function handleZoneUpdate(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.zone.findFirst({ where: { id, shopId }, select: { id: true, name: true, enabled: true } });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Zone not found." }, { status: 404 });
  }
  const parsed = parseZoneForm(formData);
  if (!parsed.ok) {
    return json<ActionReply>({ ok: false, fieldErrors: parsed.fieldErrors }, { status: 422 });
  }
  const value = parsed.value;
  const updated = await prisma.zone.updateMany({
    where: { id, shopId },
    data: {
      name: value.name,
      enabled: value.enabled,
      countries: JSON.stringify(value.countries),
      provinces: JSON.stringify(value.provinces),
      postalRules: JSON.stringify(value.postalRules),
    },
  });
  if (updated.count === 0) {
    return json<ActionReply>({ ok: false, message: "Zone not found." }, { status: 404 });
  }
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Updated zone "${value.name}"`, { id: existing.id, name: existing.name, enabled: existing.enabled }, { id, name: value.name, enabled: value.enabled });
  return json<ActionReply>({ ok: true, sync });
}

async function handleZoneDelete(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.zone.findFirst({ where: { id, shopId }, select: { id: true, name: true } });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Zone not found." }, { status: 404 });
  }
  // rules.zoneId is ON DELETE SET NULL (prisma/schema.prisma) — the rules
  // survive unlinked, and the mirror push below drops the zone from the wire.
  await prisma.zone.deleteMany({ where: { id, shopId } });
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Deleted zone "${existing.name}" (referencing rules unlinked)`, { id: existing.id, name: existing.name }, null);
  return json<ActionReply>({ ok: true, sync });
}

async function handleZoneToggle(
  admin: AdminApiClient,
  shopId: string,
  formData: FormData,
) {
  const id = String(formData.get("id") ?? "");
  const next = formData.get("value") === "1";
  const existing = await prisma.zone.findFirst({ where: { id, shopId }, select: { id: true, name: true, enabled: true } });
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Zone not found." }, { status: 404 });
  }
  const updated = await prisma.zone.updateMany({ where: { id, shopId }, data: { enabled: next } });
  if (updated.count === 0) {
    return json<ActionReply>({ ok: false, message: "Zone not found." }, { status: 404 });
  }
  const sync = await syncAfterOwnerEnsure(admin, shopId);
  await writeAudit(shopId, "MERCHANT", `Zone "${existing.name}" ${next ? "enabled" : "disabled"}`, { enabled: existing.enabled }, { enabled: next });
  return json<ActionReply>({ ok: true, sync });
}

function destinationSummary(zone: ZoneSummary): string {
  if (zone.countries.length === 0) {
    return "—";
  }
  if (zone.countries[0] === "*") {
    return "Worldwide";
  }
  const shown = zone.countries.slice(0, 3).join(", ");
  const extra = zone.countries.length > 3 ? ` +${zone.countries.length - 3} more` : "";
  const provinceNote =
    zone.countries.length === 1 && zone.provinces.length > 0 && zone.provinces[0] !== "*"
      ? ` (${zone.provinces.slice(0, 3).join(", ")}${zone.provinces.length > 3 ? "…" : ""})`
      : "";
  return `${shown}${extra}${provinceNote}`;
}

export default function ZonesPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const reply = fetcher.data as ActionReply | undefined;

  const [editorZone, setEditorZone] = useState<ZoneSummary | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ZoneSummary | null>(null);

  function openNewZone() {
    setEditorZone(null);
    setEditorOpen(true);
  }

  function openEditZone(zone: ZoneSummary) {
    setEditorZone(zone);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditorZone(null);
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    fetcher.submit({ intent: "zone-delete", id: deleteTarget.id }, { method: "post" });
    setDeleteTarget(null);
  }

  function retrySync() {
    fetcher.submit({ intent: "sync" }, { method: "post" });
  }

  const syncFailure = reply?.sync && reply.sync.ok === false ? reply.sync : null;
  const syncSuccess = reply?.sync && reply.sync.ok === true ? reply.sync : null;

  const rows = loaderData.zones.map(function toRowCells(zone) {
    return [
      <Text key="name" as="span" variant="bodyMd">
        {zone.name}
      </Text>,
      destinationSummary(zone),
      <Switch
        key="enabled"
        label={`Enable ${zone.name}`}
        labelHidden
        checked={zone.enabled}
        disabled={busy}
        onChange={function handleToggle(next: boolean) {
          fetcher.submit(
            { intent: "zone-toggle", id: zone.id, value: next ? "1" : "0" },
            { method: "post" },
          );
        }}
      />,
      zone.postalRules.length === 0 ? "—" : String(zone.postalRules.length),
      zone.usageCount === 0 ? (
        <Text key="usage" as="span" variant="bodySm" tone="subdued">
          —
        </Text>
      ) : (
        <Text key="usage" as="span" variant="bodySm">
          {zone.usageCount} rule(s)
        </Text>
      ),
      <ButtonGroup key="actions">
        <Button
          variant="plain"
          accessibilityLabel={`Edit ${zone.name}`}
          disabled={busy}
          onClick={function edit() {
            openEditZone(zone);
          }}
        >
          Edit
        </Button>
        <Button
          variant="plain"
          tone="critical"
          accessibilityLabel={`Delete ${zone.name}`}
          disabled={busy}
          onClick={function remove() {
            setDeleteTarget(zone);
          }}
        >
          Delete
        </Button>
      </ButtonGroup>,
    ];
  });

  return (
    <ShipMathPage
      title="Zones"
      subtitle="Group destinations by country, province and postal patterns"
      primaryAction={{ content: "New zone", onAction: openNewZone, loading: busy }}
    >
      <TitleBar title="Zones" />
      <Layout>
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
                action={{ content: "Retry sync", onAction: retrySync }}
              >
                <Text as="p" variant="bodySm">
                  The zone was saved to the database, but pushing it to the checkout Function failed:{" "}
                  {syncFailure.error}
                </Text>
              </Banner>
            ) : null}
            <SyncReportWarnings sync={syncSuccess} />

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {loaderData.zones.length} zone(s) · newest first
                  </Text>
                </InlineStack>
                {loaderData.zones.length === 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd">
                      No zones yet.
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Zones decide where a rule applies: countries, provinces, and postal codes. Create one,
                      then bind it to a rule on the Dashboard.
                    </Text>
                  </BlockStack>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                    headings={["Zone", "Destinations", "Enabled", "Postal rules", "Used by", "Actions"]}
                    rows={rows}
                    verticalAlign="middle"
                    increasedTableDensity
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {editorOpen ? (
        <ZoneEditorModal key={editorZone?.id ?? "new"} zone={editorZone} onClose={closeEditor} />
      ) : null}

      {deleteTarget ? (
        <Modal
          open
          onClose={function closeDelete() {
            setDeleteTarget(null);
          }}
          title="Delete zone?"
          primaryAction={{ content: "Delete zone", destructive: true, onAction: confirmDelete, loading: busy }}
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
                Delete “{deleteTarget.name}”? Rules that reference it keep running with no zone binding
                (they match every destination) until you edit them.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The checkout mirror updates on the sync that follows.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      ) : null}
    </ShipMathPage>
  );
}
