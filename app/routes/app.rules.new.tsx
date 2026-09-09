import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { Layout } from "@shopify/polaris";
import { useEffect } from "react";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../db.server";
import { listRules, listZones, createRule } from "../lib/repositories/rules";
import { syncAfterOwnerEnsure, type MirrorSyncReport } from "../lib/sync";
import { writeAudit } from "../lib/audit";
import { parseRuleForm } from "../lib/rule-form";
import ShipMathPage from "../components/global/ShipMathPage";
import RuleForm from "../components/rules/RuleForm";
import SyncReportWarnings from "../components/rules/SyncReportWarnings";

/**
 * /app/rules/new — dedicated create route (user decision 2026-09-07: rules
 * live on routes, not modals). The action is the dashboard's rule-create
 * orchestration verbatim: createRule → ensure owner → push mirror → audit.
 */

type AdminApiClient = Parameters<typeof syncAfterOwnerEnsure>[0];

interface ActionReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
}

const RULES_PAGE_SIZE = 50;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [{ total }, zones] = await Promise.all([listRules(shop.id), listZones(shop.id)]);
  const lastPage = Math.max(1, Math.ceil(total / RULES_PAGE_SIZE));
  const suggestedPriority = (total + 1) * 10;
  return json({
    zones: zones.map(function toOption(zone) {
      return { id: zone.id, name: zone.name };
    }),
    suggestedPriority,
    lastPage,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "rule-create") {
    return json<ActionReply>({ ok: false, message: `Unknown intent: ${intent}` }, { status: 400 });
  }

  try {
    const parsed = parseRuleForm(formData);
    if (!parsed.ok) {
      return json<ActionReply>({ ok: false, message: parsed.message }, { status: 422 });
    }
    const rule = await createRule(shop.id, parsed.input);
    const sync = await syncAfterOwnerEnsure(admin, shop.id);
    await writeAudit(shop.id, "MERCHANT", `Created rule "${rule.name}"`, null, {
      id: rule.id,
      uid: rule.uid,
      name: rule.name,
      kind: rule.kind,
      priority: rule.priority,
    });
    return json<ActionReply>({ ok: true, sync });
  } catch (error) {
    return json<ActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export default function NewRuleRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const reply = fetcher.data as ActionReply | undefined;

  // Return to the dashboard once the create succeeds.
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
      title="New Rule"
      subtitle="Create a shipping rule"
      backAction={{ content: "Rules", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <SyncReportWarnings sync={reply?.sync && reply.sync.ok ? reply.sync : undefined} />
          <RuleForm
            mode="create"
            zones={loaderData.zones}
            suggestedPriority={loaderData.suggestedPriority}
            submitLabel="Create rule"
            busy={busy}
            serverError={!busy && reply?.ok === false ? reply.message ?? "Could not create the rule." : null}
            onSubmit={function submit(input) {
              fetcher.submit(
                {
                  intent: "rule-create",
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
