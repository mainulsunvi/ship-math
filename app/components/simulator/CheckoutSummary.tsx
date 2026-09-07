import { RadioButton, BlockStack, Divider, InlineStack, Text } from "@shopify/polaris";
import type { SimulationResult } from "../../lib/simulate";
import type { CheckoutCustomization, CheckoutOption } from "../../lib/store-rates";

/**
 * Checkout-style order summary for the simulator page (spec 008): line items
 * with images, the totals block (subtotal, weight, item count), and the
 * shipping rates box where the merchant picks a rate and sees the total.
 */

export interface SimLineDraft {
  key: string;
  title: string;
  variantTitle?: string;
  image?: string;
  price: string;
  weightGrams: string;
  quantity: string;
  sku: string;
  vendor: string;
  productTags: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  JPY: "¥",
};

function symbolFor(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

function money(amount: string | number, currency: string): string {
  const value = typeof amount === "number" ? amount : Number.parseFloat(amount);
  const safe = Number.isFinite(value) ? value : 0;
  return `${symbolFor(currency)}${safe.toFixed(2)}`;
}

function lineQuantity(line: SimLineDraft): number {
  const value = Number.parseInt(line.quantity, 10);
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

function lineWeightGrams(line: SimLineDraft): number {
  const value = Number.parseInt(line.weightGrams, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatWeight(grams: number): string {
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(2)} kg`;
  }
  return `${grams} g`;
}

/** One delivery-customization effect, in merchant language. */
function describeCustomization(entry: CheckoutCustomization): string {
  if (entry.kind === "HIDE") {
    return `"${entry.title}" hidden by rule "${entry.ruleName}"`;
  }
  if (entry.kind === "RENAME") {
    return `"${entry.title}" renamed to "${entry.renamedTo ?? ""}" by rule "${entry.ruleName}"`;
  }
  return `"${entry.title}" moved to position ${(entry.index ?? 0) + 1} by rule "${entry.ruleName}"`;
}

interface CheckoutSummaryProps {
  lines: SimLineDraft[];
  result?: SimulationResult;
  /** Combined store + ShipMath options for this run (empty before a run). */
  options: CheckoutOption[];
  /** Every hide/rename/move the Function lane applied to the options. */
  customizations: CheckoutCustomization[];
  currency: string;
  shipToLines: string[];
  pickupLocationName: string | null;
  selectedRateCode: string | null;
  onSelectRate(code: string): void;
}

/** The right-column order summary, styled like checkout. */
function CheckoutSummary({
  lines,
  result,
  options,
  customizations,
  currency,
  shipToLines,
  pickupLocationName,
  selectedRateCode,
  onSelectRate,
}: CheckoutSummaryProps) {
  let subtotal = 0;
  let totalGrams = 0;
  let totalQuantity = 0;
  for (const line of lines) {
    const quantity = lineQuantity(line);
    const price = Number.parseFloat(line.price);
    subtotal += (Number.isFinite(price) ? price : 0) * quantity;
    totalGrams += lineWeightGrams(line) * quantity;
    totalQuantity += quantity;
  }

  // A stale selection (rate removed by a re-run) falls back to the first
  // option, exactly like checkout's default pick.
  const effectiveRateCode =
    selectedRateCode && options.some(function exists(option) {
      return option.code === selectedRateCode;
    })
      ? selectedRateCode
      : options[0]?.code ?? null;
  const chosenRate = options.find(function match(option) {
    return option.code === effectiveRateCode;
  });
  const shipping = chosenRate ? Number.parseFloat(chosenRate.price) : 0;

  return (
    <BlockStack gap="300">
      <BlockStack gap="100">
        <Text as="h3" variant="headingSm">
          Ship to
        </Text>
        {shipToLines.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            Fill in the destination to see it here.
          </Text>
        ) : (
          shipToLines.map(function renderLine(lineText) {
            return (
              <Text as="p" key={lineText} variant="bodySm">
                {lineText}
              </Text>
            );
          })
        )}
        {pickupLocationName ? (
          <Text as="p" variant="bodySm" tone="subdued">
            Pickup: {pickupLocationName}
          </Text>
        ) : null}
      </BlockStack>

      <Divider />

      <BlockStack gap="300">
        {lines.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No cart lines yet.
          </Text>
        ) : (
          lines.map(function renderLine(line) {
            const quantity = lineQuantity(line);
            const price = Number.parseFloat(line.price);
            return (
              <InlineStack key={line.key} gap="300" blockAlign="center">
                {line.image ? (
                  <img
                    src={line.image}
                    alt=""
                    width={44}
                    height={44}
                    style={{ borderRadius: "8px", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "8px",
                      background: "var(--p-color-bg-fill-tertiary, #f1f1f1)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {line.title || "Untitled"}
                    {line.variantTitle ? ` · ${line.variantTitle}` : ""}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {money(price, currency)} × {quantity}
                    {line.sku ? ` · ${line.sku}` : ""}
                  </Text>
                </div>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {money((Number.isFinite(price) ? price : 0) * quantity, currency)}
                </Text>
              </InlineStack>
            );
          })
        )}
      </BlockStack>

      <Divider />

      <BlockStack gap="100">
        <InlineStack align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            Items
          </Text>
          <Text as="span" variant="bodySm">
            {totalQuantity}
          </Text>
        </InlineStack>
        <InlineStack align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            Weight
          </Text>
          <Text as="span" variant="bodySm">
            {formatWeight(totalGrams)}
          </Text>
        </InlineStack>
        <InlineStack align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            Subtotal {`(${currency})`}
          </Text>
          <Text as="span" variant="bodySm">
            {money(subtotal, currency)}
          </Text>
        </InlineStack>
      </BlockStack>

      <Divider />

      <BlockStack gap="150">
        <Text as="h3" variant="headingSm">
          Shipping rates
        </Text>
        {!result ? (
          <Text as="p" variant="bodySm" tone="subdued">
            Run the simulation and checkout's shipping options will appear
            here — the store's own methods plus the rates your rules return,
            pickable like checkout.
          </Text>
        ) : options.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No shipping options for this cart and destination — either no rate
            applies, or a hide rule removed every option.
          </Text>
        ) : (
          <BlockStack gap="150">
            {options.map(function renderOption(option) {
              return (
                <InlineStack key={option.code} gap="200" blockAlign="center">
                  <div style={{ flexGrow: 1 }}>
                    <RadioButton
                      label={`${option.title} — ${money(option.price, currency)}`}
                      labelHidden={false}
                      name="simulator-rate"
                      value={option.code}
                      checked={effectiveRateCode === option.code}
                      onChange={function pick() {
                        onSelectRate(option.code);
                      }}
                    />
                  </div>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {option.source === "STORE" ? "store" : "rule"}
                  </Text>
                </InlineStack>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>

      {result && (customizations.length > 0 || result.functionOperations.length > 0) ? (
        <>
          <Divider />
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              Delivery customizations
            </Text>
            {customizations.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                Customization rules ran but matched no shipping option here —
                check each rule&apos;s option filters.
              </Text>
            ) : (
              customizations.map(function renderCustomization(entry, index) {
                return (
                  <Text as="p" key={`${entry.kind}-${index}`} variant="bodySm">
                    {describeCustomization(entry)}
                  </Text>
                );
              })
            )}
          </BlockStack>
        </>
      ) : null}

      <Divider />

      <BlockStack gap="100">
        <InlineStack align="space-between">
          <Text as="span" variant="bodySm">
            Shipping
          </Text>
          <Text as="span" variant="bodySm">
            {options.length > 0 && chosenRate ? money(shipping, currency) : "—"}
          </Text>
        </InlineStack>
        <InlineStack align="space-between">
          <Text as="span" variant="headingMd" fontWeight="bold">
            Total
          </Text>
          <Text as="span" variant="headingMd" fontWeight="bold">
            {options.length > 0 && chosenRate ? money(subtotal + shipping, currency) : money(subtotal, currency)}
          </Text>
        </InlineStack>
      </BlockStack>
    </BlockStack>
  );
}

export default CheckoutSummary;
