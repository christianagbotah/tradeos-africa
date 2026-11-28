"use client";

import { useMemo } from "react";
import { BusinessBriefingPanel } from "./business-briefing-panel";
import { BusinessEventFeedPanel } from "./business-event-feed-panel";
import { BusinessQuestionPanel } from "./business-question-panel";
import type { ReactNode } from "react";
import Link from "next/link";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import {
  IconAlert,
  IconBox,
  IconCashbook,
  IconChevronRight,
  IconCustomers,
  IconReceipt,
  IconRefresh,
  IconSell,
  IconTrending,
} from "../ui/icons";
import { Button } from "../ui/button";
import type { SaleSummary } from "../workspace/workspace-provider";
import type { FinancialSummaryReport } from "@tradeos/contracts";
import { deriveDashboardRevenue } from "./dashboard-revenue";
import { dashboardQuickActionSegments, type DashboardActionSegment } from "./dashboard-quick-actions";
import { visibleNavItems, type WorkspaceRole } from "../workspace/workspace-navigation";

interface SalesResponse {
  sales: SaleSummary[];
}

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

const DAILY_REPORT_ROLES = new Set(["OWNER","ADMIN","MANAGER","ACCOUNTANT","VIEWER"]);

export function DashboardCommandCenter() {
  const { session, catalog, inventory, queue, role } = useWorkspace();
  const salesPath = session
    ? `/v1/sales?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=8`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SalesResponse>(salesPath);

  const mayReadFinancialReport = role !== null && DAILY_REPORT_ROLES.has(role);
  const financialPath = session && mayReadFinancialReport && queue.online
    ? "/v1/reports/financial-summary?businessId=" + encodeURIComponent(session.businessId) +
      "&branchId=" + encodeURIComponent(session.branchId) + "&range=today"
    : null;
  const { data: financialData, loading: financialLoading, error: financialError } =
    useApiFetch<FinancialSummaryReport>(financialPath);
  const verifiedReport = financialData && session && queue.online && !financialLoading && !financialError &&
    financialData.businessId === session.businessId && financialData.branchId === session.branchId
    ? financialData : null;
  const revenueStat = deriveDashboardRevenue({
    mayReadFinancialReport,
    report: verifiedReport,
    recentSales: data?.sales ?? [],
    fallbackCurrencyCode: session?.currencyCode ?? "GHS",
    online: queue.online,
    pendingSync: queue.pending,
  });

  const stats = useMemo(() => {
    const activeCount = catalog.filter((c) => c.active).length;
    const lowStockCount = inventory.filter((i) => i.available <= 5).length;
    return { activeCount, lowStockCount };
  }, [catalog, inventory]);

  const sales = !loading && !error ? data?.sales ?? [] : [];

  return (
    <div className="tos-page">
      <DashboardHeader role={role} />

      {!queue.online ? (
        <OfflineBanner pending={queue.pending} />
      ) : null}

      {/* Storefront actions always remain accessible even if the sales query
          takes time or fails. The sidebar policy determines which are shown. */}
      <DashboardQuickActions role={role} />
      <BusinessQuestionPanel />

      {/* KPI grid — 4-up on desktop, 2x2 on phone. Order is deliberate:
          row 1 = revenue + sales count, row 2 = catalog + sync. */}
      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label={revenueStat.label}
          icon={<IconTrending className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={revenueStat.minor === null
            ? <span className="tos-stat__value tos-stat__value--hero">—</span>
            : <MoneyValue minor={revenueStat.minor} currencyCode={revenueStat.currencyCode}
                className="tos-stat__value--hero" />}
          hint={revenueStat.hint}
        />
        <StatCard
          label="Recent sales"
          icon={<IconReceipt className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{loading || error ? "—" : sales.length}</span>}
          hint={loading ? "Loading transactions…" : error ? "Sales temporarily unavailable" : "Last 8 transactions"}
        />
        <StatCard
          label="Active catalog"
          icon={<IconBox className="tos-stat__icon-tile-svg" />}
          iconTone={stats.lowStockCount > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.activeCount}</span>}
          hint={stats.lowStockCount > 0 ? `${stats.lowStockCount} item(s) at or below 5 stock units` : "No low-stock items in loaded stock"}
          hintTone={stats.lowStockCount > 0 ? "warning" : "positive"}
        />
        <StatCard
          label="Pending sync"
          icon={<IconRefresh className="tos-stat__icon-tile-svg" />}
          iconTone={queue.pending > 0 ? "warning" : "neutral"}
          value={<span className="tos-stat__value">{queue.pending}</span>}
          hint={queue.pending > 0 ? "Will sync automatically" : "All caught up"}
          hintTone={queue.pending > 0 ? "warning" : "default"}
        />
      </div>

      <BusinessBriefingPanel />
      <BusinessEventFeedPanel />

      <div className="tos-dashboard-recent-sales">
        <section className="tos-section">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Recent sales</h2>
            <Link href="/sales" className="tos-view-all-link">
              View all
              <IconChevronRight className="tos-view-all-link__icon" />
            </Link>
          </div>
          <div className="tos-section__body">
            {loading ? (
              <p className="tos-dashboard-recent-sales__notice" role="status">Loading recent sales…</p>
            ) : error ? (
              <StatePanel inline variant="error" title="Could not load recent sales" text={error}
                actionLabel="Retry sales" onAction={() => refetch()} />
            ) : sales.length === 0 ? (
              <StatePanel
                inline
                variant="empty"
                icon={<IconReceipt className="tos-state__icon" />}
                title="No recent sales"
                text="The most recent synced sales will appear here, including the customer, amount and status."
                actionLabel="Open POS"
                onAction={() => { window.location.href = "/sell"; }}
              />
            ) : (
              <ul className="tos-dashboard-sales tos-stagger">
                {sales.slice(0, 6).map((sale) => (
                  <li key={sale.id} className="tos-dashboard-sales__row tos-animate-fade-in-up">
                    <div className="tos-list__row-main">
                      <span className="tos-list__row-title">{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in"}</span>
                      <span className="tos-list__row-sub">
                        {sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "Pending"}
                        {sale.cashierName ? ` · ${sale.cashierName}` : ""}
                      </span>
                    </div>
                    <div className="tos-list__row-meta">
                      <MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} tone={sale.status === "COMPLETED" ? "default" : "muted"} />
                      <SaleStatusBadge status={sale.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

      </div>

      {role === "VIEWER" ? (
        <div className="tos-callout tos-callout--info">
          You are signed in as a viewer. Sales and inventory actions are hidden. Ask an owner or manager to upgrade your role.
        </div>
      ) : null}
    </div>
  );
}

function DashboardHeader({ role }: { role: WorkspaceRole | null }) {
  const allowed = new Set(visibleNavItems(role).map((item) => item.segment));
  return (
    <header className="tos-page__head tos-dashboard-header">
      <div className="tos-page__heading">
        <span className="tos-page__eyebrow">TradeOS</span>
        <h1 className="tos-page__title">Dashboard</h1>
        <p className="tos-page__subtitle">Your recorded trading, stock and synchronization overview.</p>
      </div>
      <div className="tos-page__actions">
        {allowed.has("sell") ? <Link href="/sell">
          <Button variant="gold" icon={<IconSell className="tos-btn__icon" />}>New sale</Button>
        </Link> : null}
        {allowed.has("reports") ? <Link href="/reports">
          <Button variant="outline" icon={<IconReceipt className="tos-btn__icon" />}>Reports</Button>
        </Link> : null}
      </div>
    </header>
  );
}

function OfflineBanner({ pending }: { pending: number }) {
  return (
    <div className="tos-banner tos-banner--warning tos-banner--offline" role="status">
      <span className="tos-banner__icon-tile" aria-hidden="true">
        <IconAlert className="tos-banner__icon-tile-svg" />
      </span>
      <div className="tos-banner__body">
        <span className="tos-banner__offline-label">
          <span className="tos-banner__offline-label-dot" aria-hidden="true" />
          Offline
        </span>
        <span className="tos-banner__title">You are offline</span>
        <span className="tos-banner__text">
          Sales will queue locally and reconcile automatically when you reconnect.
          {pending > 0 ? ` ${pending} offline change(s) pending.` : ""}
        </span>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  hint?: string;
  hintTone?: "default" | "warning" | "positive";
  variant?: "default" | "hero";
  iconTone?: StatIconTone;
}

function StatCard({
  label,
  icon,
  value,
  hint,
  hintTone = "default",
  variant = "default",
  iconTone = "neutral",
}: StatCardProps) {
  const cls = variant === "hero"
    ? "tos-stat tos-card-hover tos-animate-fade-in-up tos-stat--hero"
    : "tos-stat tos-card-hover tos-animate-fade-in-up";

  const hintCls = hintTone === "warning"
    ? "tos-stat__hint tos-stat__hint--warning"
    : hintTone === "positive"
      ? "tos-stat__hint tos-stat__hint--positive"
      : "tos-stat__hint";

  return (
    <div className={cls}>
      <div className="tos-stat__head">
        <span className={STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </div>
  );
}

function DashboardQuickActions({ role }: { role: WorkspaceRole | null }) {
  const segments = dashboardQuickActionSegments(role);
  if (segments.length === 0) return null;
  const icons: Record<DashboardActionSegment, ReactNode> = {
    sell: <IconSell className="tos-quick-action__icon-svg" />,
    catalog: <IconBox className="tos-quick-action__icon-svg" />,
    customers: <IconCustomers className="tos-quick-action__icon-svg" />,
    cashbook: <IconCashbook className="tos-quick-action__icon-svg" />,
    sales: <IconReceipt className="tos-quick-action__icon-svg" />,
    reports: <IconTrending className="tos-quick-action__icon-svg" />,
    settings: <IconBox className="tos-quick-action__icon-svg" />,
  };
  const labels: Record<DashboardActionSegment, [string, string]> = {
    sell: ["New sale", "Open POS"],
    catalog: ["Catalog", "Products & services"],
    customers: ["Customers", "People & credit"],
    cashbook: ["Record expense", "Cashbook"],
    sales: ["Sales history", "Review receipts"],
    reports: ["Reports", "Business insights"],
    settings: ["Settings", "Manage account"],
  };
  return (
    <section className="tos-section tos-dashboard-actions" aria-label="Quick actions">
      <div className="tos-section__head"><h2 className="tos-section__title">Quick actions</h2></div>
      <div className="tos-section__body--padded">
        <div className="tos-quick-action-grid">
          {segments.map((segment) => (
            <QuickAction key={segment} href={`/${segment}`} icon={icons[segment]}
              label={labels[segment][0]} desc={labels[segment][1]} />
          ))}
        </div>
      </div>
    </section>
  );
}

function QuickAction({
  href,
  icon,
  label,
  desc,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <Link href={href} className="tos-quick-action tos-card-hover">
      <span className="tos-quick-action__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tos-quick-action__body">
        <span className="tos-quick-action__label">{label}</span>
        <span className="tos-quick-action__desc">{desc}</span>
      </span>
      <IconChevronRight className="tos-quick-action__chevron" aria-hidden="true" />
    </Link>
  );
}

function SaleStatusBadge({ status }: { status: string }) {
  const variant =
    status === "COMPLETED" ? "tos-badge--positive" :
    status === "VOID" ? "tos-badge--danger" :
    status === "REFUNDED" ? "tos-badge--warning" :
    "tos-badge--neutral";
  return <span className={`tos-badge ${variant}`}><span className="tos-badge__dot" />{status}</span>;
}
