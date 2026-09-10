/*
 * /app/rules — the Rules page backing the nav's Rules tab (2026-09-11).
 * Previously a redirect to /app (005 rules-on-routes review): the dashboard
 * WAS the rules table. With the dedicated Rules tab, this page now carries
 * the table itself. The mutation handlers live in
 * ../lib/rule-table-actions and are shared verbatim with the dashboard's
 * action so the two views can never drift.
 */
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Card,
  InlineStack,
  Modal,
  Pagination,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../db.server";
import { listRules, listZones } from "../lib/repositories/rules";
import {
  handleRuleDelete,
  handleRuleDuplicate,
  handleRulePriority,
  handleRuleToggle,
  RULES_PAGE_SIZE,
  toRuleRow,
  type RuleTableActionReply,
} from "../lib/rule-table-actions";
import ShipMathPage from "../components/global/ShipMathPage";
import RulesTable, { type RuleRow } from "../components/rules/RulesTable";
import SyncReportWarnings from "../components/rules/SyncReportWarnings";

/** Soft-cap warning threshold (005 criterion 7); the cap itself is 500. */
const RULES_CAP_WARN = 400;
const RULES_SOFT_CAP = 500;

function toEvaluationMode(value: string): "FIRST_MATCH" | "ALL_MATCH" | undefined {
  if (value === "FIRST_MATCH" || value === "ALL_MATCH") {
    return value;
  }
  return undefined;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

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
    evaluationMode: shop.evaluationMode,
    rules: rules.map(toRuleRow),
    total,
    page,
    totalPages,
    zones: zones.map(function toOption(zone) {
      return { id: zone.id, name: zone.name };
    }),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  try {
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
    return json<RuleTableActionReply>(
      { ok: false, message: `Unknown intent: ${intent}` },
      { status: 400 },
    );
  } catch (error) {
    return json<RuleTableActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export default function RulesPage() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const tableFetcher = useFetcher<typeof action>();
  const busy = tableFetcher.state !== "idle";
  const reply = tableFetcher.data as RuleTableActionReply | undefined;

  const [deleteTarget, setDeleteTarget] = useState<RuleRow | null>(null);

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

  return (
    <ShipMathPage
      	title="Rules"
		subtitle="Control how delivery options are shown and priced at checkout"
		backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
      	primaryAction={{ content: "New rule", onAction: openNewRule, loading: busy }}
      	secondaryActions={[
        {
          content: "Simulate rates",
          onAction: function openSimulator() {
            navigate("/app/simulator");
          },
        },
      ]}
    >
      <BlockStack gap="400">
        <SyncReportWarnings
          sync={reply?.sync && reply.sync.ok ? reply.sync : undefined}
        />
        {!busy && reply?.ok === false && reply.message ? (
          <Banner tone="critical">{reply.message}</Banner>
        ) : null}
        {loaderData.total >= RULES_CAP_WARN ? (
          <Banner tone="warning" title="Approaching the Rule Soft Cap">
            {loaderData.total} of {RULES_SOFT_CAP} rules. Sync size and evaluation time grow
            with rule count. Archive or merge rules you no longer need.
          </Banner>
        ) : null}
        <Card>
          <BlockStack gap="400">
            {loaderData.rules.length === 0 ? (
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  No rules yet.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Create your first rule with “New rule”.
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
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {loaderData.total === 1 ? "1 rule" : `${loaderData.total} rules`}{" "}
                  · page {loaderData.page} of {loaderData.totalPages}
                </Text>
                <Pagination
                  hasPrevious={loaderData.page > 1}
                  hasNext={loaderData.page < loaderData.totalPages}
                  onPrevious={function goPrevious() {
                    navigate(`/app/rules?page=${loaderData.page - 1}`);
                  }}
                  onNext={function goNext() {
                    navigate(`/app/rules?page=${loaderData.page + 1}`);
                  }}
                />
              </InlineStack>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>

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
            <Text as="p" variant="bodyMd">
              Delete “{deleteTarget.name}”? The rule is removed everywhere and the
              checkout mirror syncs immediately.
            </Text>
          </Modal.Section>
        </Modal>
      ) : null}
    </ShipMathPage>
  );
}

