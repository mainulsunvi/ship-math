import { BlockStack, InlineStack, Select, TextField } from "@shopify/polaris";

/**
 * Checkout-like shipping address form for the simulator page (spec 008).
 * Only country/province/postal feed the rule engine; the rest is presented in
 * the order summary exactly as checkout would show it.
 */

export interface AddressDraft {
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  country: string;
  province: string;
  zip: string;
  phone: string;
}

export const EMPTY_ADDRESS: AddressDraft = {
  firstName: "",
  lastName: "",
  address1: "",
  address2: "",
  city: "",
  country: "US",
  province: "",
  zip: "",
  phone: "",
};

interface CountryOption {
  label: string;
  value: string;
}

/** Common storefront countries — ISO-2 codes feed zone matching. */
export const COUNTRIES: CountryOption[] = [
  { label: "United States", value: "US" },
  { label: "Canada", value: "CA" },
  { label: "United Kingdom", value: "GB" },
  { label: "Australia", value: "AU" },
  { label: "Germany", value: "DE" },
  { label: "France", value: "FR" },
  { label: "Netherlands", value: "NL" },
  { label: "Spain", value: "ES" },
  { label: "Italy", value: "IT" },
  { label: "Ireland", value: "IE" },
  { label: "New Zealand", value: "NZ" },
  { label: "Japan", value: "JP" },
  { label: "Singapore", value: "SG" },
  { label: "United Arab Emirates", value: "AE" },
  { label: "India", value: "IN" },
  { label: "Brazil", value: "BR" },
  { label: "Mexico", value: "MX" },
  { label: "Sweden", value: "SE" },
  { label: "Norway", value: "NO" },
  { label: "Denmark", value: "DK" },
  { label: "Finland", value: "FI" },
  { label: "Poland", value: "PL" },
  { label: "Portugal", value: "PT" },
  { label: "Belgium", value: "BE" },
  { label: "Austria", value: "AT" },
  { label: "Switzerland", value: "CH" },
];

const US_PROVINCES: CountryOption[] = [
  { label: "Alabama", value: "AL" }, { label: "Alaska", value: "AK" }, { label: "Arizona", value: "AZ" },
  { label: "Arkansas", value: "AR" }, { label: "California", value: "CA" }, { label: "Colorado", value: "CO" },
  { label: "Connecticut", value: "CT" }, { label: "Delaware", value: "DE" }, { label: "Florida", value: "FL" },
  { label: "Georgia", value: "GA" }, { label: "Hawaii", value: "HI" }, { label: "Idaho", value: "ID" },
  { label: "Illinois", value: "IL" }, { label: "Indiana", value: "IN" }, { label: "Iowa", value: "IA" },
  { label: "Kansas", value: "KS" }, { label: "Kentucky", value: "KY" }, { label: "Louisiana", value: "LA" },
  { label: "Maine", value: "ME" }, { label: "Maryland", value: "MD" }, { label: "Massachusetts", value: "MA" },
  { label: "Michigan", value: "MI" }, { label: "Minnesota", value: "MN" }, { label: "Mississippi", value: "MS" },
  { label: "Missouri", value: "MO" }, { label: "Montana", value: "MT" }, { label: "Nebraska", value: "NE" },
  { label: "Nevada", value: "NV" }, { label: "New Hampshire", value: "NH" }, { label: "New Jersey", value: "NJ" },
  { label: "New Mexico", value: "NM" }, { label: "New York", value: "NY" }, { label: "North Carolina", value: "NC" },
  { label: "North Dakota", value: "ND" }, { label: "Ohio", value: "OH" }, { label: "Oklahoma", value: "OK" },
  { label: "Oregon", value: "OR" }, { label: "Pennsylvania", value: "PA" }, { label: "Rhode Island", value: "RI" },
  { label: "South Carolina", value: "SC" }, { label: "South Dakota", value: "SD" }, { label: "Tennessee", value: "TN" },
  { label: "Texas", value: "TX" }, { label: "Utah", value: "UT" }, { label: "Vermont", value: "VT" },
  { label: "Virginia", value: "VA" }, { label: "Washington", value: "WA" }, { label: "West Virginia", value: "WV" },
  { label: "Wisconsin", value: "WI" }, { label: "Wyoming", value: "WY" },
];

