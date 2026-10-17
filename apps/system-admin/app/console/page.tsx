"use client";

import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { Banner, PageHeader, Section } from "../components/admin-ui";
import { StatCard, StatCardGrid } from "../components/stat-card";
import { IconActivity, IconBuilding, IconDevices, IconFlag, IconInfo, IconRelease } from "../components/icons";
import { useAdminResource, usePlatformAdminSession } from "../components/platform-admin-session";
import { AiInsightCard } from "../components/ai-insight-card";

interface CurrencyAmount {
  currencyCode: string;
  amountMinor: number;
}

interface PlatformMetrics {
  generatedAt: string;
  tenants: { total: number; active: number; suspended: number; closed: number };
  subscriptions: { trialing: number; active: number; pastDue: number; paused: number; canceled: number; expired: number };
  recurringRevenue: Array<{ currencyCode: string; mrrMinor: number; arrMinor: number }>;
  invoices: {
    openCount: number;
    overdueCount: number;
    openBalanceByCurrency: CurrencyAmount[];
    overdueBalanceByCurrency: CurrencyAmount[];
  };
  collections: {
    succeededCount: number;
    failedCount: number;
    succeededByCurrency: CurrencyAmount[];
    failedByCurrency: CurrencyAmount[];
  };
  devices: { total: number; online: number; stale: number; unknown: number; syncRiskTenantCount: number };
  releases: { draft: number; rollout: number; active: number; withdrawn: number };
}

interface AttentionItem {
  id: string;
  businessId: string | null;
  severity: string;
  title: string;
  summary: string;
  evidence: unknown[];
  lastSeenAt: string;
}

interface BriefingRecommendation {
  id: string;
  title: string;
  summary: string;
  priority: string;
  businessId: string | null;
  evidence: unknown[];
}

interface OperationsBriefingData {
  generatedAt: string;
  headline: string;
  summary: string;
  recommendations: BriefingRecommendation[];
}

