import { cloneElement, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import {
  BlockStack,
  Box,
  Divider,
  Popover,
  Text,
  TextField,
} from "@shopify/polaris";
import type { ConditionField, RuleKind } from "../../lib/config-schema";
import { CARRIER_RATE_FORBIDDEN_FIELDS, CLOCK_ONLY_FIELDS, FIELD_META } from "./ConditionRow";

/**
 * Condition field catalog (spec 021). The default export keeps the legacy
 * "+ Add condition" popover for compatibility; the exported
 * ConditionCatalog is the embedded list the ConditionModal renders as its
 * first step (search box + grouped entries + lane notes).
 *
 * destination_* fields are deliberately not offered: destination targeting is
 * zone-linked (spec 005) — the Basics section's zone picker narrows the
 * destination match, and the catalog carries a note saying so. Fields the
 * rule kind cannot evaluate (§A3 lane matrix) are filtered exactly like the
 * row's own field dropdown.
 */

interface PickerCategory {
  title: string;
  fields: ConditionField[];
}

/** FIELD_META carries labels + operators but no grouping — group it locally. */
const FIELD_CATEGORIES: PickerCategory[] = [
  { title: "Cart", fields: ["subtotal", "total", "quantity", "weight"] },
  { title: "Product", fields: ["price", "sku", "vendor", "product_tag"] },
  { title: "Customer", fields: ["customer_tag", "logged_in", "city"] },
  { title: "Date and time", fields: ["date", "day_of_week", "time_of_day"] },
];

/** Short helper text under each entry; also matched by the search filter. */
const FIELD_DESCRIPTIONS: Record<ConditionField, string> = {
  subtotal: "Cart subtotal before shipping and taxes",
  total: "Cart total including shipping and taxes",
  weight: "Cart total weight",
  quantity: "Total item quantity",
  price: "Price of a single item in the cart",
  product_tag: "Tags on cart items",
  sku: "Item SKU values",
  vendor: "Product vendor name",
  customer_tag: "Tags on the customer",
  logged_in: "Whether the customer is signed in",
  city: "Destination city from the shipping address",
  date: "Calendar date in the shop time zone",
  day_of_week: "Day of the week in the shop time zone",
  time_of_day: "Time of day in the shop time zone",
  destination_country: "Shipping destination country",
  destination_province: "Shipping destination province",
  destination_postal: "Shipping destination postal code",
};

const DESTINATION_NOTE =
  "Destination targeting is handled by zones. Choose a zone in the Basics section instead of adding destination conditions.";

const CLOCK_NOTE =
  "Date and time conditions run in the carrier lane and the simulator only. The checkout Function has no clock, so a rule using them is left out of the checkout copy at sync time.";

interface CatalogCategory {
  title: string;
  entries: ConditionField[];
}

function visibleCategories(ruleKind: RuleKind, query: string): CatalogCategory[] {
  const needle = query.trim().toLowerCase();
  return FIELD_CATEGORIES.map(function mapCategory(category) {
    return {
      title: category.title,
      entries: category.fields
        .filter(function allowedForKind(field) {
          return ruleKind !== "CARRIER_RATE" || !CARRIER_RATE_FORBIDDEN_FIELDS.includes(field);
        })
        .filter(function matchesSearch(field) {
          if (needle === "") {
            return true;
          }
          return (
            FIELD_META[field].label.toLowerCase().includes(needle) ||
            FIELD_DESCRIPTIONS[field].toLowerCase().includes(needle)
          );
        }),
    };
  }).filter(function hasEntries(category) {
    return category.entries.length > 0;
  });
}

export interface ConditionCatalogProps {
  ruleKind: RuleKind;
  onPick(field: ConditionField): void;
}

/**
 * The embedded catalog step: search + grouped field entries + lane notes.
 * Rendered inside the ConditionModal (spec 021 modal builder).
 */
export function ConditionCatalog({ ruleKind, onPick }: ConditionCatalogProps) {
  const [query, setQuery] = useState("");
  const categories = visibleCategories(ruleKind, query);
  const needle = query.trim().toLowerCase();
  const showDestinationNote =
    needle === "" || DESTINATION_NOTE.toLowerCase().includes(needle);
  const clockFieldsVisible = categories.some(function hasClock(category) {
    return category.entries.some(function isClock(field) {
      return CLOCK_ONLY_FIELDS.includes(field);
    });
  });
  const hasListContent = categories.length > 0 || showDestinationNote;

  // Raw wrapper because BlockStack 12.27 has no maxWidth prop; the catalog
  // should not stretch to the full modal width on large screens.
  const CATALOG_STYLE: CSSProperties = { maxWidth: "480px" };

  return (
    <div style={CATALOG_STYLE}>
      <BlockStack gap="200">
      <TextField
        label="Search conditions"
        labelHidden
        placeholder="Search conditions"
        autoComplete="off"
        value={query}
        onChange={function setSearch(next: string) {
          setQuery(next);
        }}
        clearButton
        onClearButtonClick={function clearSearch() {
          setQuery("");
        }}
      />
      <BlockStack gap="100">
        {categories.map(function renderCategory(category, categoryIndex) {
          return (
            <BlockStack key={category.title} gap="050">
              {categoryIndex > 0 ? <Divider /> : null}
              <Text as="span" variant="bodySm" tone="subdued" fontWeight="medium">
                {category.title}
              </Text>
              {category.entries.map(function renderEntry(field) {
                return (
                  <div
                    key={field}
                    role="button"
                    tabIndex={0}
                    className="sm-picker-entry"
                    onClick={function pick() {
                      onPick(field);
                    }}
                    onKeyDown={function pickOnKey(event) {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onPick(field);
                      }
                    }}
                  >
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd">
                        {FIELD_META[field].label}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {FIELD_DESCRIPTIONS[field]}
                      </Text>
                    </BlockStack>
                  </div>
                );
              })}
              {category.title === "Date and time" && clockFieldsVisible && ruleKind !== "CARRIER_RATE" ? (
                <Box paddingInline="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {CLOCK_NOTE}
                  </Text>
                </Box>
              ) : null}
            </BlockStack>
          );
        })}
        {showDestinationNote ? (
          <BlockStack gap="050">
            {categories.length > 0 ? <Divider /> : null}
            <Box paddingInline="200">
              <Text as="span" variant="bodySm" tone="subdued">
                {DESTINATION_NOTE}
              </Text>
            </Box>
          </BlockStack>
        ) : null}
        {!hasListContent ? (
          <Box padding="200">
            <Text as="span" variant="bodySm" tone="subdued">
              No conditions match your search.
            </Text>
          </Box>
        ) : null}
      </BlockStack>
      </BlockStack>
    </div>
  );
}

interface ConditionPickerProps {
  ruleKind: RuleKind;
  /** The "+ Add condition" footer button; cloned with the toggle handler. */
  activator: ReactElement<{ onClick?: () => void }>;
  onPick(field: ConditionField): void;
}

/** Legacy popover wrapper around the shared catalog (compatibility). */
export default function ConditionPicker({ ruleKind, activator, onPick }: ConditionPickerProps) {
  const [open, setOpen] = useState(false);

  // Polaris Popover does not wire the activator's click itself — clone the
  // passed-in button and inject the open/close toggle.
  const activatorWithToggle = cloneElement(activator, {
    onClick: function toggleOpen() {
      setOpen(function flip(current) {
        return !current;
      });
    },
  });

  return (
    <Popover
      active={open}
      activator={activatorWithToggle}
      onClose={function handleClose() {
        setOpen(false);
      }}
      preferredPosition="below"
      preferredAlignment="left"
      autofocusTarget="first-node"
    >
      <Popover.Pane>
        <Box padding="200">
          <ConditionCatalog
            ruleKind={ruleKind}
            onPick={function pick(field) {
              setOpen(false);
              onPick(field);
            }}
          />
        </Box>
      </Popover.Pane>
    </Popover>
  );
}
