"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { ReturnRefundSheet } from "./return-refund-sheet";
import { RefundSettlementWorklist } from "./refund-settlement-worklist";
import { ExchangeSheet } from "./exchange-sheet";
import { MoneyValue } from "../business/money-value";
import { sumKnownMinorAmounts } from "./refund-amounts";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconRefresh,
  IconReturns,
  IconReceipt,
  IconSearch,
  IconTrendingDown,
} from "../ui/icons";
import type { SaleSummary } from "../workspace/workspace-provider";

interface SalesResponse { sales: SaleSummary[] }

interface BranchRefundSummary {
  scope: "BRANCH_ALL_TIME";
  balances: Array<{
    currencyCode: string;
    pendingCount: number;
    pendingMinor: number;
    settledCount: number;
    settledMinor: number;
    failedCount: number;
    failedMinor: number;
  }>;
}

type Mode = "return" | "refund" | "exchange";

type StatusFilter = "ALL" | "COMPLETED" | "REFUNDED" | "PENDING" | "FAILED" | "RETURNED";

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "COMPLETED", label: "Completed" },
  { value: "REFUNDED", label: "Refund paid" },
  { value: "PENDING", label: "Payout pending" },
  { value: "FAILED", label: "Needs review" },
  { value: "RETURNED", label: "Returned" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

function paymentIconFor(method: string): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 16, height: 16 }} />;
    default: return <IconReceipt style={{ width: 16, height: 16 }} />;
  }
}

function paymentLabelFor(method: string): string {
  switch (method) {
    case "CASH": return "Cash";
    case "MOMO": return "Mobile money";
    case "CARD": return "Card";
    case "BANK": return "Bank transfer";
    case "OTHER": return "Other";
    default: return method;
  }
}

