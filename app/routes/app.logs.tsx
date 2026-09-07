import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Collapsible,
  Divider,
  InlineStack,
  Layout,
  Pagination,
  Select,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma, { getOrCreateShop } from "../db.server";
import ShipMathPage from "../components/global/ShipMathPage";

/**
 * Request log viewer (spec 008 Task 4b, criteria 4-6): every live carrier
 * callback and simulator run lands here, newest first, filterable by source,
 * 50 rows per page with 30-day retention running in the background.
 */

const PAGE_SIZE = 50;

const SOURCE_OPTIONS = [
  { label: "All sources", value: "ALL" },
  { label: "Carrier callbacks", value: "CARRIER_CALLBACK" },
  { label: "Simulations", value: "SIMULATION" },
];

/** The bounded input snapshot logged with each run. */
interface LogInput {
  destination?: { country?: string; province?: string | null; postal?: string | null };
  subtotal?: string;
  weightGrams?: number;
  quantity?: number;
  currency?: string;
  lineCount?: number;
  loggedIn?: boolean;
  customerTags?: string[];
}

/**
 * One matched-rule entry. Carrier callbacks log `{ruleId, ruleName, order}`;
 * simulations log the full trace shape with a lane tag. Parsed defensively —
 * an unreadable row never breaks the page.
 */
interface LogMatched {
  ruleId?: string;
  ruleName?: string;
  order?: number;
  lane?: string;
  matched?: boolean;
  winner?: boolean;
  producedRate?: boolean;
  zoneGate?: string;
}

interface LogRate {
  serviceName?: string;
  serviceCode?: string;
  priceCents?: string;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** UTC stamp so server and client render identical text (no hydration drift). */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatCents(cents: string | undefined): string {
  const value = Number.parseInt(cents ?? "", 10);
  if (!Number.isFinite(value)) {
    return cents ?? "";
  }
  return `$${(value / 100).toFixed(2)}`;
}

function serializeLog(row: {
  id: string;
  source: string;
  inputDigest: string;
  input: string | null;
  matched: string;
  rates: string | null;
  latencyMs: number | null;
  createdAt: Date;
}) {
  const input = parseJson<LogInput>(row.input);
  let matched = parseJson<LogMatched[]>(row.matched) ?? [];
  const ratesJson = parseJson<LogRate[] | { rates?: LogRate[]; functionOperations?: unknown[] }>(row.rates);
  // Simulation rows wrap rates in {rates, functionOperations}; callback rows
  // store a bare array.
  const rates = Array.isArray(ratesJson) ? ratesJson : (ratesJson?.rates ?? []);
  if (!Array.isArray(matched)) {
    matched = [];
  }
  return {
    id: row.id,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    latencyMs: row.latencyMs,
    digest: row.inputDigest,
    input,
    matched,
    rates,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const requestedPage = Number.isFinite(requested) && requested >= 1 ? requested : 1;
  const sourceParam = url.searchParams.get("source") ?? "";
  const source =
    sourceParam === "CARRIER_CALLBACK" || sourceParam === "SIMULATION" ? sourceParam : null;

  const where = { shopId: shop.id, ...(source ? { source } : {}) };
  const firstPage = await prisma.requestLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    skip: (requestedPage - 1) * PAGE_SIZE,
  });
  const total = await prisma.requestLog.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const rows = page === requestedPage ? firstPage : await prisma.requestLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  return json({
    logs: rows.map(serializeLog),
    total,
    page,
    totalPages,
    source: source ?? "",
  });
}

