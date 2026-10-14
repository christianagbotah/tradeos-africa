"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  getCountry,
  getDefaultCurrencyCode,
  getSuggestedTimezones,
} from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { Button } from "../ui/button";
import { BusinessFields, type BusinessFormState, type BusinessType } from "./business-fields";
import { BranchFields, type BranchDraft } from "./branch-fields";
import {
  IconAlert,
  IconBuilding,
  IconCheck,
  IconEdit,
  IconLock,
  IconPlus,
  IconRefresh,
  IconShield,
  IconUser,
  IconUsers,
} from "../ui/icons";
import { useWorkspace } from "../workspace/use-workspace";
import type {
  WorkspaceBranch,
  WorkspaceBusinessProfile,
} from "../workspace/workspace-provider";
import type { WorkspaceRole } from "../workspace/workspace-navigation";

export type SettingsSectionId = "profile" | "security" | "business" | "branches" | "team" | "devices";

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; label: string; description: string }[] = [
  { id: "profile", label: "My Profile", description: "Personal identity and contact details" },
  { id: "security", label: "Security", description: "Password and sign-in protection" },
  { id: "business", label: "Business", description: "Business identity, location and new businesses" },
  { id: "branches", label: "Branches", description: "Locations, branch status and new branches" },
  { id: "team", label: "Team & access", description: "Role and staff access boundary" },
  { id: "devices", label: "Devices & sessions", description: "Signed-in devices and session control" },
] as const;

type Feedback = { tone: "success" | "error" | "info"; text: string } | null;

type SessionView = {
  id: string;
  deviceKey: string;
  platform: string;
  appVersion: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  refreshExpiresAt: string;
};

interface NewBusinessFormState extends BusinessFormState {
  firstBranchName: string;
}

type BusinessEditorMode = "view" | "edit" | "create";

type BranchEditorMode = { kind: "view" } | { kind: "create" } | { kind: "edit"; branchId: string };

export function canManageBusinessSettings(role: WorkspaceRole | string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canCreateBusiness(role: WorkspaceRole | string | null | undefined): boolean {
  return Boolean(role);
}

export function normalizeSettingsSection(value: string | null | undefined): SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value) ? value as SettingsSectionId : "profile";
}