export function ReturnRefundWorkspace() {
  const { session, role, refreshInventory, refreshCustomers } = useWorkspace();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [settlementRefresh, setSettlementRefresh] = useState(0);
  const [mode, setMode] = useState<Mode>("return");
  const path = session
    ? `/v1/sales?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=50${query ? `&query=${encodeURIComponent(query)}` : ""}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SalesResponse>(path);
  const canViewBranchPayouts = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER"].includes(role);
  const summaryPath = session && canViewBranchPayouts
    ? `/v1/refunds/branch-summary?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const { data: branchRefundData, loading: summaryLoading, error: summaryError, refetch: refetchSummary } =
    useApiFetch<BranchRefundSummary>(summaryPath);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(role);

  const allSales = data?.sales ?? [];
  const currencyCode = session?.currencyCode ?? "GHS";

  const filtered = useMemo(() => {
    return allSales.filter((s) => {
      if (statusFilter !== "ALL") {
        if (statusFilter === "COMPLETED" && s.status !== "COMPLETED") return false;
        if (statusFilter === "REFUNDED" && s.refundSettledMinor <= 0) return false;
        if (statusFilter === "PENDING" && s.refundPendingMinor <= 0) return false;
        if (statusFilter === "FAILED" && s.refundFailedMinor <= 0) return false;
        if (statusFilter === "RETURNED" && s.refundTotalMinor <= 0) return false;
      }
      return true;
    });
  }, [allSales, statusFilter]);

  const stats = useMemo(() => {
    const total = allSales.length;
    // Keep missing settlement fields distinct from a verified zero. Older or
    // cached API responses may omit these fields even for valid receipts.
    const correctionCount = allSales.every((sale) => Number.isSafeInteger(sale.refundTotalMinor))
      ? allSales.filter((s) => s.refundTotalMinor > 0).length
      : null;
    const refundSettledMinor = sumKnownMinorAmounts(allSales, (s) => s.refundSettledMinor);
    const refundPendingMinor = sumKnownMinorAmounts(allSales, (s) => s.refundPendingMinor);
    const refundFailedMinor = sumKnownMinorAmounts(allSales, (s) => s.refundFailedMinor);
    const revenueMinor = sumKnownMinorAmounts(allSales, (s) => s.totalMinor);
    return { total, correctionCount, refundSettledMinor, refundPendingMinor, refundFailedMinor, revenueMinor };
  }, [allSales]);

  const hasUnverifiedTotals = [
    stats.correctionCount,
    stats.refundSettledMinor,
    stats.refundPendingMinor,
    stats.refundFailedMinor,
    stats.revenueMinor,
  ].some((amount) => amount === null);

  // All-time branch payouts must never be derived from the latest-50 list.
  // Financial amounts are grouped by currency on the server.
  const selectedBranchBalance = useMemo(() => {
    if (!branchRefundData || branchRefundData.scope !== "BRANCH_ALL_TIME" ||
      !Array.isArray(branchRefundData.balances)) return null;
    const values = branchRefundData.balances;
    if (!values.every((balance) =>
      balance && typeof balance.currencyCode === "string" &&
      [balance.pendingCount, balance.pendingMinor, balance.settledCount,
        balance.settledMinor, balance.failedCount, balance.failedMinor]
        .every((amount) => Number.isSafeInteger(amount) && amount >= 0))) return null;
    return values.find((balance) => balance.currencyCode === currencyCode) ??
      { currencyCode, pendingCount: 0, pendingMinor: 0, settledCount: 0,
        settledMinor: 0, failedCount: 0, failedMinor: 0 };
  }, [branchRefundData, currencyCode]);
  const pendingPayoutMinor = canViewBranchPayouts
    ? selectedBranchBalance?.pendingMinor ?? null : stats.refundPendingMinor;
  const settledPayoutMinor = canViewBranchPayouts
    ? selectedBranchBalance?.settledMinor ?? null : stats.refundSettledMinor;
  const failedPayoutMinor = canViewBranchPayouts
    ? selectedBranchBalance?.failedMinor ?? null : stats.refundFailedMinor;
  const otherCurrencyCount = Array.isArray(branchRefundData?.balances)
    ? branchRefundData.balances.filter((balance) => balance?.currencyCode !== currencyCode).length
    : 0;

  const onCorrectionComplete = () => {
    setSelectedSaleId(null);
    setSettlementRefresh((previous) => previous + 1);
    // Corrections are immutable financial events: re-read the authoritative
    // receipt balances rather than estimating refunded money in the browser.
    // Inventory can change for restocked returns/exchanges, and customer
    // balances can change if the refund produces an account credit.
    refetch();
    refetchSummary();
    void refreshInventory();
    void refreshCustomers();
  };

  const open = (saleId: string, m: Mode) => {
    setSelectedSaleId(saleId);
    setMode(m);
  };

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("ALL");
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Trade</span>
          <h1 className="tos-page__title">Returns, refunds &amp; exchanges</h1>
          <p className="tos-page__subtitle">
            Corrective transactions on completed sales. The original receipt is never edited — a new immutable transaction is created for each correction.
          </p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => {
            refetch();
            refetchSummary();
            setSettlementRefresh((previous) => previous + 1);
          }}>Refresh</Button>
        </div>
      </header>

      {/* KPI strip — 4-up desktop / 2x2 mobile */}
      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label="Receipts"
          icon={<IconReceipt className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={<span className="tos-stat__value tos-stat__value--hero">{stats.total}</span>}
          hint="Last 50 receipts"
        />
        <StatCard
          label="Revenue"
          icon={<IconBanknote className="tos-stat__icon-tile-svg" />}
          iconTone="positive"
          value={<MoneyValue minor={stats.revenueMinor} currencyCode={currencyCode} className="tos-stat__value" />}
          hint="Sum of receipt totals"
        />
        <StatCard
          label="Returns accepted"
          icon={<IconReturns className="tos-stat__icon-tile-svg" />}
          iconTone={stats.correctionCount !== null && stats.correctionCount > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.correctionCount ?? "—"}</span>}
          hint={stats.correctionCount === null ? "Correction count unavailable" : stats.correctionCount > 0 ? "Receipts with corrections" : "No corrections"}
          hintTone={stats.correctionCount !== null && stats.correctionCount > 0 ? "warning" : "positive"}
        />
        <StatCard
          label="Refunds awaiting payout"
          icon={<IconTrendingDown className="tos-stat__icon-tile-svg" />}
          iconTone={pendingPayoutMinor !== null && pendingPayoutMinor > 0 ? "warning" : "neutral"}
          value={<MoneyValue minor={pendingPayoutMinor} currencyCode={currencyCode} className="tos-stat__value" />}
          hint={canViewBranchPayouts
            ? summaryLoading && !branchRefundData ? "Checking all branch receipts"
              : pendingPayoutMinor === null ? "Branch payout data unavailable"
              : pendingPayoutMinor > 0 ? "Outstanding across all receipts" : "No outstanding branch payouts"
            : pendingPayoutMinor === null ? "Payout data unavailable"
              : "Latest 50 receipts only"}
          hintTone={pendingPayoutMinor !== null && pendingPayoutMinor > 0 ? "warning" : "positive"}
        />
      </div>

      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__body">
          Confirmed refund payouts ({canViewBranchPayouts ? "all branch receipts" : "latest 50 receipts"}): {settledPayoutMinor === null
            ? <strong>Unavailable</strong>
            : <MoneyValue minor={settledPayoutMinor} currencyCode={currencyCode} />}.
          {failedPayoutMinor !== null && failedPayoutMinor > 0 ? <> Failed payouts requiring review: <MoneyValue minor={failedPayoutMinor} currencyCode={currencyCode} />.</> : null}
          {" "}Accepted returns and exchange credits are not proof of a paid refund. Pending provider refunds remain outstanding until verified.
        </span>
      </div>

      {hasUnverifiedTotals ? (
        <div className="tos-callout tos-callout--info" role="status">
          Some receipt totals could not be verified. Refresh to retrieve the latest
          amounts; do not treat an unavailable payout balance as a confirmed zero.
        </div>
      ) : null}

      {canViewBranchPayouts && !summaryLoading && (!selectedBranchBalance || summaryError) ? (
        <div className="tos-callout tos-callout--warning" role="alert">
          Branch refund totals could not be verified. No unknown payment has been
          counted as zero or as a confirmed payout.
          <Button size="sm" variant="outline" onClick={() => refetchSummary()}>Retry totals</Button>
        </div>
      ) : null}
      {otherCurrencyCount > 0 ? (
        <div className="tos-callout tos-callout--info" role="status">
          This branch has refund records in {otherCurrencyCount} other
          {otherCurrencyCount === 1 ? " currency" : " currencies"}. Amounts in different
          currencies are not combined with {currencyCode}.
        </div>
      ) : null}

      <RefundSettlementWorklist refreshToken={settlementRefresh} />

      {!canWrite ? (
        <div className="tos-callout tos-callout--info">
          You do not have permission to process returns or refunds. Only owners, admins, managers, and cashiers can.
        </div>
      ) : null}

      {/* Toolbar — search + status chips */}
      <div className="tos-toolbar tos-toolbar--stacked">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search receipts to correct…"
            aria-label="Search sales"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tos-filter-row">
          <span className="tos-filter-label">Status</span>
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.value} pressed={statusFilter === f.value} onClick={() => setStatusFilter(f.value)}>
              {f.label}
            </FilterChip>
          ))}
          <span className="tos-toolbar__spacer" />
          <span className="tos-section__sub">{filtered.length} receipt(s)</span>
        </div>
      </div>

      {loading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : error ? (
        <StatePanel variant="error" title="Could not load receipts" text={error} actionLabel="Retry" onAction={() => refetch()} />
      ) : allSales.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconReturns className="tos-state__icon" />}
          title="No receipts to correct"
          text="Find the receipt you want to correct, then choose Return, Refund, or Exchange. Each correction creates a new immutable transaction — the original receipt is never edited."
        />
      ) : filtered.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text="No receipts match the current filters. Try widening the status filter or clearing the search."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <>
          {/* Mobile: premium returnable-sale cards with action tiles */}
          <ul className="tos-list-cards tos-stagger" aria-label="Returnable sales">
            {filtered.map((sale) => {
              const refunded = sale.refundTotalMinor > 0;
              const cardCls = refunded
                ? "tos-returnable-card tos-returnable-card--returned tos-card-hover tos-animate-fade-in-up"
                : "tos-returnable-card tos-returnable-card--clean tos-card-hover tos-animate-fade-in-up";
              const customerName = sale.customer?.name ?? sale.customer?.phone ?? "Walk-in";
              const completedLabel = sale.completedAt
                ? new Date(sale.completedAt).toLocaleString()
                : "Pending";
              const primaryPayment = sale.payments[0];
              return (
                <li key={sale.id}>
                  <div className={cardCls}>
                    <div className="tos-returnable-card__head">
                      <div className="tos-returnable-card__body">
                        <span className="tos-returnable-card__title">#{sale.id.slice(0, 8)}</span>
                        <span className="tos-returnable-card__sub">{customerName}</span>
                        <span className="tos-returnable-card__sub">{completedLabel}{sale.cashierName ? ` · ${sale.cashierName}` : ""}</span>
                        {primaryPayment ? (
                          <span className="tos-returnable-card__sub">
                            {paymentIconFor(primaryPayment.method)} {paymentLabelFor(primaryPayment.method)}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} className="tos-returnable-card__total" />
                        {refunded ? (
                          <span className="tos-returnable-card__refund-flag">
                            Return value: <MoneyValue minor={sale.refundTotalMinor} currencyCode={sale.currencyCode} />
                          </span>
                        ) : null}
                        {sale.refundPendingMinor > 0 ? (
                          <span className="tos-returnable-card__sub">
                            Pending payout: <MoneyValue minor={sale.refundPendingMinor} currencyCode={sale.currencyCode} />
                          </span>
                        ) : null}
                        {sale.refundSettledMinor > 0 ? (
                          <span className="tos-returnable-card__sub">
                            Refund paid: <MoneyValue minor={sale.refundSettledMinor} currencyCode={sale.currencyCode} />
                          </span>
                        ) : null}
                        {sale.refundFailedMinor > 0 ? (
                          <span className="tos-returnable-card__sub">
                            Payout needs review: <MoneyValue minor={sale.refundFailedMinor} currencyCode={sale.currencyCode} />
                          </span>
                        ) : null}
                        <span className={`tos-badge ${sale.status === "COMPLETED" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                          <span className="tos-badge__dot" />{sale.status}
                        </span>
                      </div>
                    </div>
                    {canWrite ? (
                      <div className="tos-returnable-card__actions">
                        <button
                          type="button"
                          className="tos-returnable-card__action tos-returnable-card__action--return"
                          onClick={() => open(sale.id, "return")}
                          aria-label={`Return goods from receipt ${sale.id.slice(0, 8)}`}
                        >
                          <IconReturns className="tos-returnable-card__action-icon" />
                          Return
                        </button>
                        <button
                          type="button"
                          className="tos-returnable-card__action tos-returnable-card__action--refund"
                          onClick={() => open(sale.id, "refund")}
                          aria-label={`Refund receipt ${sale.id.slice(0, 8)}`}
                        >
                          <IconTrendingDown className="tos-returnable-card__action-icon" />
                          Refund
                        </button>
                        <button
                          type="button"
                          className="tos-returnable-card__action tos-returnable-card__action--exchange"
                          onClick={() => open(sale.id, "exchange")}
                          aria-label={`Exchange from receipt ${sale.id.slice(0, 8)}`}
                        >
                          <IconRefresh className="tos-returnable-card__action-icon" />
                          Exchange
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: clean table with action buttons */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Customer</th>
                    <th>Cashier</th>
                    <th>When</th>
                    <th>Payment</th>
                    <th data-align="right">Total</th>
                    <th data-align="right">Return value</th>
                    <th data-align="right">Refund payout</th>
                    <th data-align="center">Status</th>
                    {canWrite ? <th data-align="center">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((sale) => {
                    const customerName = sale.customer?.name ?? sale.customer?.phone ?? "Walk-in";
                    const primaryPayment = sale.payments[0];
                    return (
                      <tr key={sale.id}>
                        <td><span className="tos-table__cell-title tos-table__mono">#{sale.id.slice(0, 8)}</span></td>
                        <td className="tos-table__muted">{customerName}</td>
                        <td className="tos-table__muted">{sale.cashierName ?? "—"}</td>
                        <td className="tos-table__muted">{sale.completedAt ? new Date(sale.completedAt).toLocaleDateString() : "—"}</td>
                        <td className="tos-table__muted">
                          {primaryPayment ? paymentLabelFor(primaryPayment.method) : "—"}
                        </td>
                        <td data-align="right"><MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} tone="muted" /></td>
                        <td data-align="right" className="tos-table__num">
                          {sale.refundTotalMinor > 0 ? (
                            <MoneyValue minor={sale.refundTotalMinor} currencyCode={sale.currencyCode} tone="negative" />
                          ) : (
                            <span className="tos-table__muted">—</span>
                          )}
                        </td>
                        <td data-align="right" className="tos-table__num">
                          {sale.refundSettledMinor > 0 ? (
                            <div>Paid: <MoneyValue minor={sale.refundSettledMinor} currencyCode={sale.currencyCode} /></div>
                          ) : null}
                          {sale.refundPendingMinor > 0 ? (
                            <div>Pending: <MoneyValue minor={sale.refundPendingMinor} currencyCode={sale.currencyCode} /></div>
                          ) : null}
                          {sale.refundFailedMinor > 0 ? (
                            <div>Review: <MoneyValue minor={sale.refundFailedMinor} currencyCode={sale.currencyCode} /></div>
                          ) : null}
                          {sale.refundSettledMinor + sale.refundPendingMinor + sale.refundFailedMinor === 0 ? (
                            <span className="tos-table__muted">—</span>
                          ) : null}
                        </td>
                        <td data-align="center">
                          <span className={`tos-badge ${sale.status === "COMPLETED" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                            <span className="tos-badge__dot" />{sale.status}
                          </span>
                        </td>
                        {canWrite ? (
                          <td data-align="center">
                            <div className="tos-row" style={{ justifyContent: "center", gap: "var(--tos-space-1)" }}>
                              <Button size="sm" variant="ghost" onClick={() => open(sale.id, "return")}>Return</Button>
                              <Button size="sm" variant="ghost" onClick={() => open(sale.id, "refund")}>Refund</Button>
                              <Button size="sm" variant="ghost" onClick={() => open(sale.id, "exchange")}>Exchange</Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Immutable-evidence callout */}
      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__body">
          Returns, refunds and exchanges keep the original receipt unchanged and add a separate correction to the transaction history.
        </span>
      </div>

      {selectedSaleId && (mode === "return" || mode === "refund") ? (
        <ReturnRefundSheet
          saleId={selectedSaleId}
          mode={mode}
          onClose={() => setSelectedSaleId(null)}
          onComplete={onCorrectionComplete}
        />
      ) : null}
      {selectedSaleId && mode === "exchange" ? (
        <ExchangeSheet
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
          onComplete={onCorrectionComplete}
        />
      ) : null}
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
