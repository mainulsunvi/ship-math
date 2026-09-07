import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma, { getOrCreateShop } from "../db.server";
import {
  CUSTOMERS_QUERY,
  DELIVERY_PROFILES_QUERY,
  LOCATIONS_QUERY,
  SHOP_QUERY,
} from "../graphql/directory";
import {
  parseSimPayload,
  simulateRun,
  type SimInput,
  type SimulationResult,
} from "../lib/simulate";
import ShipMathPage from "../components/global/ShipMathPage";
import AddressForm, {
  countryName,
  EMPTY_ADDRESS,
  type AddressDraft,
} from "../components/simulator/AddressForm";
import CheckoutSummary, { type SimLineDraft } from "../components/simulator/CheckoutSummary";
import TraceResult from "../components/simulator/TraceResult";
import {
  buildCheckoutOptions,
  storeRatesFromZones,
  type StoreRateOption,
} from "../lib/store-rates";

/**
 * Rate simulator page (spec 008): pick real products, a full destination, a
 * pickup location, a customer, a Shopify shipping zone shortcut, and the
 * subset of rules to run — then see a checkout-style summary on the right
 * with the rates the two production lanes would return.
 */

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

interface CustomerOption {
  id: string;
  displayName: string;
  tags: string[];
}

interface LocationOption {
  id: string;
  name: string;
}

interface ShopifyZoneOption {
  id: string;
  name: string;
  firstCountryCode: string | null;
}

interface ShopifyZonesPayload {
  zones: ShopifyZoneOption[];
  storeRates: StoreRateOption[];
  /** Why the store's shipping setup could not be read, when it failed. */
  error: string | null;
}

interface RuleOption {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  priority: number;
}

/** Guests and synthetic shoppers for testing tag conditions without CRM data. */
const DUMMY_CUSTOMERS = [
  { id: "guest", label: "Guest (not logged in)" },
  { id: "vip", label: "VIP Tester — dummy, tagged VIP" },
  { id: "wholesale", label: "Wholesale Tester — dummy, tagged wholesale" },
] as const;

const DUMMY_TAGS: Record<string, string[]> = {
  guest: [],
  vip: ["VIP"],
  wholesale: ["wholesale"],
};

async function fetchCustomers(admin: AdminContext): Promise<CustomerOption[]> {
  try {
    const response = await admin.graphql(CUSTOMERS_QUERY);
    const body = (await response.json()) as {
      data?: { customers?: { nodes?: Array<{ id: string; displayName: string; tags: string[] }> } };
    };
    return (body.data?.customers?.nodes ?? []).map(function option(node) {
      return { id: node.id, displayName: node.displayName, tags: node.tags ?? [] };
    });
  } catch {
    return []; // scope/permission problem → dummy customers still work
  }
}

async function fetchLocations(admin: AdminContext): Promise<LocationOption[]> {
  try {
    const response = await admin.graphql(LOCATIONS_QUERY);
    const body = (await response.json()) as {
      data?: { locations?: { nodes?: Array<{ id: string; name: string; isActive: boolean }> } };
    };
    return (body.data?.locations?.nodes ?? [])
      .filter(function active(node) {
        return node.isActive !== false;
      })
      .map(function option(node) {
        return { id: node.id, name: node.name };
      });
  } catch {
    return [];
  }
}

async function fetchCurrency(admin: AdminContext): Promise<string> {
  try {
    const response = await admin.graphql(SHOP_QUERY);
    const body = (await response.json()) as {
      data?: { shop?: { currencyCode?: string } };
    };
    return body.data?.shop?.currencyCode ?? "USD";
  } catch {
    return "USD";
  }
}

/**
 * Shopify's own shipping setup (GraphQL deliveryProfiles): the destination
 * shortcut for the zone picker AND the store's own shipping methods
 * (Standard free / Express $15 …) that share checkout's delivery group with
 * ShipMath's rates. The same zone can be linked from several profiles, so
 * zone options and method definitions are de-duplicated by id.
 */
