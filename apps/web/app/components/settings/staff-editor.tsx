"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BUSINESS_ROLES, type BusinessRole, type StaffDirectoryItem } from "@tradeos/contracts";
import { Button } from "../ui/button";

const ROLE_LABELS: Record<BusinessRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  SALES: "Sales",
  INVENTORY: "Inventory",
  ACCOUNTANT: "Accountant",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

const ADMIN_ROLES: readonly BusinessRole[] = ["MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"];

export interface StaffEditorValue {
  displayName: string;
  email: string;
  phone: string;
  role: BusinessRole;
}

export function StaffEditor({
  actorRole,
  staff,
  busy,
  onSubmit,
  onCancel,
}: {
  actorRole: string | null | undefined;
  staff?: StaffDirectoryItem | null;
  busy: boolean;
  onSubmit: (value: StaffEditorValue) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<StaffEditorValue>(() => toValue(staff));

  useEffect(() => {
    setValue(toValue(staff));
  }, [staff]);

  const allowedRoles = actorRole === "OWNER" ? BUSINESS_ROLES : ADMIN_ROLES;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.displayName.trim() || busy) return;
    void onSubmit({ ...value, displayName: value.displayName.trim(), email: value.email.trim(), phone: value.phone.trim() });
  };

  return (
    <form className="tos-team__editor tos-settings__form" onSubmit={submit}>
      <div className="tos-team__editor-heading">
        <div>
          <span className="tos-settings__mini-eyebrow">{staff ? "Team member" : "New team member"}</span>
          <h3 className="tos-settings__subheading">{staff ? `Edit ${staff.displayName}` : "Add staff"}</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>

      <div className="tos-settings__grid tos-settings__grid--2">
        <EditorField label="Display name" htmlFor="team-staff-name" required>
          <input id="team-staff-name" className="tos-input" value={value.displayName} maxLength={120} required onChange={(event) => setValue((current) => ({ ...current, displayName: event.target.value }))} />
        </EditorField>
        <EditorField label="Role" htmlFor="team-staff-role" required>
          <select id="team-staff-role" className="tos-select" value={value.role} onChange={(event) => setValue((current) => ({ ...current, role: event.target.value as BusinessRole }))}>
            {allowedRoles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </EditorField>
        <EditorField label="Email" htmlFor="team-staff-email">
          <input id="team-staff-email" className="tos-input" type="email" value={value.email} autoComplete="email" onChange={(event) => setValue((current) => ({ ...current, email: event.target.value }))} />
        </EditorField>
        <EditorField label="Phone" htmlFor="team-staff-phone" hint="Use international format, for example +233…">
          <input id="team-staff-phone" className="tos-input" value={value.phone} autoComplete="tel" placeholder="+233…" onChange={(event) => setValue((current) => ({ ...current, phone: event.target.value }))} />
        </EditorField>
      </div>

      <div className="tos-settings__actions">
        <Button type="submit" variant="primary" loading={busy} disabled={!value.displayName.trim()}>{staff ? "Save staff" : "Add staff"}</Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function toValue(staff?: StaffDirectoryItem | null): StaffEditorValue {
  return {
    displayName: staff?.displayName ?? "",
    email: staff?.email ?? "",
    phone: staff?.phone ?? "",
    role: staff?.role ?? "STAFF",
  };
}

function EditorField({ label, htmlFor, hint, required, children }: { label: string; htmlFor: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="tos-field">
      <label className="tos-field__label" htmlFor={htmlFor}>{label}{required ? <span className="tos-field__label-required">*</span> : null}</label>
      {children}
      {hint ? <span className="tos-settings__field-hint">{hint}</span> : null}
    </div>
  );
}
