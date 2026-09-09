import { useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  InlineStack,
  Select,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";
import type { PostalRule } from "../../lib/config-schema";
import { formatForDisplay, validatePostalRuleForCountries } from "../../lib/postal";
import PostalRuleEditor from "./PostalRuleEditor";
import SettingToggle from "../ui/SettingToggle";
import ModalSection from "../ui/ModalSection";

/**
 * Zone create/edit form (extracted from ZoneEditorModal 2026-09-10 so the
 * setup wizard can embed it INLINE in the Zones step — user request: zones
 * must not open a second popup stacked on the wizard modal; the rule form
 * already renders in the step). RuleForm conventions: the PARENT owns the
 * fetcher (busy/serverError/fieldErrors come in as props, onSubmit carries
 * the validated payload out), and the form renders its own action row.
 * ZoneEditorModal is now a thin Modal wrapper around this component, so the
 * Zones page and the wizard share one form with no drift (§A4).
 */

const WORLDWIDE = "*";

const COUNTRY_OPTIONS = [
  { label: "United States (US)", value: "US" },
  { label: "Canada (CA)", value: "CA" },
  { label: "United Kingdom (GB)", value: "GB" },
  { label: "Australia (AU)", value: "AU" },
  { label: "Germany (DE)", value: "DE" },
  { label: "France (FR)", value: "FR" },
  { label: "Netherlands (NL)", value: "NL" },
  { label: "Ireland (IE)", value: "IE" },
  { label: "Spain (ES)", value: "ES" },
  { label: "Italy (IT)", value: "IT" },
  { label: "Belgium (BE)", value: "BE" },
  { label: "Austria (AT)", value: "AT" },
  { label: "Switzerland (CH)", value: "CH" },
  { label: "Portugal (PT)", value: "PT" },
  { label: "Sweden (SE)", value: "SE" },
  { label: "Denmark (DK)", value: "DK" },
  { label: "Norway (NO)", value: "NO" },
  { label: "Finland (FI)", value: "FI" },
  { label: "Poland (PL)", value: "PL" },
  { label: "New Zealand (NZ)", value: "NZ" },
  { label: "Japan (JP)", value: "JP" },
  { label: "Mexico (MX)", value: "MX" },
  { label: "Brazil (BR)", value: "BR" },
  { label: "India (IN)", value: "IN" },
];

/** Curated province lists for the common single-country zones. */
const PROVINCE_OPTIONS: Record<string, Array<{ label: string; value: string }>> = {
  US: [
    { label: "Alabama (AL)", value: "AL" }, { label: "Alaska (AK)", value: "AK" },
    { label: "Arizona (AZ)", value: "AZ" }, { label: "Arkansas (AR)", value: "AR" },
    { label: "California (CA)", value: "CA" }, { label: "Colorado (CO)", value: "CO" },
    { label: "Connecticut (CT)", value: "CT" }, { label: "Delaware (DE)", value: "DE" },
    { label: "Florida (FL)", value: "FL" }, { label: "Georgia (GA)", value: "GA" },
    { label: "Hawaii (HI)", value: "HI" }, { label: "Idaho (ID)", value: "ID" },
    { label: "Illinois (IL)", value: "IL" }, { label: "Indiana (IN)", value: "IN" },
    { label: "Iowa (IA)", value: "IA" }, { label: "Kansas (KS)", value: "KS" },
    { label: "Kentucky (KY)", value: "KY" }, { label: "Louisiana (LA)", value: "LA" },
    { label: "Maine (ME)", value: "ME" }, { label: "Maryland (MD)", value: "MD" },
    { label: "Massachusetts (MA)", value: "MA" }, { label: "Michigan (MI)", value: "MI" },
    { label: "Minnesota (MN)", value: "MN" }, { label: "Mississippi (MS)", value: "MS" },
    { label: "Missouri (MO)", value: "MO" }, { label: "Montana (MT)", value: "MT" },
    { label: "Nebraska (NE)", value: "NE" }, { label: "Nevada (NV)", value: "NV" },
    { label: "New Hampshire (NH)", value: "NH" }, { label: "New Jersey (NJ)", value: "NJ" },
    { label: "New Mexico (NM)", value: "NM" }, { label: "New York (NY)", value: "NY" },
    { label: "North Carolina (NC)", value: "NC" }, { label: "North Dakota (ND)", value: "ND" },
    { label: "Ohio (OH)", value: "OH" }, { label: "Oklahoma (OK)", value: "OK" },
    { label: "Oregon (OR)", value: "OR" }, { label: "Pennsylvania (PA)", value: "PA" },
    { label: "Rhode Island (RI)", value: "RI" }, { label: "South Carolina (SC)", value: "SC" },
    { label: "South Dakota (SD)", value: "SD" }, { label: "Tennessee (TN)", value: "TN" },
    { label: "Texas (TX)", value: "TX" }, { label: "Utah (UT)", value: "UT" },
    { label: "Vermont (VT)", value: "VT" }, { label: "Virginia (VA)", value: "VA" },
    { label: "Washington (WA)", value: "WA" }, { label: "West Virginia (WV)", value: "WV" },
    { label: "Wisconsin (WI)", value: "WI" }, { label: "Wyoming (WY)", value: "WY" },
  ],
  CA: [
    { label: "Alberta (AB)", value: "AB" }, { label: "British Columbia (BC)", value: "BC" },
    { label: "Manitoba (MB)", value: "MB" }, { label: "New Brunswick (NB)", value: "NB" },
    { label: "Newfoundland and Labrador (NL)", value: "NL" }, { label: "Nova Scotia (NS)", value: "NS" },
    { label: "Northwest Territories (NT)", value: "NT" }, { label: "Nunavut (NU)", value: "NU" },
    { label: "Ontario (ON)", value: "ON" }, { label: "Prince Edward Island (PE)", value: "PE" },
    { label: "Quebec (QC)", value: "QC" }, { label: "Saskatchewan (SK)", value: "SK" },
    { label: "Yukon (YT)", value: "YT" },
  ],
  AU: [
    { label: "Australian Capital Territory (ACT)", value: "ACT" },
    { label: "New South Wales (NSW)", value: "NSW" },
    { label: "Northern Territory (NT)", value: "NT" },
    { label: "Queensland (QLD)", value: "QLD" },
    { label: "South Australia (SA)", value: "SA" },
    { label: "Tasmania (TAS)", value: "TAS" },
    { label: "Victoria (VIC)", value: "VIC" },
    { label: "Western Australia (WA)", value: "WA" },
  ],
};

/** Existing zone row as the form seeds itself for editing. */
export interface ZoneFormZone {
  id: string;
  name: string;
  enabled: boolean;
  countries: string[];
  provinces: string[];
  postalRules: PostalRule[];
}

/** Validated payload handed to the parent's onSubmit. */
export interface ZoneFormSubmitInput {
  name: string;
  enabled: boolean;
  countries: string[];
  provinces: string[];
  postalRules: PostalRule[];
}

export interface ZoneFormProps {
  /** Existing zone to edit; null/omitted = create. */
  zone?: ZoneFormZone | null;
  submitLabel: string;
  busy: boolean;
  /** Server reply message on failure (shown in the error banner). */
  serverError?: string | null;
  /** Server field errors keyed like the action's fieldErrors (name, postal). */
  fieldErrors?: Record<string, string> | null;
  /** Wizard draft mode: hides the enabled toggle behind the draft note. */
  draft?: boolean;
  onSubmit(input: ZoneFormSubmitInput): void;
  /** Renders a Cancel button when provided (modal close / inline collapse). */
  onCancel?(): void;
}

function makePostalRuleId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

interface TagPickerProps {
  label: string;
  helpText?: string;
  options: Array<{ label: string; value: string }>;
  selected: string[];
  disabled?: boolean;
  onAdd(value: string): void;
  onRemove(value: string): void;
}

/** Select-to-add picker rendering the selection as removable tags. */
function TagPicker({ label, helpText, options, selected, disabled, onAdd, onRemove }: TagPickerProps) {
  const remaining = options.filter(function notSelected(option) {
    return !selected.includes(option.value);
  });
  return (
    <BlockStack gap="200">
      {remaining.length > 0 ? (
        <Select
          label={label}
          helpText={helpText}
          options={[{ label: "Select…", value: "" }, ...remaining]}
          value=""
          onChange={function handleAdd(value: string) {
            if (value !== "") {
              onAdd(value);
            }
          }}
          disabled={disabled}
        />
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          {label}: every option is selected.
        </Text>
      )}
      {selected.length > 0 ? (
        <InlineStack gap="150" wrap>
          {selected.map(function renderTag(code) {
            const option = options.find(function match(entry) {
              return entry.value === code;
            });
            return (
              <Tag
                key={code}
                onRemove={
                  disabled
                    ? undefined
                    : function remove() {
                        onRemove(code);
                      }
                }
              >
                {option ? option.label : code}
              </Tag>
            );
          })}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}

interface FreeFormProvinceInputProps {
  provinces: string[];
  disabled?: boolean;
  onAdd(value: string): void;
  onRemove(value: string): void;
}

/** Province editor for countries without a curated list (comma separated codes). */
function FreeFormProvinceInput({ provinces, disabled, onAdd, onRemove }: FreeFormProvinceInputProps) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const parts = draft
      .split(",")
      .map(function clean(part) {
        return part.trim().toUpperCase();
      })
      .filter(function keep(part) {
        return part.length > 0;
      });
    if (parts.length === 0) {
      return;
    }
    parts.forEach(function each(part) {
      if (!provinces.includes(part)) {
        onAdd(part);
      }
    });
    setDraft("");
  }

  return (
    <BlockStack gap="150">
      <InlineStack gap="200" blockAlign="center">
        <TextField
          label="Province codes"
          placeholder="Comma separated codes, e.g. BY, NRW"
          autoComplete="off"
          value={draft}
          onChange={setDraft}
          disabled={disabled}
        />
        <Button icon={PlusIcon} onClick={addDraft} disabled={disabled || draft.trim().length === 0}>
          Add
        </Button>
      </InlineStack>
      {provinces.filter(function notWildcard(entry) {
        return entry !== WORLDWIDE;
      }).length > 0 ? (
        <InlineStack gap="150" wrap>
          {provinces
            .filter(function notWildcard(entry) {
              return entry !== WORLDWIDE;
            })
            .map(function renderTag(code) {
              return (
                <Tag
                  key={code}
                  onRemove={
                    disabled
                      ? undefined
                      : function remove() {
                          onRemove(code);
                        }
                  }
                >
                  {code}
                </Tag>
              );
            })}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}

export default function ZoneForm({
  zone,
  submitLabel,
  busy,
  serverError,
  fieldErrors,
  draft = false,
  onSubmit,
  onCancel,
}: ZoneFormProps) {
  const [name, setName] = useState(function initName() {
    return zone?.name ?? "";
  });
  const [enabled, setEnabled] = useState(function initEnabled() {
    return zone?.enabled ?? true;
  });
  const [countries, setCountries] = useState<string[]>(function initCountries() {
    return zone?.countries ?? [];
  });
  const [provinces, setProvinces] = useState<string[]>(function initProvinces() {
    return zone?.provinces ?? [WORLDWIDE];
  });
  const [postalRules, setPostalRules] = useState<PostalRule[]>(function initPostalRules() {
    return zone?.postalRules ?? [];
  });
  const [errors, setErrors] = useState<string[]>([]);

  const worldwide = countries.length === 1 && countries[0] === WORLDWIDE;
  const singleCountry = countries.length === 1 && countries[0] !== WORLDWIDE ? countries[0] : null;
  const provinceOptions = singleCountry ? (PROVINCE_OPTIONS[singleCountry] ?? []) : [];

  function handleWorldwide(next: boolean) {
    if (next) {
      setCountries([WORLDWIDE]);
      setProvinces([WORLDWIDE]);
      return;
    }
    setCountries([]);
    setProvinces([WORLDWIDE]);
  }

  function addCountry(value: string) {
    setCountries(function append(current) {
      const next = [...current, value];
      return Array.from(new Set(next));
    });
  }

  function removeCountry(value: string) {
    setCountries(function filterOut(current) {
      return current.filter(function keep(entry) {
        return entry !== value;
      });
    });
    // Country-specific provinces stop making sense without the single country.
    if (provinces[0] !== WORLDWIDE) {
      setProvinces([WORLDWIDE]);
    }
  }

  function addProvince(value: string) {
    setProvinces(function append(current) {
      const kept = current.filter(function dropWildcard(entry) {
        return entry !== WORLDWIDE;
      });
      return Array.from(new Set([...kept, value]));
    });
  }

  function removeProvince(value: string) {
    setProvinces(function filterOut(current) {
      return current.filter(function keep(entry) {
        return entry !== value;
      });
    });
  }

  function addPostalRule() {
    setPostalRules(function append(current) {
      return [...current, { id: makePostalRuleId(), mode: "EXACT", value: "" }];
    });
  }

  function updatePostalRule(id: string, next: PostalRule) {
    setPostalRules(function replace(current) {
      return current.map(function swap(entry) {
        return entry.id === id ? next : entry;
      });
    });
  }

  function removePostalRule(id: string) {
    setPostalRules(function filterOut(current) {
      return current.filter(function keep(entry) {
        return entry.id !== id;
      });
    });
  }

  function handleSubmit() {
    const collected: string[] = [];
    if (name.trim() === "") {
      collected.push("Zone name is required.");
    }
    if (countries.length === 0) {
      collected.push("Select at least one destination country (or worldwide).");
    }
    for (const rule of postalRules) {
      const message = validatePostalRuleForCountries(rule, countries);
      if (message !== null) {
        collected.push(`Postal rule “${formatForDisplay(rule.mode, rule)}”: ${message}`);
      }
    }
    if (collected.length > 0) {
      setErrors(collected);
      return;
    }
    setErrors([]);
    onSubmit({
      name: name.trim(),
      enabled,
      countries,
      provinces,
      postalRules,
    });
  }

  const nameError = fieldErrors ? fieldErrors.name : undefined;
  const postalError = fieldErrors ? fieldErrors.postal : undefined;
  const displayErrors = serverError ? [...errors, serverError] : errors;

  return (
    <BlockStack gap="400">
      {displayErrors.length > 0 ? (
        <Banner tone="critical" title="Fix Before Saving">
          <BlockStack gap="100">
            {displayErrors.map(function renderError(message, index) {
              return (
                <Text key={index} as="p" variant="bodySm">
                  {message}
                </Text>
              );
            })}
          </BlockStack>
        </Banner>
      ) : null}
      <ModalSection label="Identity" divider={false}>
        <TextField
          label="Zone name"
          autoComplete="off"
          value={name}
          onChange={setName}
          error={nameError}
          disabled={busy}
        />
        {draft ? (
          <Text as="span" variant="bodySm" tone="subdued">
            Draft zones turn on when you finish setup.
          </Text>
        ) : (
          <SettingToggle
            label="Zone enabled"
            helpText="Disabled zones are skipped during matching and left out of new mirror syncs."
            enabled={enabled}
            disabled={busy}
            onChange={setEnabled}
          />
        )}
      </ModalSection>
      <ModalSection
        label="Targeting"
        help="Decides which destinations the zone covers. Rules linked to this zone only apply inside it."
      >
        <BlockStack gap="200">
          <SettingToggle
            label="Ship to every country (worldwide)"
            helpText="The zone matches every destination. Country and province pickers are hidden while this is on."
            enabled={worldwide}
            disabled={busy}
            onChange={handleWorldwide}
          />
          {!worldwide ? (
            <TagPicker
              label="Countries"
              helpText="Common destinations. Pick as many as you need."
              options={COUNTRY_OPTIONS}
              selected={countries}
              disabled={busy}
              onAdd={addCountry}
              onRemove={removeCountry}
            />
          ) : null}
        </BlockStack>
        {singleCountry !== null ? (
          <BlockStack gap="200">
            <SettingToggle
              label="Any province or state"
              helpText="The zone covers the whole selected country. Turn off to pick individual provinces."
              enabled={provinces[0] === WORLDWIDE}
              disabled={busy}
              onChange={function handleAnyProvince(next: boolean) {
                setProvinces(next ? [WORLDWIDE] : []);
              }}
            />
            {provinces[0] !== WORLDWIDE ? (
              provinceOptions.length > 0 ? (
                <TagPicker
                  label="Provinces / states"
                  helpText="Leave empty (with “Any province or state” off) to match every province code."
                  options={provinceOptions}
                  selected={provinces}
                  disabled={busy}
                  onAdd={addProvince}
                  onRemove={removeProvince}
                />
              ) : (
                <FreeFormProvinceInput
                  provinces={provinces}
                  disabled={busy}
                  onAdd={addProvince}
                  onRemove={removeProvince}
                />
              )
            ) : null}
          </BlockStack>
        ) : null}
      </ModalSection>
      <ModalSection
        label="Postal Rules"
        help="Narrow the zone to specific postal codes with exact, prefix, range, or partial matching."
      >
        {postalError ? (
          <Text as="span" variant="bodySm" tone="critical">
            {postalError}
          </Text>
        ) : null}
        {worldwide ? (
          <Text as="span" variant="bodySm" tone="subdued">
            Select a single country to unlock partial-code matching (UK/CA) and province narrowing.
          </Text>
        ) : null}
        {postalRules.length === 0 ? (
          <Text as="span" variant="bodySm" tone="subdued">
            No postal rules yet. The zone matches every postal code inside its countries.
          </Text>
        ) : null}
        <BlockStack gap="200">
          {postalRules.map(function renderRule(rule) {
            return (
              <PostalRuleEditor
                key={rule.id}
                rule={rule}
                countries={countries}
                disabled={busy}
                error={validatePostalRuleForCountries(rule, countries) ?? undefined}
                onChange={function change(next: PostalRule) {
                  updatePostalRule(rule.id, next);
                }}
                onRemove={function remove() {
                  removePostalRule(rule.id);
                }}
              />
            );
          })}
        </BlockStack>
        <Box>
          <Button icon={PlusIcon} onClick={addPostalRule} disabled={busy}>
            Add postal rule
          </Button>
        </Box>
      </ModalSection>
      <Box borderBlockStartWidth="025" borderColor="border" paddingBlockStart="400">
        <InlineStack gap="300" align="end">
          {onCancel ? (
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          <Button variant="primary" onClick={handleSubmit} loading={busy}>
            {submitLabel}
          </Button>
        </InlineStack>
      </Box>
    </BlockStack>
  );
}
