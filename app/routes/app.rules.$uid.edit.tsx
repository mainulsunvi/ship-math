import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Layout, Text } from "@shopify/polaris";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../db.server";
import { getRuleByUid, listZones, updateRule } from "../lib/repositories/rules";
import { syncAfterOwnerEnsure, type MirrorSyncReport } from "../lib/sync";
import { writeAudit } from "../lib/audit";
import { parseRuleForm } from "../lib/rule-form";
import { RuleKindSchema } from "../lib/config-schema";
import ShipMathPage from "../components/global/ShipMathPage";
import RuleForm, { type RuleFormInitial } from "../components/rules/RuleForm";
import SyncReportWarnings from "../components/rules/SyncReportWarnings";

/**
 * /app/rules/:uid/edit — dedicated edit route keyed by the rule's public uid
 * (user decision 2026-09-07). The action is the dashboard's rule-update
 * orchestration verbatim: updateRule → ensure owner → push mirror → audit.
 */

type AdminApiClient = Parameters<typeof syncAfterOwnerEnsure>[0];

interface ActionReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const uid = String(params.uid ?? "");
  const rule = await getRuleByUid(shop.id, uid);
  if (!rule) {
    throw new Response("Rule not found", { status: 404 });
  }
  const zones = await listZones(shop.id);
  const kindResult = RuleKindSchema.safeParse(rule.kind);
  const initial: RuleFormInitial = {
    name: rule.name,
    kind: kindResult.success ? kindResult.data : "HIDE",
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    zoneId: rule.zoneId,
    conditions: JSON.parse(rule.conditions),
    action: JSON.parse(rule.action),
  };
  return json({
    ruleId: rule.id,
    uid: rule.uid,
    ruleName: rule.name,
    initial,
    zones: zones.map(function toOption(zone) {
      return { id: zone.id, name: zone.name };
    }),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const uid = String(params.uid ?? "");
  const existing = await getRuleByUid(shop.id, uid);
  if (!existing) {
    return json<ActionReply>({ ok: false, message: "Rule not found." }, { status: 404 });
  }
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "rule-update") {
    return json<ActionReply>({ ok: false, message: `Unknown intent: ${intent}` }, { status: 400 });
  }

  try {
    const parsed = parseRuleForm(formData);
    if (!parsed.ok) {
      return json<ActionReply>({ ok: false, message: parsed.message }, { status: 422 });
    }
    const rule = await updateRule(shop.id, existing.id, parsed.input);
    const sync = await syncAfterOwnerEnsure(admin, shop.id);
    await writeAudit(
      shop.id,
      "MERCHANT",
      `Updated rule "${rule.name}"`,
      { id: existing.id, uid: existing.uid, name: existing.name, enabled: existing.enabled, priority: existing.priority, zoneId: existing.zoneId },
      { id: rule.id, uid: rule.uid, name: rule.name, enabled: rule.enabled, priority: rule.priority, zoneId: rule.zoneId },
    );
    return json<ActionReply>({ ok: true, sync });
  } catch (error) {
    return json<ActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export default function EditRuleRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const reply = fetcher.data as ActionReply | undefined;

  // Return to the dashboard once the update succeeds.
  useEffect(
    function leaveOnSuccess() {
      if (!busy && reply?.ok === true) {
        navigate("/app");
      }
    },
    [busy, reply, navigate],
  );

  return (
    <ShipMathPage
      title="Edit Rule"
      subtitle={loaderData.ruleName}
      backAction={{ content: "Rules", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Text as="p" variant="bodySm" tone="subdued">
            ID: {loaderData.uid}
          </Text>
          <SyncReportWarnings sync={reply?.sync && reply.sync.ok ? reply.sync : undefined} />
          <RuleForm
            mode="edit"
            zones={loaderData.zones}
            initial={loaderData.initial}
            submitLabel="Save changes"
            busy={busy}
            serverError={!busy && reply?.ok === false ? reply.message ?? "Could not save the rule." : null}
            onSubmit={function submit(input) {
              fetcher.submit(
                {
                  intent: "rule-update",
                  name: input.name,
                  kind: input.kind,
                  priority: String(input.priority),
                  stopOnMatch: input.stopOnMatch ? "1" : "0",
                  zoneId: input.zoneId,
                  conditions: JSON.stringify(input.conditions),
                  action: JSON.stringify(input.action),
                },
                { method: "post" },
              );
            }}
            onCancel={function cancel() {
              navigate("/app");
            }}
          />
        </Layout.Section>
      </Layout>
    </ShipMathPage>
  );
}
