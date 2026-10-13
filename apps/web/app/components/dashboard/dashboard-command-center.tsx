"use client";

import { useMemo } from "react";
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

export function DashboardCommandCenter() {
  const { session, catalog, inventory, queue, role } = useWorkspace();
  const salesPath = session
    ? `/v1/sales?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=8`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SalesResponse>(salesPath);

  const stats = useMemo(() => {
    const sales = data?.sales ?? [];
    const today = new Date();
    const todaySales = sales.filter((s) => {
      const d = s.completedAt ? new Date(s.completedAt) : new Date(s.createdAt);
      return d.toDateString() === today.toDateString();
    });
    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.totalMinor - s.refundTotalMinor), 0);
    const activeCount = catalog.filter((c) => c.active).length;
    const lowStockCount = inventory.filter((i) => i.available <= 5).length;
    return {
      todayCount: todaySales.length,
      todayRevenue,
      activeCount,
      lowStockCount,
    };
  }, [data, catalog, inventory]);

  if (loading) {
    return (
      <div className="tos-page">
        <DashboardHeader />
        <div className="tos-dashboard-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tos-card tos-card--padded">
              <span className="tos-skeleton tos-skeleton--line-short" />
              <span className="tos-skeleton tos-skeleton--block" />
            </div>
          ))}
        </div>
        <div className="tos-card tos-card--padded">
          <span className="tos-skeleton tos-skeleton--block" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tos-page">
        <DashboardHeader />
        <StatePanel
          variant="error"
          title="Could not load dashboard"
          text={error}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const currency = session?.currencyCode ?? "GHS";
  const sales = data?.sales ?? [];

  return (
    <div className="tos-page">
      <DashboardHeader />

      {!queue.online ? (
        <OfflineBanner pending={queue.pending} />
      ) : null}

      {/* KPI grid — 4-up on desktop, 2x2 on phone. Order is deliberate:
          row 1 = revenue + sales count, row 2 = catalog + sync. */}
      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label="Today's revenue"
          icon={<IconTrending className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={<MoneyValue minor={stats.todayRevenue} currencyCode={currency} className="tos-stat__value--hero" />}
          hint={`${stats.todayCount} sale(s) today`}
        />
        <StatCard
          label="Recent sales"
          icon={<IconReceipt className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{sales.length}</span>}
          hint="Last 8 transactions"
        />
        <StatCard
          label="Active catalog"
          icon={<IconBox className="tos-stat__icon-tile-svg" />}
          iconTone={stats.lowStockCount > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.activeCount}</span>}
          hint={stats.lowStockCount > 0 ? `${stats.lowStockCount} low-stock item(s)` : "Stock levels healthy"}
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

      <div className="tos-grid-two">
        <section className="tos-section">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Recent sales</h2>
            <Link href="/sales" className="tos-view-all-link">
              View all
              <IconChevronRight className="tos-view-all-link__icon" />
            </Link>
          </div>
          <div className="tos-section__body">
            {sales.length === 0 ? (
              <StatePanel
                inline
                variant="empty"
                icon={<IconReceipt className="tos-state__icon" />}
                title="No sales yet today"
                text="Once you make your first sale, it will appear here with the customer, amount, and status. Your dashboard updates automatically."
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

        <section className="tos-section">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Quick actions</h2>
          </div>
          <div className="tos-section__body--padded">
            <div className="tos-quick-action-grid">
              <QuickAction href="/sell" icon={<IconSell className="tos-quick-action__icon-svg" />} label="New sale" desc="Open the POS" />
              <QuickAction href="/catalog" icon={<IconBox className="tos-quick-action__icon-svg" />} label="Add product" desc="Manage catalog" />
              <QuickAction href="/customers" icon={<IconCustomers className="tos-quick-action__icon-svg" />} label="Add customer" desc="Track credit" />
              <QuickAction href="/cashbook" icon={<IconCashbook className="tos-quick-action__icon-svg" />} label="Record expense" desc="Cashbook" />
            </div>
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

function DashboardHeader() {
  return (
    <header className="tos-page__head">
      <div className="tos-page__heading">
        <span className="tos-page__eyebrow">TradeOS</span>
        <h1 className="tos-page__title">Dashboard</h1>
        <p className="tos-page__subtitle">A live snapshot of today&apos;s trade, inventory, and reconciliation state.</p>
      </div>
      <div className="tos-page__actions">
        <Link href="/sell">
          <Button variant="gold" icon={<IconSell className="tos-btn__icon" />}>New sale</Button>
        </Link>
        <Link href="/reports">
          <Button variant="outline" icon={<IconReceipt className="tos-btn__icon" />}>Reports</Button>
        </Link>
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