export function SettingsWorkspace() {
  const {
    session,
    role,
    account,
    memberships,
    businessContext,
    queue,
    refreshWorkspaceContext,
    switchBusiness,
    switchBranch,
  } = useWorkspace();
  const searchParams = useSearchParams();
  const querySection = searchParams.get("section");
  const requestedAction = searchParams.get("action");
  const [section, setSection] = useState<SettingsSectionId>(() => normalizeSettingsSection(querySection));

  useEffect(() => {
    if (querySection) {
      setSection(normalizeSettingsSection(querySection));
      return;
    }
    if (typeof window === "undefined") return;
    const syncHash = () => setSection(normalizeSettingsSection(window.location.hash.replace(/^#/, "")));
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [querySection]);

  const consumeRequestedAction = () => {
    if (typeof window === "undefined" || !requestedAction) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("action");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  };

  const chooseSection = (next: SettingsSectionId) => {
    setSection(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", next);
    params.delete("action");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  };

  if (!session) return null;

  return (
    <div className="tos-settings tos-stagger">
      <header className="tos-settings__hero tos-animate-fade-in-up">
        <div>
          <span className="tos-settings__eyebrow">Account & business control center</span>
          <h1 className="tos-settings__title">Settings</h1>
          <p className="tos-settings__lead">
            Manage your personal account, business identity, branches and signed-in devices without leaving the workspace.
          </p>
        </div>
        <div className="tos-settings__context-summary">
          <span className="tos-settings__context-label">Current workspace</span>
          <strong>{session.businessName}</strong>
          <span>{activeBranchName(businessContext?.branches ?? [], session.branchId)} · {role}</span>
        </div>
      </header>

      {!queue.online ? (
        <div className="tos-banner tos-banner--warning" role="status">
          <IconAlert className="tos-banner__icon" />
          <div className="tos-banner__body">
            <span className="tos-banner__title">Settings are read-only while offline</span>
            <span className="tos-banner__text">Sensitive account and business changes require a verified server connection. Offline sales and queued work remain safe.</span>
          </div>
        </div>
      ) : null}

      <div className="tos-settings__layout">
        <nav className="tos-settings__nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="tos-settings__nav-item"
              data-active={section === item.id}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => chooseSection(item.id)}
            >
              <span className="tos-settings__nav-label">{item.label}</span>
              <span className="tos-settings__nav-description">{item.description}</span>
            </button>
          ))}
        </nav>

        <section className="tos-settings__content" aria-live="polite">
          {section === "profile" ? (
            <ProfileSection online={queue.online} onRefresh={refreshWorkspaceContext} />
          ) : null}
          {section === "security" ? (
            <SecuritySection online={queue.online} />
          ) : null}
          {section === "business" ? (
            <BusinessSection
              online={queue.online}
              canManage={canManageBusinessSettings(role)}
              canCreate={canCreateBusiness(role)}
              onRefresh={refreshWorkspaceContext}
              onSwitchBusiness={switchBusiness}
              requestedAction={section === "business" ? requestedAction : null}
              onActionConsumed={consumeRequestedAction}
            />
          ) : null}
          {section === "branches" ? (
            <BranchesSection
              online={queue.online}
              canManage={canManageBusinessSettings(role)}
              onRefresh={refreshWorkspaceContext}
              onSwitchBranch={switchBranch}
              requestedAction={section === "branches" ? requestedAction : null}
              onActionConsumed={consumeRequestedAction}
            />
          ) : null}
          {section === "team" ? (
            <TeamSection />
          ) : null}
          {section === "devices" ? (
            <DevicesSection online={queue.online} />
          ) : null}
        </section>
      </div>

      <footer className="tos-settings__footnote">
        Signed in as <strong>{account?.displayName ?? session.displayName}</strong> · {memberships.length} business membership{memberships.length === 1 ? "" : "s"}
      </footer>
    </div>
  );
}

function ProfileSection({ online, onRefresh }: { online: boolean; onRefresh: () => Promise<void> }) {
  const { account, session } = useWorkspace();
  const [displayName, setDisplayName] = useState(account?.displayName ?? session?.displayName ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [phone, setPhone] = useState(account?.phoneE164 ?? "");
  const [avatarUrl, setAvatarUrl] = useState(account?.avatarUrl ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    setDisplayName(account?.displayName ?? session?.displayName ?? "");
    setEmail(account?.email ?? "");
    setPhone(account?.phoneE164 ?? "");
    setAvatarUrl(account?.avatarUrl ?? "");
  }, [account, session?.displayName]);

  const identityChanged = email.trim() !== (account?.email ?? "") || phone.trim() !== (account?.phoneE164 ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online || busy) return;
    if (identityChanged && !currentPassword) {
      setFeedback({ tone: "error", text: "Enter your current password to change your email or phone number." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
          ...(identityChanged ? { currentPassword } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Profile could not be updated"));
      await onRefresh();
      setCurrentPassword("");
      setFeedback({ tone: "success", text: "Your profile has been updated." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPanel
      icon={<IconUser />}
      eyebrow="Personal account"
      title="My Profile"
      description="These details follow your TradeOS account across every business you can access."
      feedback={feedback}
    >
      <form className="tos-settings__form" onSubmit={submit}>
        <Field label="Display name" htmlFor="settings-profile-name" required>
          <input id="settings-profile-name" className="tos-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required autoComplete="name" />
        </Field>
        <div className="tos-settings__grid tos-settings__grid--2">
          <Field label="Email" htmlFor="settings-profile-email">
            <input id="settings-profile-email" className="tos-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="settings-profile-phone">
            <input id="settings-profile-phone" className="tos-input" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="+233…" />
          </Field>
        </div>
        <Field label="Avatar URL" htmlFor="settings-profile-avatar" hint="Optional HTTPS image URL">
          <input id="settings-profile-avatar" className="tos-input" type="url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://…" />
        </Field>
        {identityChanged ? (
          <Field label="Current password" htmlFor="settings-profile-password" hint="Required because your sign-in identity changed">
            <input id="settings-profile-password" className="tos-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
          </Field>
        ) : null}
        <div className="tos-settings__actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!online || !displayName.trim()}>Save profile</Button>
        </div>
      </form>
    </SettingsPanel>
  );
}

function SecuritySection({ online }: { online: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!online || busy) return;
    if (newPassword.length < 8) {
      setFeedback({ tone: "error", text: "New password must contain at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ tone: "error", text: "The new password and confirmation do not match." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: revokeOthers }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Password could not be changed"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFeedback({ tone: "success", text: revokeOthers ? "Password changed. Other signed-in devices were signed out." : "Password changed." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPanel
      icon={<IconLock />}
      eyebrow="Account protection"
      title="Security"
      description="Change your password and decide whether other devices should remain signed in."
      feedback={feedback}
    >
      <form className="tos-settings__form" onSubmit={submit}>
        <Field label="Current password" htmlFor="settings-security-current" required>
          <input id="settings-security-current" className="tos-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
        </Field>
        <div className="tos-settings__grid tos-settings__grid--2">
          <Field label="New password" htmlFor="settings-security-new" required hint="8–200 characters">
            <input id="settings-security-new" className="tos-input" type="password" minLength={8} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" htmlFor="settings-security-confirm" required>
            <input id="settings-security-confirm" className="tos-input" type="password" minLength={8} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
          </Field>
        </div>
        <label className="tos-settings__check-row">
          <input type="checkbox" checked={revokeOthers} onChange={(event) => setRevokeOthers(event.target.checked)} />
          <span>
            <strong>Sign out other devices</strong>
            <small>Recommended after a password change. This device stays signed in.</small>
          </span>
        </label>
        <div className="tos-settings__actions">
          <Button type="submit" variant="primary" loading={busy} disabled={!online || !currentPassword || !newPassword || !confirmPassword}>Change password</Button>
        </div>
      </form>
    </SettingsPanel>
  );
}

function BusinessSection({
  online,
  canManage,
  canCreate,
  onRefresh,
  onSwitchBusiness,
  requestedAction,
  onActionConsumed,
}: {
  online: boolean;
  canManage: boolean;
  canCreate: boolean;
  onRefresh: () => Promise<void>;
  onSwitchBusiness: (businessId: string) => Promise<void>;
  requestedAction: string | null;
  onActionConsumed: () => void;
}) {
  const { businessContext, session } = useWorkspace();
  const business = businessContext?.business;
  const [form, setForm] = useState<BusinessFormState>(() => businessToForm(business));
  const [newBusiness, setNewBusiness] = useState<NewBusinessFormState>(() => defaultNewBusiness());
  const [businessMode, setBusinessMode] = useState<BusinessEditorMode>("view");
  const editing = businessMode === "edit";
  const creating = businessMode === "create";
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    setForm(businessToForm(business));
  }, [business]);

  useEffect(() => {
    if (requestedAction === "create" && canCreate) {
      setBusinessMode("create");
      onActionConsumed();
    }
  }, [requestedAction, canCreate]);

  const updateField = <K extends keyof BusinessFormState>(key: K, value: BusinessFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const updateNewBusinessField = <K extends keyof BusinessFormState>(key: K, value: BusinessFormState[K]) => {
    setNewBusiness((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!business || !session || !online || !canManage || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(`/v1/businesses/${encodeURIComponent(session.businessId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          legalName: nullable(form.legalName),
          businessType: form.businessType,
          email: nullable(form.email),
          phone: nullable(form.phone),
          registrationNumber: nullable(form.registrationNumber),
          taxId: nullable(form.taxId),
          addressLine1: nullable(form.addressLine1),
          addressLine2: nullable(form.addressLine2),
          city: nullable(form.city),
          region: nullable(form.region),
          postalCode: nullable(form.postalCode),
          countryCode: form.countryCode,
          currencyCode: form.currencyCode,
          timezone: form.timezone,
          logoUrl: nullable(form.logoUrl),
        }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Business could not be updated"));
      await onRefresh();
      setBusinessMode("view");
      setFeedback({ tone: "success", text: "Business details have been updated." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const submitNewBusiness = async (event: FormEvent) => {
    event.preventDefault();
    if (!online || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBusiness.name.trim(),
          legalName: nullable(newBusiness.legalName),
          businessType: newBusiness.businessType,
          email: nullable(newBusiness.email),
          phone: nullable(newBusiness.phone),
          registrationNumber: nullable(newBusiness.registrationNumber),
          taxId: nullable(newBusiness.taxId),
          addressLine1: nullable(newBusiness.addressLine1),
          addressLine2: nullable(newBusiness.addressLine2),
          city: nullable(newBusiness.city),
          region: nullable(newBusiness.region),
          postalCode: nullable(newBusiness.postalCode),
          countryCode: newBusiness.countryCode,
          currencyCode: newBusiness.currencyCode,
          timezone: newBusiness.timezone,
          logoUrl: nullable(newBusiness.logoUrl),
          branchName: newBusiness.firstBranchName.trim() || "Main",
        }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Business could not be created"));
      const json = await response.json() as { business?: { id?: string } };
      if (!json.business?.id) throw new Error("Server returned an incomplete business record.");
      await onSwitchBusiness(json.business.id);
      setBusinessMode("view");
      setNewBusiness(defaultNewBusiness());
      setFeedback({ tone: "success", text: "New business created and opened." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  if (!business) {
    return <LoadingSettingsPanel title="Business" text="Loading authoritative business details…" />;
  }

  return (
    <SettingsPanel
      icon={<IconBuilding />}
      eyebrow="Business identity"
      title="Business"
      description="Maintain the current business or create another independent TradeOS business under this same account."
      feedback={feedback}
      actions={(canManage || canCreate) ? (
        <div className="tos-settings__header-actions">
          {canManage ? <Button variant="outline" icon={<IconEdit />} onClick={() => setBusinessMode(editing ? "view" : "edit")}>{editing ? "Close editor" : "Edit business"}</Button> : null}
          {canCreate ? <Button variant="primary" icon={<IconPlus />} onClick={() => setBusinessMode(creating ? "view" : "create")}>{creating ? "Cancel new business" : "Add business"}</Button> : null}
        </div>
      ) : undefined}
    >
      <div className="tos-settings__summary-grid">
        <Summary label="Trading name" value={business.name} />
        <Summary label="Business type" value={business.businessType.replaceAll("_", " ")} />
        <Summary label="Country / currency" value={`${business.countryCode} · ${business.currencyCode}`} />
        <Summary label="Timezone" value={business.timezone} />
        <Summary label="Registration" value={business.registrationNumber ?? "Not set"} />
        <Summary label="Tax ID" value={business.taxId ?? "Not set"} />
      </div>

      {!canManage ? (
        <InfoCallout title="Current business is read-only" text="Only the business OWNER or ADMIN can edit this business. You can still create another business that you own from this account." />
      ) : null}

      {editing && canManage ? (
        <form className="tos-settings__form tos-settings__subpanel" onSubmit={submit}>
          <h3 className="tos-settings__subheading">Edit current business</h3>
          <BusinessFields prefix="settings-business" value={form} onChange={updateField} />
          <div className="tos-settings__actions"><Button type="submit" variant="primary" loading={busy} disabled={!online || !form.name.trim()}>Save business</Button></div>
        </form>
      ) : null}

      {creating && canCreate ? (
        <form className="tos-settings__form tos-settings__subpanel tos-settings__subpanel--gold" onSubmit={submitNewBusiness}>
          <div>
            <span className="tos-settings__mini-eyebrow">New workspace</span>
            <h3 className="tos-settings__subheading">Create another business</h3>
            <p className="tos-settings__subtext">A new independent business, MAIN branch and OWNER membership will be created under your current account.</p>
          </div>
          <BusinessFields
            prefix="settings-new-business"
            value={newBusiness}
            onChange={updateNewBusinessField}
            onCountryChange={(countryCode) => setNewBusiness((current) => applyCountryDefaults(current, countryCode))}
          />
          <div className="tos-settings__grid tos-settings__grid--2">
            <Field label="First branch name" htmlFor="settings-new-business-branch"><input id="settings-new-business-branch" className="tos-input" value={newBusiness.firstBranchName} onChange={(event) => setNewBusiness((current) => ({ ...current, firstBranchName: event.target.value }))} /></Field>
          </div>
          <div className="tos-settings__actions"><Button type="submit" variant="gold" loading={busy} disabled={!online || !newBusiness.name.trim()}>Create business & open it</Button></div>
        </form>
      ) : null}
    </SettingsPanel>
  );
}

function BranchesSection({
  online,
  canManage,
  onRefresh,
  onSwitchBranch,
  requestedAction,
  onActionConsumed,
}: {
  online: boolean;
  canManage: boolean;
  onRefresh: () => Promise<void>;
  onSwitchBranch: (branchId: string) => Promise<void>;
  requestedAction: string | null;
  onActionConsumed: () => void;
}) {
  const { businessContext, session } = useWorkspace();
  const branches = businessContext?.branches ?? [];
  const [branchMode, setBranchMode] = useState<BranchEditorMode>({ kind: "view" });
  const creating = branchMode.kind === "create";
  const editingId = branchMode.kind === "edit" ? branchMode.branchId : null;
  const [draft, setDraft] = useState<BranchDraft>(() => defaultBranchDraft(businessContext?.business.timezone ?? "Africa/Accra"));
  const [editDraft, setEditDraft] = useState<BranchDraft>(() => defaultBranchDraft(businessContext?.business.timezone ?? "Africa/Accra"));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (businessContext?.business.timezone) {
      setDraft((current) => ({ ...current, timezone: current.timezone || businessContext.business.timezone }));
    }
  }, [businessContext?.business.timezone]);

  useEffect(() => {
    if (requestedAction === "create" && canManage) {
      setBranchMode({ kind: "create" });
      onActionConsumed();
    }
  }, [requestedAction, canManage]);

  const beginEdit = (branch: WorkspaceBranch) => {
    setBranchMode({ kind: "edit", branchId: branch.id });
    setEditDraft(branchToDraft(branch));
    setFeedback(null);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !online || !canManage || busyId) return;
    setBusyId("create");
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(`/v1/businesses/${encodeURIComponent(session.businessId)}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branchPayload(draft, true)),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Branch could not be created"));
      setDraft(defaultBranchDraft(businessContext?.business.timezone ?? session.timezone));
      setBranchMode({ kind: "view" });
      await onRefresh();
      setFeedback({ tone: "success", text: "Branch created. It is now available in the workspace switcher." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !editingId || !online || !canManage || busyId) return;
    setBusyId(editingId);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(`/v1/businesses/${encodeURIComponent(session.businessId)}/branches/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branchPayload(editDraft, false)),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Branch could not be updated"));
      await onRefresh();
      setBranchMode({ kind: "view" });
      setFeedback({ tone: "success", text: "Branch details updated." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const setActive = async (branch: WorkspaceBranch, active: boolean) => {
    if (!session || !online || !canManage || busyId) return;
    setBusyId(branch.id);
    setFeedback(null);
    try {
      const basePath = `/v1/businesses/${encodeURIComponent(session.businessId)}/branches/${encodeURIComponent(branch.id)}`;
      const actionPath = active ? `${basePath}/reactivate` : `${basePath}/deactivate`;
      const response = await getOfflineQueue().authenticatedFetch(actionPath, { method: "POST" });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, `Branch could not be ${active ? "reactivated" : "deactivated"}`));
      await onRefresh();
      setFeedback({ tone: "success", text: `${branch.name} was ${active ? "reactivated" : "deactivated"}.` });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPanel
      icon={<IconBuilding />}
      eyebrow="Operating locations"
      title="Branches"
      description="Create locations, update branch details and control which branches are available for daily operations."
      feedback={feedback}
      actions={canManage ? <Button variant="primary" icon={<IconPlus />} onClick={() => setBranchMode(creating ? { kind: "view" } : { kind: "create" })}>{creating ? "Cancel" : "Add branch"}</Button> : undefined}
    >
      <div className="tos-settings__branch-list">
        {branches.map((branch) => (
          <article key={branch.id} className="tos-settings__branch-card" data-active-branch={session?.branchId === branch.id}>
            <div className="tos-settings__branch-card-head">
              <div className="tos-settings__branch-main">
              <div className="tos-settings__branch-icon"><IconBuilding /></div>
              <div>
                <div className="tos-settings__branch-title-row">
                  <strong>{branch.name}</strong>
                  <span className={`tos-badge ${branch.active ? "tos-badge--positive" : "tos-badge--muted"}`}>{branch.active ? "Active" : "Inactive"}</span>
                  {session?.branchId === branch.id ? <span className="tos-badge tos-badge--info">Current</span> : null}
                </div>
                <span className="tos-settings__branch-meta">{branch.code} · {branch.timezone}{branch.city ? ` · ${branch.city}` : ""}</span>
              </div>
            </div>
              <div className="tos-settings__branch-actions">
                {branch.active && session?.branchId !== branch.id ? <Button size="sm" variant="outline" onClick={() => void onSwitchBranch(branch.id)}>Open</Button> : null}
                {canManage ? <Button size="sm" variant="ghost" icon={<IconEdit />} onClick={() => beginEdit(branch)}>Edit</Button> : null}
                {canManage && branch.active ? <Button size="sm" variant="danger" loading={busyId === branch.id} disabled={!online} onClick={() => void setActive(branch, false)}>Deactivate</Button> : null}
                {canManage && !branch.active ? <Button size="sm" variant="positive" loading={busyId === branch.id} disabled={!online} onClick={() => void setActive(branch, true)}>Reactivate</Button> : null}
              </div>
            </div>
            {editingId === branch.id ? (
              <div className="tos-settings__branch-editor-shell">
                <form className="tos-settings__form tos-settings__branch-editor" onSubmit={saveEdit}>
                  <BranchFields prefix={`edit-${branch.id}`} draft={editDraft} setDraft={setEditDraft} includeCode={false} singleColumn />
                  <div className="tos-settings__actions">
                    <Button type="submit" variant="primary" loading={busyId === branch.id} disabled={!online || !editDraft.name.trim()}>Save branch</Button>
                    <Button variant="outline" onClick={() => setBranchMode({ kind: "view" })}>Cancel</Button>
                  </div>
                </form>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {!canManage ? <InfoCallout title="Read-only access" text="You can switch between active branches you are allowed to use. Only OWNER and ADMIN can create or edit branch records." /> : null}

      {creating && canManage ? (
        <form className="tos-settings__form tos-settings__subpanel tos-settings__subpanel--gold" onSubmit={create}>
          <div><span className="tos-settings__mini-eyebrow">New location</span><h3 className="tos-settings__subheading">Add branch</h3></div>
          <BranchFields prefix="new-branch" draft={draft} setDraft={setDraft} includeCode singleColumn />
          <div className="tos-settings__actions"><Button type="submit" variant="gold" loading={busyId === "create"} disabled={!online || !draft.name.trim()}>Create branch</Button></div>
        </form>
      ) : null}
    </SettingsPanel>
  );
}

function TeamSection() {
  const { role, memberships, session } = useWorkspace();
  const current = memberships.find((membership) => membership.businessId === session?.businessId);
  return (
    <SettingsPanel
      icon={<IconUsers />}
      eyebrow="Business access"
      title="Team & access"
      description="See your access in this business. Team invitations and role management will appear here when the Team workspace is enabled."
    >
      <div className="tos-settings__summary-grid">
        <Summary label="Your role" value={role} />
        <Summary label="Membership status" value={current?.businessStatus ?? "ACTIVE"} />
        <Summary label="Staff link" value={current?.staffId ? "Linked" : "Not linked"} />
        <Summary label="Business" value={current?.businessName ?? session?.businessName ?? "—"} />
      </div>
      <InfoCallout
        title="Team management is coming here"
        text="Your business team will be managed from one place without creating duplicate accounts. Your current role and staff link are shown above."
      />
    </SettingsPanel>
  );
}

function DevicesSection({ online }: { online: boolean }) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = async () => {
    if (!online) return;
    setBusy(true);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/auth/sessions");
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Sessions could not be loaded"));
      const json = await response.json() as { sessions?: SessionView[] };
      setSessions(json.sessions ?? []);
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  // Only refresh when connectivity changes; user actions call load explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const revoke = async (sessionId: string) => {
    if (!online || busyId) return;
    setBusyId(sessionId);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(`/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Session could not be revoked"));
      await load();
      setFeedback({ tone: "success", text: "Device session revoked." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    if (!online || busyId) return;
    setBusyId("others");
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/auth/sessions/revoke-others", { method: "POST" });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Other sessions could not be revoked"));
      await load();
      setFeedback({ tone: "success", text: "All other signed-in devices were signed out." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPanel
      icon={<IconShield />}
      eyebrow="Session control"
      title="Devices & sessions"
      description="Review devices currently signed in to your TradeOS account and revoke access you no longer recognize."
      feedback={feedback}
      actions={<div className="tos-settings__header-actions"><Button variant="outline" icon={<IconRefresh />} loading={busy} disabled={!online} onClick={() => void load()}>Refresh</Button><Button variant="danger" loading={busyId === "others"} disabled={!online || sessions.filter((entry) => !entry.current).length === 0} onClick={() => void revokeOthers()}>Sign out other devices</Button></div>}
    >
      <div className="tos-settings__session-list">
        {busy && sessions.length === 0 ? <p className="tos-settings__subtext">Loading signed-in devices…</p> : null}
        {!busy && sessions.length === 0 ? <p className="tos-settings__subtext">No active sessions could be loaded.</p> : null}
        {sessions.map((entry) => (
          <article key={entry.id} className="tos-settings__session-card">
            <div className="tos-settings__session-icon"><IconShield /></div>
            <div className="tos-settings__session-main">
              <div className="tos-settings__branch-title-row">
                <strong>{friendlyPlatform(entry.platform)}</strong>
                {entry.current ? <span className="tos-badge tos-badge--positive">Current device</span> : null}
              </div>
              <span>{entry.deviceKey}</span>
              <small>App {entry.appVersion} · Last used {formatDate(entry.lastUsedAt ?? entry.createdAt)}</small>
            </div>
            {!entry.current ? <Button size="sm" variant="danger" loading={busyId === entry.id} disabled={!online} onClick={() => void revoke(entry.id)}>Revoke</Button> : null}
          </article>
        ))}
      </div>
    </SettingsPanel>
  );
}

function SettingsPanel({
  icon,
  eyebrow,
  title,
  description,
  actions,
  feedback,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  feedback?: Feedback;
  children: React.ReactNode;
}) {
  return (
    <div className="tos-settings__panel tos-animate-fade-in-up">
      <div className="tos-settings__panel-head">
        <div className="tos-settings__panel-icon" aria-hidden="true">{icon}</div>
        <div className="tos-settings__panel-copy">
          <span className="tos-settings__mini-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions ? <div className="tos-settings__panel-actions">{actions}</div> : null}
      </div>
      {feedback ? <FeedbackBanner feedback={feedback} /> : null}
      <div className="tos-settings__panel-body">{children}</div>
    </div>
  );
}

function LoadingSettingsPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="tos-settings__panel">
      <div className="tos-settings__panel-body tos-settings__loading"><span className="tos-spinner" /><strong>{title}</strong><span>{text}</span></div>
    </div>
  );
}

function FeedbackBanner({ feedback }: { feedback: NonNullable<Feedback> }) {
  return (
    <div className={`tos-settings__feedback tos-settings__feedback--${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
      {feedback.tone === "success" ? <IconCheck /> : feedback.tone === "error" ? <IconAlert /> : <IconShield />}
      <span>{feedback.text}</span>
    </div>
  );
}

function InfoCallout({ title, text }: { title: string; text: string }) {
  return <div className="tos-settings__callout"><IconShield /><div><strong>{title}</strong><span>{text}</span></div></div>;
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

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="tos-settings__summary">
      <span className="tos-settings__summary-label">{label}</span>
      <span className="tos-settings__summary-separator" aria-hidden="true">:</span>
      <strong className="tos-settings__summary-value">{value}</strong>
    </div>
  );
}

function businessToForm(business: WorkspaceBusinessProfile | null | undefined): BusinessFormState {
  return {
    name: business?.name ?? "",
    legalName: business?.legalName ?? "",
    businessType: (business?.businessType as BusinessType | undefined) ?? "OTHER",
    email: business?.email ?? "",
    phone: business?.phone ?? "",
    registrationNumber: business?.registrationNumber ?? "",
    taxId: business?.taxId ?? "",
    addressLine1: business?.addressLine1 ?? "",
    addressLine2: business?.addressLine2 ?? "",
    city: business?.city ?? "",
    region: business?.region ?? "",
    postalCode: business?.postalCode ?? "",
    countryCode: business?.countryCode ?? "GH",
    currencyCode: business?.currencyCode ?? "GHS",
    timezone: business?.timezone ?? "Africa/Accra",
    logoUrl: business?.logoUrl ?? "",
  };
}

function defaultNewBusiness(): NewBusinessFormState {
  return {
    name: "", legalName: "", businessType: "OTHER", email: "", phone: "",
    registrationNumber: "", taxId: "", addressLine1: "", addressLine2: "",
    city: "", region: "", postalCode: "", countryCode: "GH", currencyCode: "GHS",
    timezone: "Africa/Accra", logoUrl: "", firstBranchName: "Main",
  };
}

function applyCountryDefaults(current: NewBusinessFormState, countryCode: string): NewBusinessFormState {
  const country = getCountry(countryCode);
  const defaultCurrency = getDefaultCurrencyCode(countryCode) ?? current.currencyCode;
  const timezones = getSuggestedTimezones(countryCode);
  return {
    ...current,
    countryCode,
    currencyCode: defaultCurrency,
    timezone: timezones?.[0] ?? country?.timezones[0] ?? current.timezone,
  };
}

function defaultBranchDraft(timezone: string): BranchDraft {
  return { name: "", code: "", timezone, email: "", phone: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "" };
}

function branchToDraft(branch: WorkspaceBranch): BranchDraft {
  return {
    name: branch.name,
    code: branch.code,
    timezone: branch.timezone,
    email: branch.email ?? "",
    phone: branch.phone ?? "",
    addressLine1: branch.addressLine1 ?? "",
    addressLine2: branch.addressLine2 ?? "",
    city: branch.city ?? "",
    region: branch.region ?? "",
    postalCode: branch.postalCode ?? "",
  };
}

function branchPayload(draft: BranchDraft, includeCode: boolean) {
  return {
    name: draft.name.trim(),
    ...(includeCode && draft.code.trim() ? { code: draft.code.trim() } : {}),
    timezone: draft.timezone,
    email: nullable(draft.email),
    phone: nullable(draft.phone),
    addressLine1: nullable(draft.addressLine1),
    addressLine2: nullable(draft.addressLine2),
    city: nullable(draft.city),
    region: nullable(draft.region),
    postalCode: nullable(draft.postalCode),
  };
}

function activeBranchName(branches: readonly WorkspaceBranch[], branchId: string): string {
  return branches.find((branch) => branch.id === branchId)?.name ?? "Branch";
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function friendlyPlatform(platform: string): string {
  return platform.charAt(0) + platform.slice(1).toLowerCase();
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
