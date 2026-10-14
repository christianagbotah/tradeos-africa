"use client";

import {
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCIES,
  SUPPORTED_TIMEZONES,
} from "@tradeos/contracts";

export const BUSINESS_TYPES = [
  ["RETAIL_HARDWARE", "Retail / Hardware"],
  ["FOOD", "Food & Beverage"],
  ["SALON_BARBER", "Salon / Barber"],
  ["DRINKING_SPOT", "Drinking spot / Bar"],
  ["WASHING_BAY", "Washing bay"],
  ["CAR_PARK", "Car park"],
  ["DISTRIBUTION", "Distribution"],
  ["SERVICES", "Services"],
  ["OTHER", "Other"],
] as const;

export type BusinessType = typeof BUSINESS_TYPES[number][0];

export interface BusinessFormState {
  name: string;
  legalName: string;
  businessType: BusinessType;
  email: string;
  phone: string;
  registrationNumber: string;
  taxId: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  logoUrl: string;
}

export function BusinessFields({
  prefix,
  value,
  onChange,
  onCountryChange,
}: {
  prefix: string;
  value: BusinessFormState;
  onChange: <K extends keyof BusinessFormState>(key: K, value: BusinessFormState[K]) => void;
  onCountryChange?: (countryCode: string) => void;
}) {
  const id = (suffix: string) => `${prefix}-${suffix}`;
  return (
    <div className="tos-settings__grid tos-settings__grid--2">
      <Field label="Business name" htmlFor={id("name")} required>
        <input id={id("name")} className="tos-input" value={value.name} onChange={(event) => onChange("name", event.target.value)} required minLength={2} maxLength={120} />
      </Field>
      <Field label="Legal name" htmlFor={id("legal")}>
        <input id={id("legal")} className="tos-input" value={value.legalName} onChange={(event) => onChange("legalName", event.target.value)} maxLength={160} />
      </Field>
      <Field label="Business type" htmlFor={id("type")} required>
        <select id={id("type")} className="tos-select" value={value.businessType} onChange={(event) => onChange("businessType", event.target.value as BusinessType)}>
          {BUSINESS_TYPES.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
        </select>
      </Field>
      <Field label="Logo URL" htmlFor={id("logo")}>
        <input id={id("logo")} className="tos-input" type="url" value={value.logoUrl} onChange={(event) => onChange("logoUrl", event.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Email" htmlFor={id("email")}><input id={id("email")} className="tos-input" type="email" value={value.email} onChange={(event) => onChange("email", event.target.value)} /></Field>
      <Field label="Phone" htmlFor={id("phone")}><input id={id("phone")} className="tos-input" value={value.phone} onChange={(event) => onChange("phone", event.target.value)} /></Field>
      <Field label="Registration number" htmlFor={id("registration")}><input id={id("registration")} className="tos-input" value={value.registrationNumber} onChange={(event) => onChange("registrationNumber", event.target.value)} /></Field>
      <Field label="Tax ID" htmlFor={id("tax")}><input id={id("tax")} className="tos-input" value={value.taxId} onChange={(event) => onChange("taxId", event.target.value)} /></Field>
      <Field label="Address line 1" htmlFor={id("address1")}><input id={id("address1")} className="tos-input" value={value.addressLine1} onChange={(event) => onChange("addressLine1", event.target.value)} /></Field>
      <Field label="Address line 2" htmlFor={id("address2")}><input id={id("address2")} className="tos-input" value={value.addressLine2} onChange={(event) => onChange("addressLine2", event.target.value)} /></Field>
      <Field label="City" htmlFor={id("city")}><input id={id("city")} className="tos-input" value={value.city} onChange={(event) => onChange("city", event.target.value)} /></Field>
      <Field label="Region" htmlFor={id("region")}><input id={id("region")} className="tos-input" value={value.region} onChange={(event) => onChange("region", event.target.value)} /></Field>
      <Field label="Postal code" htmlFor={id("postal")}><input id={id("postal")} className="tos-input" value={value.postalCode} onChange={(event) => onChange("postalCode", event.target.value)} /></Field>
      <Field label="Country" htmlFor={id("country")}>
        <select id={id("country")} className="tos-select" value={value.countryCode} onChange={(event) => (onCountryChange ?? ((countryCode: string) => onChange("countryCode", countryCode)))(event.target.value)}>
          {SUPPORTED_COUNTRIES.map((country) => <option key={country.countryCode} value={country.countryCode}>{country.flag} {country.country}</option>)}
        </select>
      </Field>
      <Field label="Base currency" htmlFor={id("currency")} hint="Locks after financial or inventory activity">
        <select id={id("currency")} className="tos-select" value={value.currencyCode} onChange={(event) => onChange("currencyCode", event.target.value)}>
          {SUPPORTED_CURRENCIES.map((currency) => <option key={currency.currencyCode} value={currency.currencyCode}>{currency.symbol} {currency.currencyCode} — {currency.name}</option>)}
        </select>
      </Field>
      <Field label="Timezone" htmlFor={id("timezone")}>
        <select id={id("timezone")} className="tos-select" value={value.timezone} onChange={(event) => onChange("timezone", event.target.value)}>
          {SUPPORTED_TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, htmlFor, hint, required, children }: { label: string; htmlFor: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="tos-field">
      <label className="tos-field__label" htmlFor={htmlFor}>{label}{required ? <span className="tos-field__label-required">*</span> : null}</label>
      {children}
      {hint ? <span className="tos-settings__field-hint">{hint}</span> : null}
    </div>
  );
}
