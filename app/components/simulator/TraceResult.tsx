import type { RuleTrace } from "../../lib/rule-explain";
import type { SimFunctionOperation, SimulationResult } from "../../lib/simulate";
import { Badge, BlockStack, Banner, Box, InlineStack, Text } from "@shopify/polaris";

/**
 * Renders a finished simulation: carrier rates, function operations, and the
 * per-rule traces for both lanes (spec 008 Task 3, criterion 2).
 */

const FIELD_LABELS: Record<string, string> = {
  subtotal: "Cart subtotal",
  weight: "Total weight (g)",
  quantity: "Item count",
  sku: "SKU",
  vendor: "Vendor",
  ptag: "Product tag",
  ctag: "Customer tag",
  auth: "Logged in",
};

const OPERATOR_LABELS: Record<string, string> = {
  "=": "is",
  "!=": "is not",
  ">": "is more than",
  ">=": "is at least",
  "<": "is less than",
  "<=": "is at most",
  in: "is one of",
  nin: "is none of",
  has: "contains",
};

const GATE_LABELS: Record<string, string> = {
  country: "destination outside the zone (country list)",
  province: "destination outside the zone (province list)",
  postal: "destination outside the zone (postal rules)",
  "missing-zone": "zone no longer exists (treated as no match)",
};

/** Formats a subunit cents string ("500") as a display price ("$5.00"). */
function formatCents(cents: string): string {
  const value = Number.parseInt(cents, 10);
  if (!Number.isFinite(value)) {
    return cents;
  }
  return `$${(value / 100).toFixed(2)}`;
}

/** Renders one wire condition in merchant language, e.g. Cart subtotal ≥ 500. */
function describeCondition(condition: NonNullable<RuleTrace["failedCondition"]>): string {
  const field = FIELD_LABELS[condition.f] ?? condition.f;
  const operator = OPERATOR_LABELS[condition.q] ?? condition.q;
  const value = Array.isArray(condition.v)
    ? condition.v.join(", ")
    : String(condition.v);
  return `${field} ${operator} ${value}`;
}

function describeGate(trace: RuleTrace): string | null {
  if (!trace.zoneGate) {
    return null;
  }
  return GATE_LABELS[trace.zoneGate] ?? trace.zoneGate;
}

/** One trace row: a pass/fail badge, the rule name, and why it failed. */
function TraceRow({ trace, lane }: { trace: RuleTrace; lane: "FUNCTION" | "CARRIER" }) {
  const won =
    lane === "FUNCTION" ? trace.winner === true : trace.producedRate === true;
  let tone: "success" | "attention" | "info" = "attention";
  let label = "Not matched";
  if (won) {
    tone = "success";
    label = lane === "FUNCTION" ? "Winner" : "Rate returned";
  } else if (trace.matched) {
    tone = "info";
    label = lane === "CARRIER" ? "Matched, no rate" : "Matched";
  }

  const reasons: string[] = [];
  const gate = describeGate(trace);
  if (gate) {
    reasons.push(gate);
  }
  if (trace.failedCondition) {
    reasons.push(describeCondition(trace.failedCondition));
  }

  return (
    <InlineStack gap="200" blockAlign="center">
      <Badge tone={tone}>{label}</Badge>
      <Text as="span" variant="bodySm">
        {trace.ruleName ?? trace.ruleId}
      </Text>
      {reasons.length > 0 ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {reasons.join(" · ")}
        </Text>
      ) : null}
    </InlineStack>
  );
}

/** One function operation in merchant language. */
function OperationRow({ operation }: { operation: SimFunctionOperation }) {
  const target =
    operation.titleContains ??
    (operation.methodType ? operation.methodType.toLowerCase() : "matching options");
  let text: string;
  if (operation.kind === "HIDE") {
    text = `Hide options matching "${target}"`;
  } else if (operation.kind === "RENAME") {
    text = `Rename "${target}" to "${operation.title ?? ""}"`;
  } else {
    text = `Move "${target}" to position ${(operation.index ?? 0) + 1}`;
  }
  return (
    <Text as="p" variant="bodySm">
      {text}
      {" "}
      <Text as="span" tone="subdued" variant="bodySm">
        (rule: {operation.ruleName})
      </Text>
    </Text>
  );
}

interface TraceResultProps {
  result: SimulationResult;
}

/** The read-only results section of the simulator modal. */
function TraceResult({ result }: TraceResultProps) {
  const gateNotes = result.carrierTraces
    .filter(function failed(trace) {
      return !trace.matched;
    })
    .map(function note(trace) {
      const name = trace.ruleName ?? trace.ruleId;
      const gate = describeGate(trace);
      return gate ? `${name}: ${gate}` : `${name}: a condition failed`;
    });

  return (
    <BlockStack gap="400">
      {result.note ? (
        <Banner tone="warning" title="Function mirror over budget">
          <Text as="p" variant="bodySm">
            {result.note} Carrier rates are still a faithful preview; function
            operations need a smaller configuration (sync, then simulate again).
          </Text>
        </Banner>
      ) : null}
      {result.testMode ? (
        <Banner tone="info" title="Test mode is ON">
          <Text as="p" variant="bodySm">
            This preview shows what the rules WOULD do. Live checkout applies
            no operations while test mode stays on.
          </Text>
        </Banner>
      ) : null}

      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          Carrier rates returned
        </Text>
        {result.rates.length === 0 ? (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              No rates match this cart and destination
              {gateNotes.length > 0 ? ` — ${gateNotes.join("; ")}` : "."}
            </Text>
          </Banner>
        ) : (
          <BlockStack gap="150">
            {result.rates.map(function rate(rate) {
              return (
                <InlineStack key={rate.serviceCode} align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {rate.serviceName}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {rate.serviceCode}
                    </Text>
                  </BlockStack>
                  <Text as="span" variant="headingMd">
                    {formatCents(rate.priceCents)}
                  </Text>
                </InlineStack>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>

      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          Function operations (what checkout would do)
        </Text>
        {result.functionOperations.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No operations — no function rule wins for this cart.
          </Text>
        ) : (
          <BlockStack gap="150">
            {result.functionOperations.map(function operation(operation) {
              return <OperationRow key={operation.ruleId} operation={operation} />;
            })}
          </BlockStack>
        )}
      </BlockStack>

      <Box paddingBlockStart="200">
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Function lane — rule by rule
          </Text>
          {result.traces.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              No function rules configured.
            </Text>
          ) : (
            <BlockStack gap="150">
              {result.traces.map(function render(trace) {
                return <TraceRow key={trace.ruleId} trace={trace} lane="FUNCTION" />;
              })}
            </BlockStack>
          )}
        </BlockStack>
      </Box>

      <Box paddingBlockStart="200">
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">
            Carrier lane — rule by rule
          </Text>
          {result.carrierTraces.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              No carrier rate rules configured.
            </Text>
          ) : (
            <BlockStack gap="150">
              {result.carrierTraces.map(function render(trace) {
                return <TraceRow key={trace.ruleId} trace={trace} lane="CARRIER" />;
              })}
            </BlockStack>
          )}
        </BlockStack>
      </Box>

      <Text as="p" variant="bodySm" tone="subdued">
        Function mirror {result.wireBytes.toLocaleString()} bytes · evaluation
        mode {result.evaluationMode === "ALL_MATCH" ? "all matches apply" : "first match wins"}.
      </Text>
    </BlockStack>
  );
}

export default TraceResult;
