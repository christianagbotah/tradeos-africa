"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { IconArrowLeft, IconBox, IconCashbook, IconCustomers, IconReceipt, IconRefresh, IconSales, IconSell, IconTrending } from "../ui/icons";
import { Button } from "../ui/button";
import type { SaleSummary } from "../workspace/workspace-provider";

interface SalesResponse {
  sales: SaleSummary[];
}

export function DashboardCommandCenter() {
  const { session, catalog, queue, role } = useWorkspace();
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
    const activeCatalog = catalog.filter((c) => c.status === "ACTIVE");
    const lowStock = activeCatalog.filter((c) => c.trackInventory && c.inventoryAvailable !== null && c.inventoryAvailable <= 5);
    return {
      todayCount: todaySales.length,
      todayRevenue,
      activeCount: activeCatalog.length,
      lowStockCount: lowStock.length,
    };
  }, [data, catalog]);

  if (loading) {
    return (
      <div className="tos-page">
        <DashboardHeader />
        <div className="tos-grid-stats">
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
        <div className="tos-banner tos-banner--warning" role="status">
          <IconArrowLeft className="tos-banner__icon" />
          <div className="tos-banner__body">
            <span className="tos-banner__title">You are offline</span>
            <span className="tos-banner__text">
              Sales will queue locally and reconcile automatically when you reconnect.
              {queue.pending > 0 ? ` ${queue.pending} mutation(s) pending.` : ""}
            </span>
          </div>
        </div>
      ) : null}

      <div className="tos-grid-stats">
        <StatCard
          label="Today's revenue"
          icon={<IconTrending className="tos-stat__icon" />}
          value={<MoneyValue minor={stats.todayRevenue} currencyCode={currency} size="lg" />}
          hint={`${stats.todayCount} sale(s) today`}
        />
        <StatCard
          label="Active catalog"
          icon={<IconBox className="tos-stat__icon" />}
          value={<span className="tos-stat__value">{stats.activeCount}</span>}
          hint={stats.lowStockCount > 0 ? `${stats.lowStockCount} low-stock item(s)` : "Stock levels healthy"}
          hintTone={stats.lowStockCount > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Pending sync"
          icon={<IconRefresh className="tos-stat__icon" />}
          value={<span className="tos-stat__value">{queue.pending}</span>}
          hint={queue.pending > 0 ? "Will sync automatically" : "All caught up"}
        />
        <StatCard
          label="Recent sales"
          icon={<IconReceipt className="tos-stat__icon" />}
          value={<span className="tos-stat__value">{sales.length}</span>}
          hint="Last 8 transactions"
        />
      </div>

      <div className="tos-grid-two">
        <div className="tos-section">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Recent sales</h2>
            <Link href="/sales" className="tos-public__form-link">View all →</Link>
          </div>
          <div className="tos-section__body">
            {sales.length === 0 ? (
              <StatePanel
                inline
                variant="empty"
                title="No sales yet"
                text="Once you make your first sale, it will appear here."
                actionLabel="Open POS"
                onAction={() => { window.location.href = "/sell"; }}
              />
            ) : (
              <ul className="tos-list" style={{ borderRadius: 0, border: "none", boxShadow: "none" }}>
                {sales.slice(0, 6).map((sale) => (
                  <li key={sale.id} className="tos-list__row" style={{ borderBottom: "1px solid var(--tos-border)" }}>
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
        </div>

        <div className="tos-section">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Quick actions</h2>
          </div>
          <div className="tos-section__body--padded">
            <div className="tos-grid-two">
              <QuickAction href="/sell" icon={<IconSell style={{ width: 20, height: 20 }} />} label="New sale" desc="Open the POS" />
              <QuickAction href="/catalog" icon={<IconBox style={{ width: 20, height: 20 }} />} label="Add product" desc="Manage catalog" />
              <QuickAction href="/customers" icon={<IconCustomers style={{ width: 20, height: 20 }} />} label="Add customer" desc="Track credit" />
              <QuickAction href="/cashbook" icon={<IconCashbook style={{ width: 20, height: 20 }} />} label="Record expense" desc="Cashbook" />
            </div>
          </div>
        </div>
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

function StatCard({
  label,
  icon,
  value,
  hint,
  hintTone = "default",
}: {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  hint?: string;
  hintTone?: "default" | "warning";
}) {
  return (
    <div className="tos-stat">
      <span className="tos-stat__label">
        {icon}
        {label}
      </span>
      {value}
      {hint ? (
        <span className="tos-stat__hint" style={hintTone === "warning" ? { color: "var(--tos-warning)" } : undefined}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function QuickAction({ href, icon, label, desc }: { href: string; icon: React.ReactNode; label: string; desc: string }) {
  return (
    <Link href={href} className="tos-more-tile" style={{ minHeight: 96, textAlign: "left" }}>
      <span className="tos-more-tile__icon" style={{ color: "var(--tos-gold)" }}>{icon}</span>
      <span className="tos-more-tile__label">{label}</span>
      <span className="tos-list__row-sub">{desc}</span>
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
