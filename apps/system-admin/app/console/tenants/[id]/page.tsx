"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge, Banner, PageHeader, Section } from "../../../components/admin-ui";
import { IconBuilding, IconRefresh } from "../../../components/icons";
import { useAdminResource, usePlatformAdminSession } from "../../../components/platform-admin-session";

const LIFECYCLE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "OPERATIONS"]);

interface Tenant360 {
  id: string;
  name: string;
  businessType: string;
  status: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  deviceCount: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  branches: Array<{ id: string; name: string; code: string; active: boolean; timezone: string }>;
  subscription: null | {
    id: string;
    planId: string;
    planCode: string;
    planName: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  entitlementOverrideCount: number;
  access: {
    staffTotal: number;
    activeStaff: number;
    membershipTotal: number;
    activeMemberships: number;
    roles: Array<{ role: string; staffCount: number; activeStaffCount: number; membershipCount: number; activeMembershipCount: number }>;
    membershipStatuses: Array<{ status: string; count: number }>;
  };
  contacts: Array<{
    userId: string;
    staffId: string | null;
    displayName: string;
    email: string | null;
    phoneE164: string | null;
    role: string;
    membershipStatus: string;
  }>;
  devices: Array<{
    id: string;
    deviceKey: string;
    branchName: string | null;
    platform: string;
    appVersion: string;
    releaseChannel: string;
    status: string;
    lastSeenAt: string | null;
    lastSyncAt: string | null;
    health: "ONLINE" | "STALE" | "UNKNOWN";
  }>;
  billing: {
    available: boolean;
    openInvoiceCount: number | null;
    overdueInvoiceCount: number | null;
    openBalanceMinor: number | null;
    overdueBalanceMinor: number | null;
  };
  recentActivity: Array<{
    id: string;
    platformUserDisplayName: string | null;
    eventType: string;
    entityType: string;
    reason: string | null;
    occurredAt: string;
  }>;
}

const sections = [
  ["tenant-overview", "Overview"],
  ["tenant-access", "Branches & access"],
  ["tenant-subscription", "Subscription & entitlements"],
  ["tenant-billing", "Billing"],
  ["tenant-devices", "Devices & sync"],
  ["tenant-activity", "Platform activity"],
  ["tenant-ai", "AI insights"],
] as const;

export default function Tenant360Page() {
  const params = useParams<{ id: string }>();
  const tenantId = params.id;
  const { adminUser, apiFetch } = usePlatformAdminSession();
  const { data, loading, error: loadError, reload } = useAdminResource<{ tenant: Tenant360 }>(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/overview`,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const tenant = data?.tenant;
  const canManageLifecycle = Boolean(adminUser && LIFECYCLE_ROLES.has(adminUser.role));

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) return;
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if (!reason) {
      setError("A reason is required before changing tenant status.");
      return;
    }
    const status = tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setChanging(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason, expectedUpdatedAt: tenant.updatedAt }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Tenant status could not be changed");
      form.reset();
      await reload();
      setNotice(status === "ACTIVE" ? "Tenant reactivated." : "Tenant suspended.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Tenant status could not be changed");
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Tenants / Tenant 360"
        title={tenant?.name ?? "Tenant 360"}
        subtitle="Platform-level business health, access, subscription, devices and lifecycle controls without entering the tenant workspace."
        actions={(
          <div className="admin-tenant-header-actions">
            <Link className="admin-secondary-button" href="/console/tenants">Back to tenants</Link>
            <button type="button" className="admin-secondary-button" onClick={() => void reload()}><IconRefresh aria-hidden="true" /> Refresh</button>
          </div>
        )}
      />

      {notice ? <Banner title="Updated">{notice}</Banner> : null}
      {error || loadError ? <Banner tone="danger" title="Action needed">{error ?? loadError}</Banner> : null}
      {loading && !tenant ? <div className="admin-api-state" role="status">Loading Tenant 360…</div> : null}

      {tenant ? (
        <>
          <section className="admin-tenant-hero" aria-label="Tenant summary">
            <div className="admin-tenant-hero__identity">
              <div className="admin-tenant-hero__mark" aria-hidden="true"><IconBuilding /></div>
              <div>
                <div className="admin-tenant-hero__title"><h2>{tenant.name}</h2><Badge tone={statusTone(tenant.status)}>{tenant.status.toLowerCase()}</Badge></div>
                <p>{humanize(tenant.businessType)} · {tenant.countryCode} · {tenant.currencyCode} · {tenant.timezone}</p>
                <small>Tenant ID {tenant.id}</small>
              </div>
            </div>
            <div className="admin-tenant-hero__metrics">
              <Metric label="Branches" value={tenant.branchCount} />
              <Metric label="Devices" value={tenant.deviceCount} />
              <Metric label="Active access" value={tenant.access.activeMemberships} />
              <Metric label="Plan" value={tenant.planName ?? "No plan"} />
            </div>
          </section>

          <nav className="admin-tenant-section-nav" aria-label="Tenant sections">
            {sections.map(([href, label]) => <a key={href} href={`#${href}`}>{label}</a>)}
          </nav>

          <div className="admin-tenant-grid">
            <div className="admin-tenant-main">
              <section id="tenant-overview">
                <Section title="Overview" sub="Authoritative platform identity and recent state." padded>
                  <div className="admin-tenant-facts">
                    <Fact label="Status" value={tenant.status} />
                    <Fact label="Business type" value={humanize(tenant.businessType)} />
                    <Fact label="Country / currency" value={`${tenant.countryCode} / ${tenant.currencyCode}`} />
                    <Fact label="Timezone" value={tenant.timezone} />
                    <Fact label="Created" value={formatDate(tenant.createdAt)} />
                    <Fact label="Updated" value={formatDate(tenant.updatedAt)} />
                    <Fact label="Last device activity" value={formatDate(tenant.lastSeenAt)} />
                    <Fact label="Entitlement overrides" value={String(tenant.entitlementOverrideCount)} />
                  </div>
                </Section>
              </section>

              <section id="tenant-access">
                <Section title="Branches & access" sub="Branch state, staff coverage, memberships and owner/admin contacts." padded>
                  <div className="admin-tenant-subgrid">
                    <div>
                      <h3>Branches</h3>
                      <div className="admin-tenant-stack">
                        {tenant.branches.map((branch) => (
                          <article className="admin-tenant-row" key={branch.id}>
                            <div><strong>{branch.name}</strong><span>{branch.code} · {branch.timezone}</span></div>
                            <Badge tone={branch.active ? "positive" : "neutral"}>{branch.active ? "active" : "inactive"}</Badge>
                          </article>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3>Access summary</h3>
                      <div className="admin-tenant-facts">
                        <Fact label="Staff" value={`${tenant.access.activeStaff}/${tenant.access.staffTotal} active`} />
                        <Fact label="Memberships" value={`${tenant.access.activeMemberships}/${tenant.access.membershipTotal} active`} />
                      </div>
                      <div className="admin-tenant-stack admin-tenant-stack--compact">
                        {tenant.access.roles.map((role) => (
                          <article className="admin-tenant-row" key={role.role}>
                            <strong>{humanize(role.role)}</strong>
                            <span>{role.activeMembershipCount}/{role.membershipCount} active access · {role.activeStaffCount}/{role.staffCount} active staff</span>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="admin-tenant-contact-grid">
                    {tenant.contacts.map((contact) => (
                      <article className="admin-tenant-contact" key={contact.userId}>
                        <div><strong>{contact.displayName}</strong><Badge tone={contact.membershipStatus === "ACTIVE" ? "positive" : "neutral"}>{humanize(contact.role)}</Badge></div>
                        <span>{contact.email ?? "No email"}</span>
                        <small>{contact.phoneE164 ?? "No phone"} · {humanize(contact.membershipStatus)}</small>
                      </article>
                    ))}
                  </div>
                </Section>
              </section>

              <section id="tenant-subscription">
                <Section title="Subscription & entitlements" sub="Current plan state and tenant-specific entitlement overrides." padded>
                  {tenant.subscription ? (
                    <div className="admin-tenant-facts">
                      <Fact label="Plan" value={`${tenant.subscription.planName} (${tenant.subscription.planCode})`} />
                      <Fact label="Subscription status" value={humanize(tenant.subscription.status)} />
                      <Fact label="Trial ends" value={formatDate(tenant.subscription.trialEndsAt)} />
                      <Fact label="Period ends" value={formatDate(tenant.subscription.currentPeriodEndsAt)} />
                      <Fact label="Cancel at period end" value={tenant.subscription.cancelAtPeriodEnd ? "Yes" : "No"} />
                      <Fact label="Overrides" value={String(tenant.entitlementOverrideCount)} />
                    </div>
                  ) : <p className="admin-section__sub">No subscription is assigned to this tenant.</p>}
                </Section>
              </section>

              <section id="tenant-billing">
                <Section title="Billing" sub="TradeOS SaaS billing is intentionally separate from tenant POS and cashbook payments." padded>
                  {tenant.billing.available ? (
                    <div className="admin-tenant-facts">
                      <Fact label="Open invoices" value={String(tenant.billing.openInvoiceCount ?? 0)} />
                      <Fact label="Overdue invoices" value={String(tenant.billing.overdueInvoiceCount ?? 0)} />
                      <Fact label="Open balance" value={minorMoney(tenant.billing.openBalanceMinor, tenant.currencyCode)} />
                      <Fact label="Overdue balance" value={minorMoney(tenant.billing.overdueBalanceMinor, tenant.currencyCode)} />
                    </div>
                  ) : (
                    <div className="admin-tenant-pending">
                      <strong>Platform billing ledger not connected yet</strong>
                      <p>No zero balances are fabricated. Authoritative SaaS invoices and payment standing will appear here when the platform billing ledger is enabled.</p>
                    </div>
                  )}
                </Section>
              </section>

              <section id="tenant-devices">
                <Section title="Devices & sync" sub="Registered client versions, branch assignment and latest activity." padded>
                  <div className="admin-tenant-stack">
                    {tenant.devices.map((device) => (
                      <article className="admin-tenant-row" key={device.id}>
                        <div>
                          <strong>{device.platform} · {device.deviceKey}</strong>
                          <span>{device.branchName ?? "Business-wide"} · v{device.appVersion} · {device.releaseChannel}</span>
                          <small>Seen {formatDate(device.lastSeenAt)} · synced {formatDate(device.lastSyncAt)}</small>
                        </div>
                        <Badge tone={device.health === "ONLINE" ? "positive" : device.health === "STALE" ? "warning" : "neutral"}>{device.health.toLowerCase()}</Badge>
                      </article>
                    ))}
                    {tenant.devices.length === 0 ? <p className="admin-section__sub">No registered devices.</p> : null}
                  </div>
                </Section>
              </section>

              <section id="tenant-activity">
                <Section title="Platform activity" sub="Recent privileged platform events for this tenant." padded>
                  <div className="admin-tenant-stack">
                    {tenant.recentActivity.map((activity) => (
                      <article className="admin-tenant-row" key={activity.id}>
                        <div><strong>{humanize(activity.eventType)}</strong><span>{activity.reason ?? humanize(activity.entityType)}</span></div>
                        <small>{activity.platformUserDisplayName ?? "System"} · {formatDate(activity.occurredAt)}</small>
                      </article>
                    ))}
                    {tenant.recentActivity.length === 0 ? <p className="admin-section__sub">No platform activity recorded for this tenant yet.</p> : null}
                  </div>
                </Section>
              </section>

              <section id="tenant-ai">
                <Section title="AI insights" sub="Evidence-backed platform intelligence for this tenant." padded>
                  <div className="admin-tenant-pending">
                    <strong>Deterministic signals first</strong>
                    <p>The AI operations layer will summarize subscription, billing, device and support signals here. Until that service is enabled, this section deliberately does not invent findings.</p>
                  </div>
                </Section>
              </section>
            </div>

            <aside className="admin-tenant-aside">
              <Section title="Tenant lifecycle" sub="High-impact state changes require an explicit reason and are audited." padded>
                <div className="admin-tenant-lifecycle">
                  <div><span>Current status</span><Badge tone={statusTone(tenant.status)}>{tenant.status.toLowerCase()}</Badge></div>
                  {canManageLifecycle && (tenant.status === "ACTIVE" || tenant.status === "SUSPENDED") ? (
                    <form onSubmit={changeStatus}>
                      <label className="admin-field">
                        <span className="admin-field__label">Reason</span>
                        <textarea className="admin-field__input admin-tenant-reason" name="reason" rows={4} maxLength={500} required placeholder={tenant.status === "ACTIVE" ? "Why should this tenant be suspended?" : "Why should this tenant be reactivated?"} />
                      </label>
                      <button className={tenant.status === "ACTIVE" ? "admin-danger-button" : "admin-primary-button"} type="submit" disabled={changing}>
                        {changing ? "Updating…" : tenant.status === "ACTIVE" ? "Suspend tenant" : "Reactivate tenant"}
                      </button>
                    </form>
                  ) : (
                    <p>{tenant.status === "CLOSED" ? "Closed tenants cannot be reopened from this workflow." : "Your platform role has read-only access to tenant lifecycle state."}</p>
                  )}
                </div>
              </Section>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="admin-tenant-metric"><span>{label}</span><strong>{value}</strong></div>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="admin-tenant-fact"><span>{label}</span><strong>{value}</strong></div>;
}
function statusTone(status: string): "positive" | "warning" | "neutral" {
  if (status === "ACTIVE") return "positive";
  if (status === "SUSPENDED") return "warning";
  return "neutral";
}
function humanize(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not available";
}
function minorMoney(value: number | null, currency: string): string {
  return value === null ? "Not available" : `${currency} ${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