export default function ConsoleOverviewPage() {
  const resource = useAdminResource<{ metrics: PlatformMetrics }>("/api/admin/metrics");
  const metrics = resource.data?.metrics;
  const loading = resource.loading;

  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="TradeOS control plane"
        title="Platform command center"
        subtitle="Live tenant, subscription, SaaS billing, device and release health from the authoritative control-plane data model."
      />
      <Banner tone="info" icon={IconInfo} title="Live control-plane metrics">
        <span className="admin-banner__text">
          Financial values remain separated by currency. Privileged actions are protected by server-side roles, confirmations and platform audit events.
        </span>
      </Banner>
      {resource.error ? <div className="admin-api-state admin-api-state--error" role="alert">{resource.error}</div> : null}
      {loading ? <div className="admin-api-state" role="status">Loading platform metrics…</div> : null}

      <OperationsBriefing />

      <StatCardGrid>
        <StatCard label="Active tenants" value={loading ? "Loading" : String(metrics?.tenants.active ?? 0)} hint={`${metrics?.tenants.total ?? 0} total tenants`} icon={IconBuilding} tone={loading ? "pending" : "default"} />
        <StatCard label="Active subscriptions" value={loading ? "Loading" : String(metrics?.subscriptions.active ?? 0)} hint={`${metrics?.subscriptions.trialing ?? 0} trialing · ${metrics?.subscriptions.pastDue ?? 0} past due`} icon={IconActivity} tone={loading ? "pending" : "default"} />
        <StatCard label="Open invoices" value={loading ? "Loading" : String(metrics?.invoices.openCount ?? 0)} hint={`${metrics?.invoices.overdueCount ?? 0} overdue`} icon={IconInfo} tone={loading ? "pending" : "default"} />
        <StatCard label="Collection failures" value={loading ? "Loading" : String(metrics?.collections.failedCount ?? 0)} hint={`${metrics?.collections.succeededCount ?? 0} successful collections`} icon={IconActivity} tone={loading ? "pending" : "default"} />
        <StatCard label="Devices online" value={loading ? "Loading" : String(metrics?.devices.online ?? 0)} hint={`${metrics?.devices.total ?? 0} active registered devices`} icon={IconDevices} tone={loading ? "pending" : "default"} />
        <StatCard label="Sync-risk tenants" value={loading ? "Loading" : String(metrics?.devices.syncRiskTenantCount ?? 0)} hint={`${metrics?.devices.stale ?? 0} stale · ${metrics?.devices.unknown ?? 0} unseen devices`} icon={IconActivity} tone={loading ? "pending" : "default"} />
        <StatCard label="Active releases" value={loading ? "Loading" : String(metrics?.releases.active ?? 0)} hint={`${metrics?.releases.rollout ?? 0} in rollout`} icon={IconRelease} tone={loading ? "pending" : "default"} />
        <StatCard label="Suspended tenants" value={loading ? "Loading" : String(metrics?.tenants.suspended ?? 0)} hint={`${metrics?.tenants.closed ?? 0} closed tenants`} icon={IconBuilding} tone={loading ? "pending" : "default"} />
      </StatCardGrid>

      <Section title="Recurring revenue" sub="Normalized MRR and ARR include ACTIVE monthly and annual subscriptions only. Currencies are never combined.">
        {!loading && (metrics?.recurringRevenue.length ?? 0) === 0 ? <div className="admin-api-state">No active monthly or annual recurring revenue yet.</div> : null}
        <div className="admin-billing-grid">
          {(metrics?.recurringRevenue ?? []).map((row) => (
            <article className="admin-billing-card" key={row.currencyCode}>
              <div className="admin-billing-card__head"><div><strong>{row.currencyCode} recurring revenue</strong><small>Authoritative subscription plans</small></div></div>
              <div className="admin-billing-detail">
                <MetricFact label="MRR" value={formatMoney(row.mrrMinor, row.currencyCode)} />
                <MetricFact label="ARR" value={formatMoney(row.arrMinor, row.currencyCode)} />
                <MetricFact label="Currency" value={row.currencyCode} />
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Billing exposure" sub="Open and overdue SaaS invoice balances plus current payment outcomes, all separated by currency.">
        <div className="admin-billing-grid">
          <CurrencyCard title="Open invoice balance" rows={metrics?.invoices.openBalanceByCurrency ?? []} empty="No open invoice balance" />
          <CurrencyCard title="Overdue invoice balance" rows={metrics?.invoices.overdueBalanceByCurrency ?? []} empty="No overdue invoice balance" />
          <CurrencyCard title="Successful collections" rows={metrics?.collections.succeededByCurrency ?? []} empty="No successful collections recorded" />
          <CurrencyCard title="Failed collections" rows={metrics?.collections.failedByCurrency ?? []} empty="No failed collection value" />
        </div>
      </Section>

      <Section title="Admin areas" sub={metrics ? `Metrics refreshed ${new Date(metrics.generatedAt).toLocaleString()}. Open an area for operational detail or controlled actions.` : "Open an area for operational detail or controlled actions."}>
        <div className="admin-quicklinks">
          <QuickLink href="/console/automation" icon={IconActivity} title="AI Operations" desc="Grounded briefings, deterministic attention, approval-controlled automation and run history." />
          <QuickLink href="/console/tenants" icon={IconBuilding} title="Tenant 360" desc="Business state, access, subscriptions, billing, devices and recent activity." />
          <QuickLink href="/console/subscriptions" icon={IconActivity} title="Subscriptions" desc="Assign plans and manage subscription lifecycle with audited reasons." />
          <QuickLink href="/console/billing/invoices" icon={IconInfo} title="Invoices" desc="Inspect SaaS billing exposure, due dates and payment state." />
          <QuickLink href="/console/billing/payments" icon={IconActivity} title="Payments" desc="Review provider collections and controlled reconciliation outcomes." />
          <QuickLink href="/console/devices" icon={IconDevices} title="Devices & sync" desc="Registered device versions, release channels, last-seen and last-sync telemetry." />
          <QuickLink href="/console/releases" icon={IconRelease} title="Client releases" desc="Published client versions, support floors and rollout state." />
          <QuickLink href="/console/flags" icon={IconFlag} title="Feature flags" desc="Global and tenant-scoped feature flag state and configuration." />
          <QuickLink href="/console/admins" icon={IconInfo} title="Administrators" desc="Platform roles, access state and credential provisioning status." />
        </div>
      </Section>
    </div>
  );
}

function OperationsBriefing() {
  const { apiFetch } = usePlatformAdminSession();
  const attention = useAdminResource<{ items: AttentionItem[] }>("/api/admin/attention");
  const [briefing, setBriefing] = useState<OperationsBriefingData | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAiLoading(true);
    setAiError(null);
    void apiFetch("/api/admin/intelligence/briefing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as OperationsBriefingData & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `AI briefing failed (${response.status})`);
      if (active) setBriefing(body);
    }).catch((error: unknown) => {
      if (active) setAiError(error instanceof Error ? error.message : "AI briefing is unavailable.");
    }).finally(() => {
      if (active) setAiLoading(false);
    });
    return () => { active = false; };
  }, [apiFetch]);

  return (
    <Section
      title="AI operations briefing"
      sub="Grounded AI interpretation sits on top of deterministic control-plane facts; it never replaces them."
      actions={<Link className="admin-secondary-button" href="/console/automation">Open AI Operations</Link>}
    >
      <div className="admin-ai-category-grid" aria-label="Briefing priorities">
        <span>Urgent now</span>
        <span>Revenue & billing risk</span>
        <span>Tenant health</span>
        <span>Sync & device health</span>
      </div>

      {aiLoading ? <div className="admin-api-state" role="status">Preparing grounded operations briefing…</div> : null}
      {aiError ? (
        <Banner tone="warning" icon={IconInfo} title="AI unavailable">
          <span className="admin-banner__text">Deterministic attention remains available. {aiError}</span>
        </Banner>
      ) : null}
      {briefing ? (
        <div className="admin-ai-answer">
          <span className="admin-ai-kicker">{briefing.headline}</span>
          <p>{briefing.summary}</p>
          <small>Generated {new Date(briefing.generatedAt).toLocaleString()}</small>
          <div className="admin-ai-grid">
            {briefing.recommendations.slice(0, 4).map((recommendation) => (
              <AiInsightCard
                key={recommendation.id}
                finding={recommendation.title}
                severity={recommendation.priority}
                evidence={recommendation.evidence}
                recommendation={recommendation.summary}
                recordHref={recommendation.businessId ? `/console/tenants/${recommendation.businessId}` : "/console/automation"}
                generatedAt={briefing.generatedAt}
              />
            ))}
          </div>
        </div>
      ) : null}

      {attention.error ? <div className="admin-api-state admin-api-state--error">{attention.error}</div> : null}
      {attention.loading ? <div className="admin-api-state">Loading deterministic attention…</div> : null}
      {!attention.loading && (attention.data?.items.length ?? 0) === 0 ? <div className="admin-api-state">No deterministic attention items are open.</div> : null}
      <div className="admin-ai-grid">
        {(attention.data?.items ?? []).slice(0, 4).map((item) => (
          <AiInsightCard
            key={item.id}
            finding={item.title}
            severity={item.severity}
            evidence={item.evidence}
            recommendation={item.summary}
            recordHref={item.businessId ? `/console/tenants/${item.businessId}` : "/console/automation"}
            generatedAt={item.lastSeenAt}
          />
        ))}
      </div>
    </Section>
  );
}

function CurrencyCard({ title, rows, empty }: { title: string; rows: CurrencyAmount[]; empty: string }) {
  return (
    <article className="admin-billing-card">
      <div className="admin-billing-card__head"><div><strong>{title}</strong><small>Platform SaaS ledger</small></div></div>
      {rows.length === 0 ? <p>{empty}</p> : (
        <div className="admin-billing-detail">
          {rows.map((row) => <MetricFact key={row.currencyCode} label={row.currencyCode} value={formatMoney(row.amountMinor, row.currencyCode)} />)}
        </div>
      )}
    </article>
  );
}

function MetricFact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formatMoney(amountMinor: number, currencyCode: string): string {
  return `${currencyCode} ${(amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface QuickLinkProps {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  desc: string;
}

function QuickLink({ href, icon: Icon, title, desc }: QuickLinkProps) {
  return (
    <Link href={href} className="admin-quicklink">
      <span className="admin-quicklink__head"><span className="admin-quicklink__icon"><Icon /></span><span className="admin-quicklink__title">{title}</span></span>
      <p className="admin-quicklink__desc">{desc}</p>
    </Link>
  );
}
