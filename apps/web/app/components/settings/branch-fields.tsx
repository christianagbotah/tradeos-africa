"use client";

import { SUPPORTED_TIMEZONES } from "@tradeos/contracts";

export interface BranchDraft {
  name: string;
  code: string;
  timezone: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
}

export function BranchFields({
  prefix,
  draft,
  setDraft,
  includeCode,
}: {
  prefix: string;
  draft: BranchDraft;
  setDraft: React.Dispatch<React.SetStateAction<BranchDraft>>;
  includeCode: boolean;
}) {
  const set = <K extends keyof BranchDraft>(key: K, value: BranchDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="tos-settings__grid tos-settings__grid--single">
      <Field label="Branch name" htmlFor={`${prefix}-name`} required><input id={`${prefix}-name`} className="tos-input" value={draft.name} onChange={(event) => set("name", event.target.value)} required maxLength={120} /></Field>
      {includeCode ? <Field label="Branch code" htmlFor={`${prefix}-code`} hint="Optional; TradeOS can generate one"><input id={`${prefix}-code`} className="tos-input" value={draft.code} onChange={(event) => set("code", event.target.value.toUpperCase())} placeholder="e.g. TEMA25" maxLength={24} /></Field> : null}
      <Field label="Timezone" htmlFor={`${prefix}-timezone`}><select id={`${prefix}-timezone`} className="tos-select" value={draft.timezone} onChange={(event) => set("timezone", event.target.value)}>{SUPPORTED_TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></Field>
      <Field label="Email" htmlFor={`${prefix}-email`}><input id={`${prefix}-email`} className="tos-input" type="email" value={draft.email} onChange={(event) => set("email", event.target.value)} /></Field>
      <Field label="Phone" htmlFor={`${prefix}-phone`}><input id={`${prefix}-phone`} className="tos-input" value={draft.phone} onChange={(event) => set("phone", event.target.value)} /></Field>
      <Field label="Address line 1" htmlFor={`${prefix}-address1`}><input id={`${prefix}-address1`} className="tos-input" value={draft.addressLine1} onChange={(event) => set("addressLine1", event.target.value)} /></Field>
      <Field label="Address line 2" htmlFor={`${prefix}-address2`}><input id={`${prefix}-address2`} className="tos-input" value={draft.addressLine2} onChange={(event) => set("addressLine2", event.target.value)} /></Field>
      <Field label="City" htmlFor={`${prefix}-city`}><input id={`${prefix}-city`} className="tos-input" value={draft.city} onChange={(event) => set("city", event.target.value)} /></Field>
      <Field label="Region" htmlFor={`${prefix}-region`}><input id={`${prefix}-region`} className="tos-input" value={draft.region} onChange={(event) => set("region", event.target.value)} /></Field>
      <Field label="Postal code" htmlFor={`${prefix}-postal`}><input id={`${prefix}-postal`} className="tos-input" value={draft.postalCode} onChange={(event) => set("postalCode", event.target.value)} /></Field>
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
