"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Badge, Banner, PageHeader, Section } from "../../components/admin-ui";
import { useAdminResource, usePlatformAdminSession } from "../../components/platform-admin-session";

const ROLES = ["SUPER_ADMIN", "PLATFORM_ADMIN", "DEVELOPER", "SUPPORT", "BILLING", "OPERATIONS"] as const;
type AdminRole = typeof ROLES[number];
type AdminSummary = {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  credentialProvisioned: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function AdministratorsPage() {
  const { adminUser, apiFetch } = usePlatformAdminSession();
  const { data, loading, error, reload } = useAdminResource<{ admins: AdminSummary[] }>("/api/admin/admins");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminSummary | null>(null);
  const [reason, setReason] = useState("");
  const [role, setRole] = useState<AdminRole>("SUPPORT");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManage = Boolean(adminUser && adminUser.role === "SUPER_ADMIN");
  const admins = data?.admins ?? [];
  const filtered = useMemo(
    () => admins.filter((item) => `${item.displayName} ${item.email} ${item.role}`.toLowerCase().includes(query.toLowerCase())),
    [admins, query],
  );

  function manage(item: AdminSummary) {
    setSelected(item);
    setRole(item.role);
    setReason("");
    document.getElementById("admin-manager")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      displayName: String(data.get("displayName") ?? ""),
      email: String(data.get("email") ?? ""),
      role: String(data.get("role") ?? "SUPPORT"),
      reason: String(data.get("reason") ?? ""),
    };
    if (!window.confirm(`Create platform administrator ${payload.email}? Credentials will still require secure provisioning.`)) return;
    setSaving(true); setActionError(null); setNotice(null);
    try {
      const response = await apiFetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Administrator could not be created");
      form.reset(); await reload(); setNotice("Administrator identity created. Complete secure provisioning before first sign-in.");
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Administrator could not be created");
    } finally { setSaving(false); }
  }

  async function changeRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (!window.confirm(`Change ${selected.displayName}'s platform role to ${role.replaceAll("_", " ")}?`)) return;
    setSaving(true); setActionError(null); setNotice(null);
    try {
      const response = await apiFetch(`/api/admin/admins/${selected.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, reason }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; admin?: AdminSummary };
      if (!response.ok) throw new Error(body.message ?? "Administrator role could not be changed");
      await reload(); setSelected(body.admin ?? null); setReason(""); setNotice("Administrator role updated and audited.");
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Administrator role could not be changed");
    } finally { setSaving(false); }
  }

  async function changeStatus() {
    if (!selected) return;
    const nextActive = !selected.active;
    if (!reason.trim()) { setActionError("Enter a reason before changing administrator access."); return; }
    if (!window.confirm(`${nextActive ? "Reactivate" : "Deactivate"} ${selected.displayName}? ${nextActive ? "Access can resume once credentials are provisioned." : "All active sessions will be revoked immediately."}`)) return;
    setSaving(true); setActionError(null); setNotice(null);
    try {
      const response = await apiFetch(`/api/admin/admins/${selected.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive, reason }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; admin?: AdminSummary };
      if (!response.ok) throw new Error(body.message ?? "Administrator access could not be changed");
      await reload(); setSelected(body.admin ?? null); setReason(""); setNotice(`Administrator ${nextActive ? "reactivated" : "deactivated"}.`);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Administrator access could not be changed");
    } finally { setSaving(false); }
  }

  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Security / Administrators"
        title="Platform administrators"
        subtitle="Control platform roles and access without exposing credentials. New identities require the secure provisioning path before first sign-in."
      />
      {notice ? <Banner title="Updated">{notice}</Banner> : null}
      {error || actionError ? <Banner tone="danger" title="Action needed">{error ?? actionError}</Banner> : null}
      <Banner title="Credential safety">
        This portal never creates or displays login secrets. “Provisioning required” means an authorized operator must complete secure provisioning outside the browser.
      </Banner>

      <div className="admin-billing-toolbar">
        <input className="admin-field__input" aria-label="Search administrators" placeholder="Search administrator, email or role" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="admin-secondary-button" type="button" onClick={() => void reload()}>Refresh</button>
      </div>

      {loading ? <div className="admin-api-state" role="status">Loading platform administrators…</div> : null}
      {!loading && filtered.length === 0 ? <div className="admin-api-state">No administrators match this view.</div> : null}
      <div className="admin-admin-grid">
        {filtered.map((item) => (
          <article className="admin-admin-card" key={item.id}>
            <div className="admin-admin-card__head">
              <div><strong>{item.displayName}</strong><small>{item.email}</small></div>
              <Badge tone={item.active ? "positive" : "neutral"}>{item.active ? "active" : "inactive"}</Badge>
            </div>
            <div className="admin-admin-card__meta">
              <span>{item.role.replaceAll("_", " ")}</span>
              <span>{item.credentialProvisioned ? "Credentials provisioned" : "Provisioning required"}</span>
              <span>Last login: {item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString() : "Never"}</span>
            </div>
            {canManage ? <button className="admin-secondary-button" type="button" onClick={() => manage(item)}>Manage</button> : null}
          </article>
        ))}
      </div>

      {canManage ? (
        <Section title="Create administrator" sub="Create identity and role state only. Login credentials are completed through secure provisioning." padded>
          <form className="admin-billing-form" onSubmit={createAdmin}>
            <label className="admin-field"><span className="admin-field__label">Display name</span><input className="admin-field__input" name="displayName" required /></label>
            <label className="admin-field"><span className="admin-field__label">Email</span><input className="admin-field__input" name="email" type="email" required /></label>
            <label className="admin-field"><span className="admin-field__label">Role</span><select className="admin-field__input" name="role" defaultValue="SUPPORT">{ROLES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
            <label className="admin-field"><span className="admin-field__label">Reason</span><input className="admin-field__input" name="reason" required placeholder="Why is this administrator being added?" /></label>
            <div className="admin-profile-actions admin-billing-form__wide"><button className="admin-primary-button" disabled={saving} type="submit">{saving ? "Creating…" : "Create administrator"}</button></div>
          </form>
        </Section>
      ) : null}

      {selected && canManage ? (
        <section id="admin-manager">
          <Section title={`Manage ${selected.displayName}`} sub="Role and access changes are audited. The last capable SUPER_ADMIN is protected server-side." padded>
            <form className="admin-admin-manager" onSubmit={changeRole}>
              <label className="admin-field"><span className="admin-field__label">Role</span><select className="admin-field__input" value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>{ROLES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
              <label className="admin-field"><span className="admin-field__label">Reason</span><input className="admin-field__input" value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Reason for this security change" /></label>
              <div className="admin-profile-actions admin-admin-manager__actions">
                <button className="admin-primary-button" disabled={saving} type="submit">Save role</button>
                <button className="admin-secondary-button" disabled={saving} type="button" onClick={() => void changeStatus()}>{selected.active ? "Deactivate" : "Reactivate"}</button>
                <button className="admin-secondary-button" type="button" onClick={() => { setSelected(null); setReason(""); }}>Cancel</button>
              </div>
            </form>
          </Section>
        </section>
      ) : null}
    </div>
  );
}
