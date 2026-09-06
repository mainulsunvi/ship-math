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
import { CARRIER_RATE_FORBIDDEN_FIELDS, FIELD_META } from "./ConditionRow";

/**
 * "+ Add condition" picker (Ref 2) — instead of appending a blank row of
 * dropdowns, the group footer button opens this popover of available
 * condition fields, grouped by category with a search box. Picking an entry
 * calls back with the field key; ConditionGroupEditor turns that into a
 * preselected row via ConditionRow's makeDefaultCondition, so picker-inserted
 * rows are identical to rows created by switching a row's field dropdown.
 *
 * destination_* fields are deliberately not offered: destination targeting is
 * zone-linked (spec 005) — the Basics section's zone picker narrows the
 * destination match, and the picker carries a note saying so. Fields the rule
 * kind cannot evaluate (§A3 lane matrix) are filtered exactly like the row's
 * own field dropdown.
 */

interface PickerCategory {
  title: string;
  fields: ConditionField[];
}

/** FIELD_META carries labels + operators but no grouping — group it locally. */
const FIELD_CATEGORIES: PickerCategory[] = [
  { title: "Cart", fields: ["subtotal", "quantity", "weight"] },
  { title: "Product", fields: ["sku", "vendor", "product_tag"] },
  { title: "Customer", fields: ["customer_tag", "logged_in"] },
];

/** Short helper text under each entry; also matched by the search filter. */
const FIELD_DESCRIPTIONS: Record<ConditionField, string> = {
  subtotal: "Cart subtotal amount",
  weight: "Cart total weight",
  quantity: "Total item quantity",
  product_tag: "Tags on cart items",
  sku: "Item SKU values",
  vendor: "Product vendor name",
  customer_tag: "Tags on the customer",
  logged_in: "Whether customer is signed in",
  destination_country: "Shipping destination country",
  destination_province: "Shipping destination province",
  destination_postal: "Shipping destination postal code",
};

const DESTINATION_NOTE =
  "Destination targeting is zone-linked — choose a zone in the Basics section instead of adding destination conditions.";

/**
 * Scrollable list container. Raw element because Box takes no style prop:
 * the two-line entries need a minimum popover width and a scroll ceiling so
 * the catalog never pushes the popover past the modal edge.
 */
const LIST_STYLE: CSSProperties = {
  minWidth: "320px",
  maxHeight: "320px",
  overflowY: "auto",
};

interface ConditionPickerProps {
  ruleKind: RuleKind;
  /** The "+ Add condition" footer button; cloned with the toggle handler. */
  activator: ReactElement<{ onClick?: () => void }>;
  onPick(field: ConditionField): void;
}

export default function ConditionPicker({ ruleKind, activator, onPick }: ConditionPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  function closePicker() {
    setOpen(false);
    setQuery("");
  }

  function handlePick(field: ConditionField) {
    closePicker();
    onPick(field);
  }

  const needle = query.trim().toLowerCase();
  const categories = FIELD_CATEGORIES.map(function mapCategory(category) {
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
  const showDestinationNote =
    needle === "" || DESTINATION_NOTE.toLowerCase().includes(needle);
  const hasListContent = categories.length > 0 || showDestinationNote;

  // Polaris Popover does not wire the activator's click itself — clone the
  // passed-in footer button and inject the open/close toggle so callers only
  // own the button's label and disabled state.
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
        closePicker();
      }}
      preferredPosition="below"
      preferredAlignment="left"
      autofocusTarget="first-node"
    >
      <Popover.Pane fixed>
        <Box padding="200">
          <TextField
            label="Search conditions"
            labelHidden
            placeholder="Search conditions…"
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
        </Box>
      </Popover.Pane>
      <Popover.Pane>
        <div style={LIST_STYLE}>
          <Box padding="100">
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
                            handlePick(field);
                          }}
                          onKeyDown={function pickOnKey(event) {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handlePick(field);
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
          </Box>
        </div>
      </Popover.Pane>
    </Popover>
  );
}