function DestinationLine({ input }: { input: LogInput | null }) {
  if (!input) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        Input snapshot unavailable.
      </Text>
    );
  }
  const destination = input.destination ?? {};
  const parts: string[] = [];
  if (destination.country) {
    parts.push(
      [destination.country, destination.province, destination.postal]
        .filter(function keep(part) {
          return Boolean(part);
        })
        .join(" / "),
    );
  }
  if (input.subtotal !== undefined) {
    parts.push(`subtotal ${input.subtotal}`);
  }
  if (input.weightGrams !== undefined) {
    parts.push(`${input.weightGrams} g`);
  }
  if (input.quantity !== undefined) {
    parts.push(`qty ${input.quantity}`);
  }
  if (input.lineCount !== undefined) {
    parts.push(`${input.lineCount} line(s)`);
  }
  if (input.loggedIn !== undefined) {
    parts.push(input.loggedIn ? "logged in" : "guest");
  }
  if (input.customerTags && input.customerTags.length > 0) {
    parts.push(`tags: ${input.customerTags.join(", ")}`);
  }
  return (
    <Text as="p" variant="bodySm" tone="subdued">
      {parts.length > 0 ? parts.join(" · ") : "No input details logged."}
    </Text>
  );
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: ReturnType<typeof serializeLog>;
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <BlockStack gap="0">
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="300" blockAlign="center">
          <Badge tone={log.source === "SIMULATION" ? "info" : "success"}>
            {log.source === "SIMULATION" ? "Simulation" : "Live callback"}
          </Badge>
          <Text as="span" variant="bodySm">
            {formatStamp(log.createdAt)}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {log.rates.length} rate(s) · {log.latencyMs ?? "?"} ms
          </Text>
        </InlineStack>
        <Button
          size="slim"
          onClick={onToggle}
          ariaExpanded={expanded}
          ariaControls={`log-details-${log.id}`}
        >
          {expanded ? "Hide details" : "Details"}
        </Button>
      </InlineStack>
      <Collapsible
        open={expanded}
        id={`log-details-${log.id}`}
        transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
      >
        <BlockStack gap="200">
          <DestinationLine input={log.input} />
          <BlockStack gap="100">
            <Text as="h4" variant="headingXs">
              Rules evaluated ({log.matched.length})
            </Text>
            {log.matched.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No rules were attached to this run.
              </Text>
            ) : (
              log.matched.map(function renderEntry(entry, index) {
                const name = entry.ruleName || entry.ruleId || `rule ${index + 1}`;
                const bits: string[] = [];
                if (entry.lane) {
                  bits.push(entry.lane === "FUNCTION" ? "function lane" : "carrier lane");
                }
                if (entry.winner === true) {
                  bits.push("winner");
                } else if (entry.producedRate === true) {
                  bits.push("rate returned");
                } else if (entry.matched === true) {
                  bits.push("matched, no rate");
                } else if (entry.matched === false) {
                  bits.push(entry.zoneGate ? `not matched (${entry.zoneGate})` : "not matched");
                } else if (entry.order !== undefined) {
                  bits.push(`order ${entry.order}`);
                }
                return (
                  <Text as="p" key={`${entry.ruleId ?? index}-${index}`} variant="bodySm">
                    {name}
                    {bits.length > 0 ? (
                      <Text as="span" tone="subdued" variant="bodySm">
                        {" "}
                        — {bits.join(", ")}
                      </Text>
                    ) : null}
                  </Text>
                );
              })
            )}
          </BlockStack>
          <BlockStack gap="100">
            <Text as="h4" variant="headingXs">
              Rates ({log.rates.length})
            </Text>
            {log.rates.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No rates were returned.
              </Text>
            ) : (
              log.rates.map(function renderRate(rate, index) {
                return (
                  <Text as="p" key={`${rate.serviceCode ?? index}-${index}`} variant="bodySm">
                    {rate.serviceName ?? "?"} · {rate.serviceCode ?? "?"} ·{" "}
                    {formatCents(rate.priceCents)}
                  </Text>
                );
              })
            )}
          </BlockStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Input digest {log.digest}
          </Text>
        </BlockStack>
      </Collapsible>
    </BlockStack>
  );
}

export default function LogsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function changeSource(value: string) {
    navigate(value === "ALL" ? "/app/logs" : `/app/logs?source=${value}`);
  }

  function changePage(next: number) {
    const base = loaderData.source ? `source=${loaderData.source}&` : "";
    navigate(`/app/logs?${base}page=${next}`);
  }

  return (
    <ShipMathPage
      title="Request log"
      subtitle="Every live carrier callback and simulation, newest first"
      primaryAction={{
        content: "Simulate rates",
        onAction: function openSimulator() {
          navigate("/app/simulator");
        },
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <div style={{ minWidth: "14rem" }}>
                    <Select
                      label="Source"
                      labelInline
                      options={SOURCE_OPTIONS}
                      value={loaderData.source || "ALL"}
                      onChange={changeSource}
                    />
                  </div>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {loaderData.total} run(s) · kept for 30 days
                  </Text>
                </InlineStack>
              </InlineStack>

              {loaderData.logs.length === 0 ? (
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    Nothing logged yet.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Live checkout calls and simulator runs appear here. Run the
                    simulator to try the rules without a test checkout.
                  </Text>
                </BlockStack>
              ) : (
                <BlockStack gap="300">
                  {loaderData.logs.map(function renderLog(log, index) {
                    return (
                      <BlockStack gap="300" key={log.id}>
                        <LogRow
                          log={log}
                          expanded={expandedId === log.id}
                          onToggle={function toggle() {
                            setExpandedId(expandedId === log.id ? null : log.id);
                          }}
                        />
                        {index < loaderData.logs.length - 1 ? <Divider /> : null}
                      </BlockStack>
                    );
                  })}
                </BlockStack>
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
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How this works
              </Text>
              <Text as="p" variant="bodySm">
                Every live rates call from checkout and every simulator run
                writes one row here: what came in, which rules were evaluated,
                and what came back. Rows older than 30 days are pruned
                automatically, so the log stays a debugging tool, not a data
                store.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </ShipMathPage>
  );
}