const CA_PROVINCES: CountryOption[] = [
  { label: "Alberta", value: "AB" },
  { label: "British Columbia", value: "BC" },
  { label: "Manitoba", value: "MB" },
  { label: "New Brunswick", value: "NB" },
  { label: "Newfoundland and Labrador", value: "NL" },
  { label: "Northwest Territories", value: "NT" },
  { label: "Nova Scotia", value: "NS" },
  { label: "Nunavut", value: "NU" },
  { label: "Ontario", value: "ON" },
  { label: "Prince Edward Island", value: "PE" },
  { label: "Quebec", value: "QC" },
  { label: "Saskatchewan", value: "SK" },
  { label: "Yukon", value: "YT" },
];

/** Human country name for the summary "Ship to" block. */
export function countryName(code: string): string {
  return COUNTRIES.find(function match(entry) {
    return entry.value === code.toUpperCase();
  })?.label ?? code.toUpperCase();
}

function toOptions(list: CountryOption[]): Array<{ label: string; value: string }> {
  return list.map(function option(entry) {
    return { label: entry.label, value: entry.value };
  });
}

interface AddressFormProps {
  value: AddressDraft;
  disabled: boolean;
  onChange(next: AddressDraft): void;
}

/** Full checkout-style address card. */
function AddressForm({ value, disabled, onChange }: AddressFormProps) {
  function patch(next: Partial<AddressDraft>) {
    onChange({ ...value, ...next });
  }

  const provinces = value.country === "US" ? US_PROVINCES : value.country === "CA" ? CA_PROVINCES : null;

  return (
    <BlockStack gap="200">
      <InlineStack gap="200">
        <div style={{ flexGrow: 1 }}>
          <TextField
            label="First name"
            value={value.firstName}
            onChange={function setFirstName(next) {
              patch({ firstName: next });
            }}
            autoComplete="off"
            maxLength={60}
            disabled={disabled}
          />
        </div>
        <div style={{ flexGrow: 1 }}>
          <TextField
            label="Last name"
            value={value.lastName}
            onChange={function setLastName(next) {
              patch({ lastName: next });
            }}
            autoComplete="off"
            maxLength={60}
            disabled={disabled}
          />
        </div>
      </InlineStack>
      <TextField
        label="Address"
        value={value.address1}
        onChange={function setAddress1(next) {
          patch({ address1: next });
        }}
        placeholder="Street and number"
        autoComplete="off"
        maxLength={100}
        disabled={disabled}
      />
      <TextField
        label="Apartment, suite, etc. (optional)"
        value={value.address2}
        onChange={function setAddress2(next) {
          patch({ address2: next });
        }}
        autoComplete="off"
        maxLength={100}
        disabled={disabled}
      />
      <TextField
        label="City"
        value={value.city}
        onChange={function setCity(next) {
          patch({ city: next });
        }}
        autoComplete="off"
        maxLength={60}
        disabled={disabled}
      />
      <Select
        label="Country/Region"
        options={toOptions(COUNTRIES)}
        value={value.country}
        onChange={function setCountry(next) {
          patch({ country: next, province: "" });
        }}
        disabled={disabled}
      />
      {provinces ? (
        <Select
          label="State/Province"
          options={toOptions(provinces)}
          value={provinces.some(function match(entry) {
            return entry.value === value.province;
          }) ? value.province : ""}
          onChange={function setProvince(next) {
            patch({ province: next });
          }}
          disabled={disabled}
        />
      ) : (
        <TextField
          label="State/Province (optional)"
          value={value.province}
          onChange={function setProvince(next) {
            patch({ province: next.toUpperCase().slice(0, 10) });
          }}
          placeholder="Code or name"
          autoComplete="off"
          maxLength={10}
          disabled={disabled}
        />
      )}
      <InlineStack gap="200">
        <div style={{ flexGrow: 1 }}>
          <TextField
            label="ZIP / Postal code"
            value={value.zip}
            onChange={function setZip(next) {
              patch({ zip: next.slice(0, 20) });
            }}
            autoComplete="off"
            maxLength={20}
            disabled={disabled}
          />
        </div>
        <div style={{ flexGrow: 1 }}>
          <TextField
            label="Phone (optional)"
            value={value.phone}
            onChange={function setPhone(next) {
              patch({ phone: next.slice(0, 30) });
            }}
            type="tel"
            autoComplete="off"
            maxLength={30}
            disabled={disabled}
          />
        </div>
      </InlineStack>
    </BlockStack>
  );
}

export default AddressForm;
