"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { SaleDetailSheet } from "./sale-detail-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import {
  IconReceipt,
  IconRefresh,
  IconSales,
  IconSearch,
  IconTrending,
  IconReturns,
} from "../ui/icons";
import { Button } from "../ui/button";
import type { SaleSummary } from "../workspace/workspace-provider";

interface SalesResponse {
  sales: SaleSummary[];
}

type StatusFilter = "ALL" | "COMPLETED" | "PENDING" | "VOID" | "REFUNDED";
type DateRange = "TODAY" | "7D" | "30D" | "ALL";

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PENDING", label: "Pending" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "VOID", label: "Void" },
];

const DATE_RANGES: ReadonlyArray<{ value: DateRange; label: string }> = [
  { value: "TODAY", label: "Today" },
  { value: "7D", label: "7 days" },
  { value: "30D", label: "30 days" },
  { value: "ALL", label: "All time" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

export function SalesWorkspace() {
  const { session, queue } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [range, setRange] = useState<DateRange>("30D");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const path = session
    ? `/v1/sales?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=50${query ? `&query=${encodeURIComponent(query)}` : ""}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SalesResponse>(path);

  const allSales = useMemo(() => data?.sales ?? [], [data]);
  const currency = session?.currencyCode ?? "GHS";

  // Client-side filter for status + date range. The API supports `query` for
  // free-text search; status + range are applied locally so the toolbar
  // reflects the active filter set without an extra round-trip.
  const sales = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === "TODAY" ? now - 24 * 3600 * 1000 :
      range === "7D" ? now - 7 * 24 * 3600 * 1000 :
      range === "30D" ? now - 30 * 24 * 3600 * 1000 : 0;
    return allSales.filter((s) => {
      if (status !== "ALL" && s.status !== status) return false;
      if (range !== "ALL") {
        const ts = s.completedAt ? new Date(s.completedAt).getTime() : new Date(s.createdAt).getTime();
        if (ts < cutoff) return false;
      }
      return true;
    });
  }, [allSales, status, range]);

  // Summary stats — computed from the unfiltered set so they reflect the
  // overall business picture, not the active filter.
  const stats = useMemo(() => {
    const today = new Date();
    const todaySales = allSales.filter((s) => {
      const d = s.completedAt ? new Date(s.completedAt) : new Date(s.createdAt);
      return d.toDateString() === today.toDateString();
    });
    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.totalMinor - s.refundTotalMinor), 0);
    const pending = allSales.filter((s) => s.status === "PENDING").length;
    const refunded = allSales.filter((s) => s.refundTotalMinor > 0 || s.status === "REFUNDED").length;
    return { todayCount: todaySales.length, todayRevenue, pending, refunded };
  }, [allSales]);

  if (loading) {
    return (
      <div className="tos-page">
        <SalesHeader onRefresh={() => { refetch(); setNonce((n) => n + 1); }} online={queue.online} pending={queue.pending} />
        <div className="tos-dashboard-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tos-card tos-card--padded">
              <span className="tos-skeleton tos-skeleton--line-short" />
              <span className="tos-skeleton tos-skeleton--block" />
            </div>
          ))}
        </div>
        <div className="tos-card tos-card--padded">
          <StatePanel inline variant="loading" title="Loading sales…" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tos-page">
        <SalesHeader onRefresh={() => { refetch(); setNonce((n) => n + 1); }} online={queue.online} pending={queue.pending} />
        <StatePanel variant="error" title="Could not load sales" text={error} actionLabel="Retry" onAction={() => refetch()} />
      </div>
    );
  }

  const refresh = () => { refetch(); setNonce((n) => n + 1); };

  return (
    <div className="tos-page">
      <SalesHeader onRefresh={refresh} online={queue.online} pending={queue.pending} />

      {/* KPI strip — 4-up desktop / 2x2 mobile. Mirrors dashboard language. */}
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
          value={<span className="tos-stat__value">{allSales.length}</span>}
          hint="Last 50 transactions"
        />
        <StatCard
          label="Pending"
          icon={<IconRefresh className="tos-stat__icon-tile-svg" />}
          iconTone={stats.pending > 0 ? "warning" : "neutral"}
          value={<span className="tos-stat__value">{stats.pending}</span>}
          hint={stats.pending > 0 ? "Awaiting sync / review" : "All settled"}
          hintTone={stats.pending > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Refunds"
          icon={<IconReturns className="tos-stat__icon-tile-svg" />}
          iconTone={stats.refunded > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.refunded}</span>}
          hint={stats.refunded > 0 ? "Has refunded items" : "No refunds"}
          hintTone={stats.refunded > 0 ? "warning" : "positive"}
        />
      </div>

      {/* Toolbar — search + filter chips (stacked on mobile, single row on desktop) */}
      <div className="tos-toolbar tos-toolbar--stacked">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search by receipt no, customer name, or phone…"
            aria-label="Search sales"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tos-filter-row">
          <span className="tos-filter-label">Range</span>
          {DATE_RANGES.map((r) => (
            <FilterChip key={r.value} pressed={range === r.value} onClick={() => setRange(r.value)}>
              {r.label}
            </FilterChip>
          ))}
          <span className="tos-filter-label" style={{ marginLeft: "var(--tos-space-2)" }}>Status</span>
          {STATUS_FILTERS.map((s) => (
            <FilterChip key={s.value} pressed={status === s.value} onClick={() => setStatus(s.value)}>
              {s.label}
            </FilterChip>
          ))}
          <span className="tos-toolbar__spacer" />
          <span className="tos-section__sub">{sales.length} receipt(s)</span>
        </div>
      </div>

      {allSales.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconSales className="tos-state__icon" />}
          title="No sales yet"
          text="Sales you complete in the POS will appear here as immutable receipts — with the customer, total, payment method, and status. Tap any receipt to view its evidence."
          actionLabel="Make your first sale"
          onAction={() => { window.location.href = "/sell"; }}
        />
      ) : sales.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text="No sales match the current filters. Try widening the date range or clearing the status filter."
          actionLabel="Clear filters"
          onAction={() => { setStatus("ALL"); setRange("ALL"); setQuery(""); }}
        />
      ) : (
        <>
          {/* Mobile: premium tappable cards */}
          <ul className="tos-list-cards tos-stagger" aria-label="Sales">
            {sales.map((sale) => (
              <li key={sale.id}>
                <button
                  type="button"
                  className="tos-sale-card tos-card-hover tos-animate-fade-in-up"
                  onClick={() => setSelectedId(sale.id)}
                  aria-label={`Open receipt ${sale.id.slice(0, 8)}`}
                >
                  <div className="tos-sale-card__row">
                    <div className="tos-sale-card__main">
                      <span className="tos-sale-card__title">#{sale.id.slice(0, 8)}</span>
                      <span className="tos-sale-card__sub">
                        {sale.customer?.name ?? sale.customer?.phone ?? "Walk-in"}
                      </span>
                      <span className="tos-sale-card__sub">
                        {sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "Pending"}
                        {sale.cashierName ? ` · ${sale.cashierName}` : ""}
                      </span>
                    </div>
                    <div className="tos-sale-card__meta">
                      <MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} className="tos-sale-card__total" />
                      {primaryPaymentMethod(sale) ? (
                        <span className="tos-sale-card__method">{primaryPaymentMethod(sale)}</span>
                      ) : null}
                      {sale.refundTotalMinor > 0 ? (
                        <span className="tos-sale-card__refund">Refunded</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="tos-sale-card__row">
                    <SaleStatusBadge status={sale.status} />
                    <span className="tos-sale-card__method">View receipt</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: clean table */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Customer</th>
                    <th>Cashier</th>
                    <th>When</th>
                    <th>Method</th>
                    <th data-align="right">Total</th>
                    <th data-align="center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} data-clickable="true" onClick={() => setSelectedId(sale.id)}>
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title tos-table__mono">#{sale.id.slice(0, 8)}</span>
                          {sale.refundTotalMinor > 0 ? <span className="tos-table__cell-sub">Refunded</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title">{sale.customer?.name ?? "Walk-in"}</span>
                          {sale.customer?.phone ? <span className="tos-table__cell-sub">{sale.customer.phone}</span> : null}
                        </div>
                      </td>
                      <td className="tos-table__muted">{sale.cashierName ?? "—"}</td>
                      <td className="tos-table__muted">
                        {sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "Pending"}
                      </td>
                      <td className="tos-table__muted">{primaryPaymentMethod(sale) ?? "—"}</td>
                      <td data-align="right">
                        <span className="tos-table__num">
                          <MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} tone="muted" />
                        </span>
                      </td>
                      <td data-align="center">
                        <SaleStatusBadge status={sale.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <SaleDetailSheet saleId={selectedId} onClose={() => setSelectedId(null)} />
      {/* nonce is intentionally read to force re-render on refresh */}
      <span hidden aria-hidden="true">{nonce}</span>
    </div>
  );
}

function SalesHeader({ onRefresh, online, pending }: { onRefresh: () => void; online: boolean; pending: number }) {
  return (
    <header className="tos-page__head">
      <div className="tos-page__heading">
        <span className="tos-page__eyebrow">TradeOS · Sales</span>
        <h1 className="tos-page__title">Sales</h1>
        <p className="tos-page__subtitle">Every completed sale is an immutable receipt. Tap a row to view its evidence — line items, payments, and totals.</p>
      </div>
      <div className="tos-page__actions">
        {!online ? (
          <span className="tos-badge tos-badge--warning">
            <span className="tos-badge__dot" />
            Offline · {pending} queued
          </span>
        ) : null}
        <Link href="/sell">
          <Button variant="gold" icon={<IconSales className="tos-btn__icon" />}>New sale</Button>
        </Link>
        <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={onRefresh}>Refresh</Button>
      </div>
    </header>
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

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tos-filter-chip"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SaleStatusBadge({ status }: { status: string }) {
  const variant =
    status === "COMPLETED" ? "tos-badge--positive" :
    status === "VOID" ? "tos-badge--danger" :
    status === "REFUNDED" ? "tos-badge--warning" :
    status === "PENDING" ? "tos-badge--pending" :
    "tos-badge--neutral";
  return (
    <span className={`tos-badge ${variant}`}>
      <span className="tos-badge__dot" />{status}
    </span>
  );
}

/** Returns the label of the first payment method on the sale, or null. */
function primaryPaymentMethod(sale: SaleSummary): string | null {
  if (sale.payments.length === 0) return null;
  const method = sale.payments[0]!.method;
  return method.charAt(0) + method.slice(1).toLowerCase();
}