function zoneOptionsFromZones(zones: unknown[]): ShopifyZoneOption[] {
  const options: ShopifyZoneOption[] = [];
  const seen = new Set<string>();
  for (const raw of zones) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const zone = raw as { id?: unknown; name?: unknown; countries?: unknown };
    if (zone.id === undefined || zone.id === null) {
      continue;
    }
    const id = String(zone.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const countries = Array.isArray(zone.countries) ? zone.countries : [];
    const firstCountryCode =
      countries
        .map(function code(country) {
          return ((country as { code?: { countryCode?: unknown } }).code ?? {})
            .countryCode;
        })
        .find(function twoLetter(code): code is string {
          return typeof code === "string" && code.length === 2;
        }) ?? null;
    options.push({
      id,
      name: typeof zone.name === "string" ? zone.name : `Zone ${id}`,
      firstCountryCode,
    });
  }
  return options;
}

async function fetchDeliveryZones(admin: AdminContext): Promise<ShopifyZonesPayload> {
  // The whole delivery-profile tree in one query costs more than Shopify's
  // 1000-point single-query limit, so this pages small slices: 2 profiles
  // per request with capped inner lists (20 zones, 20 methods each) — every
  // request stays far under the limit — and the loop walks every page.
  const MAX_PROFILE_PAGES = 8; // 2 profiles per page → up to 16 profiles
  const zones: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < MAX_PROFILE_PAGES; page += 1) {
    const response = await admin.graphql(DELIVERY_PROFILES_QUERY, {
      variables: { after: cursor },
    });
    if (!response.ok) {
      return {
        zones: [],
        storeRates: [],
        error: `Shopify answered HTTP ${response.status} for the shipping query.`,
      };
    }
      const body = (await response.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        deliveryProfiles?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          nodes?: Array<{
            profileLocationGroups?: Array<{
              locationGroupZones?: {
                edges?: Array<{
                  node?: {
                    zone?: Record<string, unknown>;
                    methodDefinitions?: unknown;
                  };
                }>;
              };
            }>;
          }>;
        };
      };
    };
    // Surface GraphQL errors (e.g. missing shipping scope) instead of
    // failing silently — the merchant needs to see WHY the list is empty.
    if (body.errors && body.errors.length > 0) {
      return {
        zones: [],
        storeRates: [],
        error: body.errors
          .map(function message(error) {
            return error.message ?? "Unknown error";
          })
          .join("; "),
      };
    }
    // Flatten profile → location group → zone; the method definitions hang
    // off the location-group zone, so attach them to the zone node the
    // parsers consume.
    for (const profile of body.data?.deliveryProfiles?.nodes ?? []) {
      for (const group of profile.profileLocationGroups ?? []) {
        for (const edge of group.locationGroupZones?.edges ?? []) {
          const node = edge.node;
          if (!node?.zone || typeof node.zone !== "object") {
            continue;
          }
          zones.push({ ...node.zone, methodDefinitions: node.methodDefinitions });
        }
      }
    }
    const pageInfo = body.data?.deliveryProfiles?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      break;
    }
    cursor = pageInfo.endCursor;
    }
    return { zones: zoneOptionsFromZones(zones), storeRates: storeRatesFromZones(zones), error: null };
  } catch (error) {
    // unavailable → the manual destination form still works, and the summary
    // simply shows only ShipMath's own rates — but the reason is surfaced.
    return {
      zones: [],
      storeRates: [],
      error:
        error instanceof Error
          ? error.message
          : "The shipping query failed before Shopify answered.",
    };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const [customers, locations, currency, deliveryZones] = await Promise.all([
    fetchCustomers(admin),
    fetchLocations(admin),
    fetchCurrency(admin),
    fetchDeliveryZones(admin),
  ]);
  const rules = await prisma.shippingRule.findMany({
    where: { shopId: shop.id },
    orderBy: { priority: "asc" },
    select: { id: true, name: true, kind: true, enabled: true, priority: true },
  });

  return json({
    customers,
    locations,
    currency,
    shippingZones: deliveryZones.zones,
    storeRates: deliveryZones.storeRates,
    storeRatesError: deliveryZones.error,
    rules: rules.map(function row(rule) {
      return {
        id: rule.id,
        name: rule.name,
        kind: rule.kind,
        enabled: rule.enabled,
        priority: rule.priority,
      } satisfies RuleOption;
    }),
    testMode: shop.testMode,
    evaluationMode: shop.evaluationMode,
  });
}

