"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Badge, Banner, PageHeader, Section } from "../../components/admin-ui";
import { useAdminResource, usePlatformAdminSession } from "../../components/platform-admin-session";

const WRITE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "BILLING"]);
type Interval = "MONTHLY" | "ANNUAL" | "CUSTOM";
type Plan = {
  id: string; code: string; name: string; description: string | null; currencyCode: string; amountMinor: number;
  billingInterval: Interval; trialDays: number; public: boolean; active: boolean; updatedAt: string;
  entitlements: Array<{ code: string; value: unknown }>;
};

type PlanDraft = {
  code: string; name: string; description: string; currencyCode: string; amountMajor: string;
  billingInterval: Interval; trialDays: string; public: boolean; active: boolean; reason: string;
};

const blankDraft: PlanDraft = {
  code: "", name: "", description: "", currencyCode: "GHS", amountMajor: "", billingInterval: "MONTHLY",
  trialDays: "0", public: true, active: true, reason: "",
};

export default function PlansPage() {
  const { adminUser, apiFetch } = usePlatformAdminSession();
  const { data, loading, error, reload } = useAdminResource<{ plans: Plan[] }>("/api/admin/plans");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(blankDraft);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = Boolean(adminUser && WRITE_ROLES.has(adminUser.role));
  const plans = data?.plans ?? [];
  const filtered = useMemo(() => plans.filter((plan) => `${plan.code} ${plan.name}`.toLowerCase().includes(query.toLowerCase())), [plans, query]);

  function edit(plan: Plan) {
    setEditingId(plan.id);
    setDraft({
      code: plan.code, name: plan.name, description: plan.description ?? "", currencyCode: plan.currencyCode,
      amountMajor: (plan.amountMinor / 100).toFixed(2), billingInterval: plan.billingInterval,
      trialDays: String(plan.trialDays), public: plan.public, active: plan.active, reason: "",
    });
    document.getElementById("plan-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = majorToMinor(draft.amountMajor);
    if (amountMinor === null) { setActionError("Enter a valid non-negative price."); return; }
    const current = editingId ? plans.find((plan) => plan.id === editingId) : null;
    const verb = current ? "update" : "create";
    if (!window.confirm(`Confirm ${verb} plan ${draft.name || draft.code}? This changes what can be assigned to tenants.`)) return;
    setSaving(true); setActionError(null); setNotice(null);
    try {
      const response = await apiFetch(current ? `/api/admin/plans/${current.id}` : "/api/admin/plans", {
        method: current ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code, name: draft.name, description: draft.description || null, currencyCode: draft.currencyCode,
          amountMinor, billingInterval: draft.billingInterval, trialDays: Number(draft.trialDays || 0), public: draft.public,
          active: draft.active, reason: draft.reason, ...(current ? { expectedUpdatedAt: current.updatedAt } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Could not ${verb} plan`);
      setDraft(blankDraft); setEditingId(null); await reload(); setNotice(`Plan ${verb}d successfully.`);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Plan could not be saved");
    } finally { setSaving(false); }
  }

  return (
    <div className="admin-page">
      <PageHeader eyebrow="Billing / Plans" title="Plans & pricing" subtitle="Create clear packages, pricing and tenant entitlements without changing historical invoices." />
      {notice ? <Banner title="Updated">{notice}</Banner> : null}
      {error || actionError ? <Banner tone="danger" title="Action needed">{error ?? actionError}</Banner> : null}
      <div className="admin-billing-toolbar">
        <input className="admin-field__input" aria-label="Search plans" placeholder="Search plans" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="admin-secondary-button" type="button" onClick={() => void reload()}>Refresh</button>
        {canWrite ? <button className="admin-primary-button" type="button" onClick={() => { setEditingId(null); setDraft(blankDraft); document.getElementById("plan-editor")?.scrollIntoView({ behavior: "smooth" }); }}>New plan</button> : null}
      </div>
      {loading ? <div className="admin-api-state" role="status">Loading plans…</div> : null}
      {!loading && filtered.length === 0 ? <div className="admin-api-state">No plans match this view.</div> : null}
      <div className="admin-billing-grid">
        {filtered.map((plan) => (
          <article className="admin-billing-card" key={plan.id}>
            <div className="admin-billing-card__head"><div><strong>{plan.name}</strong><small>{plan.code}</small></div><Badge tone={plan.active ? "positive" : "neutral"}>{plan.active ? "active" : "inactive"}</Badge></div>
            <div className="admin-billing-card__amount">{formatMinor(plan.amountMinor, plan.currencyCode)} <small>/ {plan.billingInterval.toLowerCase()}</small></div>
            <div className="admin-billing-card__facts"><span>{plan.trialDays} trial days</span><span>{plan.public ? "Public" : "Private"}</span><span>{plan.entitlements.length} entitlements</span></div>
            {plan.description ? <p>{plan.description}</p> : null}
            {plan.entitlements.length ? <details><summary>Entitlements</summary><div className="admin-billing-tags">{plan.entitlements.map((item) => <span key={item.code}>{item.code}: {String(item.value)}</span>)}</div></details> : null}
            {canWrite ? <button className="admin-secondary-button" type="button" onClick={() => edit(plan)}>Edit plan</button> : null}
          </article>
        ))}
      </div>
      {canWrite ? (
        <section id="plan-editor">
          <Section title={editingId ? "Edit plan" : "Create plan"} sub="Money is stored as integer minor units; this form accepts normal major-unit prices." padded>
            <form className="admin-billing-form" onSubmit={save}>
              <label className="admin-field"><span className="admin-field__label">Plan code</span><input className="admin-field__input" required value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} /></label>
              <label className="admin-field"><span className="admin-field__label">Name</span><input className="admin-field__input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label className="admin-field"><span className="admin-field__label">Price</span><input className="admin-field__input" inputMode="decimal" required value={draft.amountMajor} onChange={(e) => setDraft({ ...draft, amountMajor: e.target.value })} /></label>
              <label className="admin-field"><span className="admin-field__label">Currency</span><input className="admin-field__input" maxLength={3} required value={draft.currencyCode} onChange={(e) => setDraft({ ...draft, currencyCode: e.target.value.toUpperCase() })} /></label>
              <label className="admin-field"><span className="admin-field__label">Billing interval</span><select className="admin-field__input" value={draft.billingInterval} onChange={(e) => setDraft({ ...draft, billingInterval: e.target.value as Interval })}><option value="MONTHLY">Monthly</option><option value="ANNUAL">Annual</option><option value="CUSTOM">Custom</option></select></label>
              <label className="admin-field"><span className="admin-field__label">Trial days</span><input className="admin-field__input" type="number" min="0" value={draft.trialDays} onChange={(e) => setDraft({ ...draft, trialDays: e.target.value })} /></label>
              <label className="admin-field admin-billing-form__wide"><span className="admin-field__label">Description</span><textarea className="admin-field__input admin-billing-textarea" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              <label className="admin-field admin-billing-form__wide"><span className="admin-field__label">Reason</span><input className="admin-field__input" required placeholder="Why is this pricing/package change being made?" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
              <div className="admin-billing-checks admin-billing-form__wide"><label><input type="checkbox" checked={draft.public} onChange={(e) => setDraft({ ...draft, public: e.target.checked })} /> Public plan</label><label><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label></div>
              <div className="admin-profile-actions admin-billing-form__wide"><button className="admin-primary-button" disabled={saving} type="submit">{saving ? "Saving…" : editingId ? "Save plan changes" : "Create plan"}</button></div>
            </form>
          </Section>
        </section>
      ) : null}
    </div>
  );
}

function majorToMinor(value: string): number | null { const match = value.trim().match(/^(\d+)(?:\.(\d{0,2}))?$/); if (!match) return null; const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")); return Number.isSafeInteger(minor) ? minor : null; }
function formatMinor(amountMinor: number, currencyCode: string) { try { return new Intl.NumberFormat("en-GH", { style: "currency", currency: currencyCode }).format(amountMinor / 100); } catch { return `${currencyCode} ${(amountMinor / 100).toFixed(2)}`; } }