interface SimReply {
  ok?: boolean;
  message?: string;
  result?: SimulationResult;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "simulate") {
    const parsed = parseSimPayload(String(formData.get("payload") ?? ""));
    if (!parsed.ok) {
      return json<SimReply>({ ok: false, message: parsed.message }, { status: 422 });
    }
    const result = await simulateRun(shop.shopDomain, parsed.input);
    return json<SimReply>({ ok: true, result });
  }
  return json<SimReply>({ ok: false, message: `Unknown intent: ${intent}` }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Product picker mapping
// ---------------------------------------------------------------------------

interface PickedVariant {
  id?: string | number;
  title?: string;
  price?: string | number;
  weight?: string | number | null;
  weightUnit?: string | null;
  sku?: string | null;
}

interface PickedProduct {
  id?: string | number;
  title?: string;
  vendor?: string | null;
  images?: Array<{ originalSrc?: string | null }>;
  variants: PickedVariant[];
}

const UNIT_TO_GRAMS: Record<string, number> = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  POUNDS: 453.592,
  OUNCES: 28.3495,
};

function weightInGrams(variant: PickedVariant): number {
  const raw =
    typeof variant.weight === "number"
      ? variant.weight
      : Number.parseFloat(String(variant.weight ?? ""));
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  const unit = (variant.weightUnit ?? "GRAMS").toUpperCase();
  return Math.round(raw * (UNIT_TO_GRAMS[unit] ?? 1));
}

function normalizePrice(price: unknown): string {
  const raw = String(price ?? "").replace(/[^0-9.]/g, "");
  return /^\d+(\.\d+)?$/.test(raw) ? raw : "0.00";
}

let pickCounter = 0;

function pickedToDrafts(products: PickedProduct[]): SimLineDraft[] {
  const drafts: SimLineDraft[] = [];
  for (const product of products) {
    const variants =
      product.variants && product.variants.length > 0
        ? product.variants
        : [{ id: `${String(product.id ?? "p")}-default`, title: "", price: "0.00" }];
    for (const variant of variants) {
      pickCounter += 1;
      const variantTitle = variant.title && variant.title !== "Default Title" ? variant.title : undefined;
      drafts.push({
        key: `${String(variant.id ?? product.id ?? "p")}-${pickCounter}`,
        title: product.title ?? "Untitled product",
        ...(variantTitle ? { variantTitle } : {}),
        ...(product.images?.[0]?.originalSrc ? { image: product.images[0].originalSrc as string } : {}),
        price: normalizePrice(variant.price),
        weightGrams: String(weightInGrams(variant)),
        quantity: "1",
        sku: variant.sku ?? "",
        vendor: product.vendor ?? "",
        productTags: "",
      });
    }
  }
  return drafts;
}

function tagsToList(raw: string): string[] {
  return raw
    .split(",")
    .map(function trim(tag) {
      return tag.trim();
    })
    .filter(function keep(tag) {
      return tag.length > 0;
    });
}

const MONEY_PATTERN = /^\d+(\.\d+)?$/;
const WHOLE_PATTERN = /^\d+$/;

function blankLine(): SimLineDraft {
  pickCounter += 1;
  return {
    key: `custom-${pickCounter}`,
    title: "",
    price: "",
    weightGrams: "",
    quantity: "1",
    sku: "",
    vendor: "",
    productTags: "",
  };
}

function defaultLines(): SimLineDraft[] {
  return [
    {
      key: "starter-1",
      title: "T-shirt",
      price: "15.00",
      weightGrams: "500",
      quantity: "2",
      sku: "",
      vendor: "",
      productTags: "",
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SimulatorPage() {
  const loaderData = useLoaderData<typeof loader>();
  const simFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [lines, setLines] = useState<SimLineDraft[]>(defaultLines);
  // Start in the first store shipping zone's country so the summary shows
  // that zone's methods (Standard/Express …) without a manual detour.
  const [address, setAddress] = useState<AddressDraft>(function initial() {
    const firstCountry = loaderData.shippingZones[0]?.firstCountryCode;
    return firstCountry ? { ...EMPTY_ADDRESS, country: firstCountry } : { ...EMPTY_ADDRESS };
  });
  const [locationId, setLocationId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [customerId, setCustomerId] = useState("guest");
  const [customerTags, setCustomerTags] = useState("");
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[] | null>(null);
  const [selectedRateCode, setSelectedRateCode] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const simBusy = simFetcher.state !== "idle";
  const simReply = simFetcher.data as SimReply | undefined;
  const result = simReply?.ok === true ? simReply.result : undefined;
  const runError = simReply?.ok === false ? simReply.message : undefined;

  const allRuleIds = loaderData.rules.map(function id(rule) {
    return rule.id;
  });
  const effectiveSelectedRuleIds = selectedRuleIds ?? allRuleIds;
  const allRulesSelected = effectiveSelectedRuleIds.length === allRuleIds.length;

  const pickedCustomer = loaderData.customers.find(function match(customer) {
    return customer.id === customerId;
  });  const locationName =
    loaderData.locations.find(function match(location) {
      return location.id === locationId;
    })?.name ?? null;

  function updateLine(key: string, patch: Partial<SimLineDraft>) {
    setLines(
      lines.map(function edit(line) {
        return line.key === key ? { ...line, ...patch } : line;
      }),
    );
  }

  function removeLine(key: string) {
    setLines(
      lines.filter(function keep(line) {
        return line.key !== key;
      }),
    );
  }

  async function pickProducts() {
    // Modern App Bridge picker: real catalog products with variant prices,
    // weights, and SKUs. Resolves undefined when the merchant cancels.
    try {
      const selection = (await shopify.resourcePicker({
        type: "product",
        multiple: true,
      })) as unknown as PickedProduct[] | undefined;
      if (!selection) {
        return;
      }
      const drafts = pickedToDrafts(selection);
      if (drafts.length > 0) {
        setLines(function merge(current) {
          const existing = new Set(
            current.map(function key(line) {
              return line.key;
            }),
          );
          return [...current, ...drafts.filter(function fresh(draft) {
            return !existing.has(draft.key);
          })];
        });
      }
    } catch {
      // Picker unavailable (e.g. scope not granted yet) — custom lines still work.
    }
  }

  function pickCustomer(next: string) {
    setCustomerId(next);
    // Tag the run from the selected shopper; the merchant can edit after.
    if (next === "guest") {
      setCustomerTags("");
    } else if (DUMMY_TAGS[next]) {
      setCustomerTags(DUMMY_TAGS[next].join(", "));
    } else {
      setCustomerTags((pickedCustomer?.tags ?? []).join(", "));
    }
  }

  function pickShippingZone(next: string) {
    setZoneId(next);
    const zone = loaderData.shippingZones.find(function match(entry) {
      return entry.id === next;
    });
    if (zone?.firstCountryCode) {
      setAddress(function fill(current) {
        return { ...current, country: zone.firstCountryCode as string, province: "" };
      });
    }
  }

  function toggleRule(id: string, checked: boolean) {
    setSelectedRuleIds(function toggle(current) {
      const base = current ?? allRuleIds;
      const next = checked ? [...base, id] : base.filter(function keep(existing) {
        return existing !== id;
      });
      return next;
    });
  }

  function selectAllRules(next: boolean) {
    setSelectedRuleIds(next ? null : []);
  }

  function run() {
    const usable = lines.filter(function keep(line) {
      return line.title.trim() !== "" || line.sku.trim() !== "" || line.price.trim() !== "";
    });
    if (usable.length === 0) {
      setValidationError("Add at least one product or cart line before running.");
      return;
    }
    for (const line of usable) {
      if (line.title.trim() === "") {
        setValidationError("Every line needs a title.");
        return;
      }
      if (!MONEY_PATTERN.test(line.price.trim())) {
        setValidationError(`"${line.title}" needs a price like 15.00 (no currency symbol).`);
        return;
      }
      const weight = line.weightGrams.trim() === "" ? "0" : line.weightGrams.trim();
      if (!WHOLE_PATTERN.test(weight)) {
        setValidationError(`"${line.title}" needs a whole-number weight in grams.`);
        return;
      }
      const quantity = line.quantity.trim() === "" ? "1" : line.quantity.trim();
      if (!WHOLE_PATTERN.test(quantity) || Number.parseInt(quantity, 10) < 1) {
        setValidationError(`"${line.title}" needs a quantity of at least 1.`);
        return;
      }
    }

    setValidationError(null);
    setSelectedRateCode(null);
    const input: SimInput = {
      lines: usable.map(function toLine(line) {
        return {
          title: line.title.trim(),
          price: line.price.trim(),
          weightGrams: Number.parseInt(
            line.weightGrams.trim() === "" ? "0" : line.weightGrams.trim(),
            10,
          ),
          quantity: Number.parseInt(
            line.quantity.trim() === "" ? "1" : line.quantity.trim(),
            10,
          ),
          ...(line.sku.trim() === "" ? {} : { sku: line.sku.trim() }),
          ...(line.vendor.trim() === "" ? {} : { vendor: line.vendor.trim() }),
          ...(tagsToList(line.productTags).length > 0
            ? { productTags: tagsToList(line.productTags) }
            : {}),
        };
      }),
      destination: {
        country: address.country,
        ...(address.province.trim() === "" ? { province: null } : { province: address.province.trim() }),
        ...(address.zip.trim() === "" ? { postal: null } : { postal: address.zip.trim() }),
      },
      loggedIn: customerId !== "guest",
      customerTags: tagsToList(customerTags),
      ...(allRulesSelected ? {} : { onlyRuleIds: effectiveSelectedRuleIds }),
      ...(locationId === "" ? {} : { locationId }),
    };
    simFetcher.submit({ intent: "simulate", payload: JSON.stringify(input) }, { method: "post" });
  }

  // The combined rates box: the store's own methods for this destination
  // plus ShipMath's rates in ONE list, with the Function lane's ops applied
  // — and every hide/rename/move recorded for the summary to display.
  const checkoutPreview = useMemo(
    function combined() {
      if (!result) {
        return null;
      }
      let subtotal = 0;
      let weightGrams = 0;
      for (const line of lines) {
        const quantity = Number.parseInt(line.quantity, 10) || 1;
        const price = Number.parseFloat(line.price) || 0;
        subtotal += price * quantity;
        weightGrams += (Number.parseInt(line.weightGrams, 10) || 0) * quantity;
      }
      return buildCheckoutOptions({
        storeRates: loaderData.storeRates,
        cart: {
          country: address.country,
          province: address.province.trim() === "" ? null : address.province.trim(),
          subtotal,
          weightGrams,
        },
        functionOperations: result.functionOperations,
        carrierRates: result.rates,
      });
    },
    [result, lines, address.country, address.province, loaderData.storeRates],
  );

  const shipToLines: string[] = [];
  const fullName = [address.firstName.trim(), address.lastName.trim()]
    .filter(function keep(part) {
      return part.length > 0;
    })
    .join(" ");
  if (fullName) {
    shipToLines.push(fullName);
  }
  if (address.address1.trim()) {
    shipToLines.push(address.address1.trim());
  }
  if (address.address2.trim()) {
    shipToLines.push(address.address2.trim());
  }
  const cityLine = [
    address.city.trim(),
    [address.province.trim(), address.zip.trim()].filter(function keep(part) {
      return part.length > 0;
    }).join(" "),
  ]
    .filter(function keep(part) {
      return part.length > 0;
    })
    .join(", ");
  if (cityLine) {
    shipToLines.push(cityLine);
  }
  shipToLines.push(countryName(address.country));

  return (
    <ShipMathPage
      title="Rate simulator"
      subtitle="Run your rules on a pretend cart — same engine as checkout"
      primaryAction={{ content: "Run simulation", onAction: run, loading: simBusy }}
    >
      {/* Polaris Layout renders align-items:flex-start, which collapses each
          column to its own content height — position:sticky then has no room
          to travel inside its parent and silently does nothing. This custom
          row stretches both columns to the full row height, so the sticky
          order summary on the right actually sticks while the left scrolls. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "stretch",
          gap: "1rem",
        }}
      >
        <div style={{ flex: "1 1 30rem", minWidth: 0 }}>
          <BlockStack gap="400">
            {loaderData.testMode ? (
              <Banner tone="info" title="Test mode is ON">
                <Text as="p" variant="bodySm">
                  The preview is faithful; live checkout applies nothing while
                  test mode stays on.
                </Text>
              </Banner>
            ) : null}
            {loaderData.storeRatesError ? (
              <Banner tone="warning" title="Store shipping methods unavailable">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    {loaderData.storeRatesError}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    The store&apos;s own methods (like Standard and Express)
                    cannot be listed right now, so the rates box shows only
                    rule-based rates. If the message above mentions access or
                    scopes, reinstall the app or rerun shopify app dev so the
                    shipping scopes are granted, then reload this page.
                  </Text>
                </BlockStack>
              </Banner>
            ) : null}
            {validationError ? (
              <Banner tone="critical">{validationError}</Banner>
            ) : null}
            {runError ? (
              <Banner tone="critical" title="The simulation failed">
                {runError}
              </Banner>
            ) : null}

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Products
                  </Text>
                  <InlineStack gap="200">
                    <Button size="slim" onClick={function open() {
                      void pickProducts();
                    }} disabled={simBusy}>
                      Pick products
                    </Button>
                    <Button size="slim" onClick={function add() {
                      setLines(function append(current) {
                        return [...current, blankLine()];
                      });
                    }} disabled={simBusy}>
                      Add custom line
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pick from your catalog (variants come in with real prices,
                  weights, and SKUs) or type a custom line.
                </Text>

                {lines.map(function renderLine(line, index) {
                  return (
                    <BlockStack gap="200" key={line.key}>
                      {index > 0 ? <Divider /> : null}
                      <InlineStack gap="300" blockAlign="center">
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
                        <div style={{ flexGrow: 1 }}>
                          <TextField
                            label="Title"
                            labelHidden
                            placeholder="Product title"
                            value={line.title}
                            onChange={function setTitle(value) {
                              updateLine(line.key, { title: value });
                            }}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                        <div style={{ width: "7rem" }}>
                          <TextField
                            label="Price"
                            labelHidden
                            placeholder="Price"
                            prefix={loaderData.currency === "USD" ? "$" : undefined}
                            value={line.price}
                            onChange={function setPrice(value) {
                              updateLine(line.key, { price: value });
                            }}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                        <div style={{ width: "6rem" }}>
                          <TextField
                            label="Weight in grams"
                            labelHidden
                            placeholder="Grams"
                            value={line.weightGrams}
                            onChange={function setWeight(value) {
                              updateLine(line.key, { weightGrams: value });
                            }}
                            type="number"
                            min={0}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                        <div style={{ width: "4.5rem" }}>
                          <TextField
                            label="Quantity"
                            labelHidden
                            placeholder="Qty"
                            value={line.quantity}
                            onChange={function setQuantity(value) {
                              updateLine(line.key, { quantity: value });
                            }}
                            type="number"
                            min={1}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                        <Button
                          tone="critical"
                          variant="tertiary"
                          onClick={function remove() {
                            removeLine(line.key);
                          }}
                          disabled={simBusy}
                          accessibilityLabel={`Remove ${line.title || "line"}`}
                        >
                          ✕
                        </Button>
                      </InlineStack>
                      <InlineStack gap="300">
                        <div style={{ flexGrow: 1 }}>
                          <TextField
                            label="SKU"
                            labelHidden
                            placeholder="SKU (optional)"
                            value={line.sku}
                            onChange={function setSku(value) {
                              updateLine(line.key, { sku: value });
                            }}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                        <div style={{ flexGrow: 1 }}>
                          <TextField
                            label="Vendor"
                            labelHidden
                            placeholder="Vendor (optional)"
                            value={line.vendor}
                            onChange={function setVendor(value) {
                              updateLine(line.key, { vendor: value });
                            }}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                        <div style={{ flexGrow: 2 }}>
                          <TextField
                            label="Product tags"
                            labelHidden
                            placeholder="Product tags, comma separated (optional)"
                            value={line.productTags}
                            onChange={function setTags(value) {
                              updateLine(line.key, { productTags: value });
                            }}
                            autoComplete="off"
                            disabled={simBusy}
                          />
                        </div>
                      </InlineStack>
                    </BlockStack>
                  );
                })}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Destination
                </Text>
                <AddressForm value={address} disabled={simBusy} onChange={setAddress} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Location and customer
                </Text>
                <Select
                  label="Pickup location"
                  options={[
                    { label: "No pickup location", value: "" },
                    ...loaderData.locations.map(function option(location) {
                      return { label: location.name, value: location.id };
                    }),
                  ]}
                  value={locationId}
                  onChange={function setLocation(next) {
                    setLocationId(next);
                  }}
                  helpText={
                    loaderData.locations.length === 0
                      ? "No active locations found — pickup rules cannot be previewed with a location."
                      : undefined
                  }
                  disabled={simBusy}
                />
                <Select
                  label="Customer"
                  options={[
                    ...DUMMY_CUSTOMERS.map(function option(entry) {
                      return { label: entry.label, value: entry.id };
                    }),
                    ...loaderData.customers.map(function option(customer) {
                      return { label: `${customer.displayName} (real customer)`, value: customer.id };
                    }),
                  ]}
                  value={customerId === "guest" || DUMMY_TAGS[customerId] ? customerId : customerId}
                  onChange={function setCustomer(next) {
                    pickCustomer(next);
                  }}
                  helpText={
                    loaderData.customers.length === 0
                      ? "Real customers appear here once the app has read access to them."
                      : "Selecting a customer fills their tags below; edit them to test tag rules."
                  }
                  disabled={simBusy}
                />
                <TextField
                  label="Customer tags"
                  value={customerTags}
                  onChange={function setTags(value) {
                    setCustomerTags(value);
                  }}
                  placeholder="Comma separated, e.g. VIP, wholesale"
                  autoComplete="off"
                  disabled={simBusy}
                />
                <Select
                  label="Shopify shipping zone (destination shortcut)"
                  options={[
                    { label: "None — set the destination manually", value: "" },
                    ...loaderData.shippingZones.map(function option(zone) {
                      return { label: zone.name, value: zone.id };
                    }),
                  ]}
                  value={zoneId}
                  onChange={function setZone(next) {
                    pickShippingZone(next);
                  }}
                  helpText={
                    loaderData.shippingZones.length === 0
                      ? "Shopify shipping zones could not be loaded — the manual form above always works."
                      : "Picking a zone fills the destination country with the zone's first country."
                  }
                  disabled={simBusy}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Rules
                  </Text>
                  <InlineStack gap="200">
                    <Button
                      size="slim"
                      onClick={function all() {
                        selectAllRules(true);
                      }}
                      disabled={simBusy || allRulesSelected}
                    >
                      All
                    </Button>
                    <Button
                      size="slim"
                      onClick={function none() {
                        selectAllRules(false);
                      }}
                      disabled={simBusy || effectiveSelectedRuleIds.length === 0}
                    >
                      None
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {allRulesSelected
                    ? `Every rule runs (${allRuleIds.length}). Untick rules to test a combined subset.`
                    : `${effectiveSelectedRuleIds.length} of ${allRuleIds.length} rules will run.`}
                </Text>
                {loaderData.rules.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No rules yet — create rules on the Dashboard first.
                  </Text>
                ) : (
                  <BlockStack gap="150">
                    {loaderData.rules.map(function renderRule(rule) {
                      return (
                        <Checkbox
                          key={rule.id}
                          label={`${rule.priority}. ${rule.name}`}
                          helpText={`${rule.kind}${rule.enabled ? "" : " · disabled (disabled rules never run)"}`}
                          checked={effectiveSelectedRuleIds.includes(rule.id)}
                          onChange={function toggle(checked) {
                            toggleRule(rule.id, checked);
                          }}
                          disabled={simBusy || !rule.enabled}
                        />
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </div>

        <div style={{ flex: "1 1 24rem", minWidth: 0 }}>
          <div style={{ position: "sticky", top: "1rem" }}>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Order summary
                  </Text>
                  <CheckoutSummary
                    lines={lines}
                    result={result}
                    options={checkoutPreview ? checkoutPreview.options : []}
                    customizations={checkoutPreview ? checkoutPreview.customizations : []}
                    currency={loaderData.currency}
                    shipToLines={shipToLines}
                    pickupLocationName={locationName}
                    selectedRateCode={selectedRateCode}
                    onSelectRate={function pick(code) {
                      setSelectedRateCode(code);
                    }}
                  />
                </BlockStack>
              </Card>

              {result ? (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Rule trace
                    </Text>
                    <TraceResult result={result} />
                  </BlockStack>
                </Card>
              ) : null}
            </BlockStack>
          </div>
        </div>
      </div>
    </ShipMathPage>
  );
}
