/**
 * Sales — sales history list + detail.
 *
 * Filter bar (search, status), sales table, click a row to open a detail
 * dialog showing line items, totals and payment. Empty state when no rows.
 *
 * State handling:
 *   - DEMO MODE: renders sample sales with a DemoBanner.
 *   - SIGNED OUT: renders an AccessState.
 *   - READY: loads sales from the API; on failure renders an AccessState.
 */
import { useEffect, useMemo, useState } from "react";
import type { DesktopSaleRow, ScreenId } from "../lib/types.js";
import { SAMPLE_SALES } from "../lib/sample-data.js";
import type { DesktopSaleListResponse } from "../lib/desktop-api-client.js";
import type { DesktopRuntime, DesktopReadyState } from "../lib/desktop-runtime.js";
import { fmtMoneyMinor, fmtDateTime } from "../lib/format.js";
import { EmptyState } from "../components/EmptyState.js";
import { AccessState } from "../components/AccessState.js";
import { DemoBanner } from "../components/DemoBanner.js";
import {
  IconReceipt,
  IconSearch,
  IconClose,
  IconBanknote,
  IconCreditCard,
  IconSmartphone,
  IconRefresh,
  IconDownload,
} from "../components/icons.js";

type SaleStatusFilter = "all" | "completed" | "credit" | "voided";

const STATUS_FILTERS: ReadonlyArray<{ id: SaleStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "credit", label: "On credit" },
  { id: "voided", label: "Voided" },
];

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  completed: { cls: "dsk-badge--positive", label: "Completed" },
  credit: { cls: "dsk-badge--warning", label: "On credit" },
  voided: { cls: "dsk-badge--danger", label: "Voided" },
};

const METHOD_ICON: Record<string, typeof IconBanknote> = {
  CASH: IconBanknote,
  CARD: IconCreditCard,
  MOMO: IconSmartphone,
};

export interface SalesProps {
  runtime: DesktopRuntime | null;
  ready: DesktopReadyState | null;
  online: boolean;
  demoMode: boolean;
  onSignIn: () => void;
  onNavigate: (id: ScreenId) => void;
}

export function Sales({ runtime, ready, online, demoMode, onSignIn }: SalesProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SaleStatusFilter>("all");
  const [selected, setSelected] = useState<DesktopSaleRow | null>(null);
  const [sales, setSales] = useState<readonly DesktopSaleRow[]>(demoMode ? SAMPLE_SALES : []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (demoMode || !runtime || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime.api.getSales(ready.membership.businessId, ready.branch.id)
      .then((res: DesktopSaleListResponse) => {
        if (cancelled) return;
        setSales(res.items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demoMode, runtime, ready, online]);

  const rows = useMemo(() => {
    return sales.filter((s) => {
      const matchesQuery =
        !query ||
        s.receiptNo.toLowerCase().includes(query.toLowerCase()) ||
        s.customerName.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === "all" || s.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [sales, query, status]);

  if (demoMode) {
    return <SalesBody demoMode sales={rows} query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} selected={selected} onSelect={setSelected} />;
  }
  if (!ready || !runtime) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="sign-in-required" onSignIn={onSignIn} />
      </div>
    );
  }
  if (loading && sales.length === 0) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <div className="dsk-empty" style={{ minHeight: "320px" }}>
          <div className="dsk-empty__title">Loading sales\u2026</div>
        </div>
      </div>
    );
  }
  if (error && sales.length === 0) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="api-unavailable" detail={error} />
      </div>
    );
  }
  return <SalesBody sales={rows} query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} selected={selected} onSelect={setSelected} />;
}

function ScreenHeader() {
  return (
    <div className="dsk-screen__head">
      <div>
        <div className="dsk-screen__eyebrow">Money &amp; records</div>
        <h1 className="dsk-screen__title">Sales</h1>
        <p className="dsk-screen__subtitle">
          Posted receipts are immutable business evidence. Drill into a sale for line items,
          payment and correction actions.
        </p>
      </div>
      <div className="dsk-screen__actions">
        <button type="button" className="dsk-btn dsk-btn--outline dsk-btn--sm" disabled>
          <IconRefresh width={15} height={15} />
          Refresh
        </button>
        <button type="button" className="dsk-btn dsk-btn--outline dsk-btn--sm" disabled>
          <IconDownload width={15} height={15} />
          Export
        </button>
      </div>
    </div>
  );
}

function SalesBody({
  demoMode,
  sales,
  query,
  onQueryChange,
  status,
  onStatusChange,
  selected,
  onSelect,
}: {
  demoMode?: boolean;
  sales: readonly DesktopSaleRow[];
  query: string;
  onQueryChange: (v: string) => void;
  status: SaleStatusFilter;
  onStatusChange: (v: SaleStatusFilter) => void;
  selected: DesktopSaleRow | null;
  onSelect: (s: DesktopSaleRow | null) => void;
}) {
  return (
    <div className="dsk-screen">
      <ScreenHeader />
      {demoMode ? <DemoBanner /> : null}

      <div className="dsk-cmdbar">
        <div className="dsk-cmdbar__search">
          <IconSearch className="dsk-cmdbar__search-icon" />
          <input
            type="search"
            className="dsk-cmdbar__search-input"
            placeholder="Search receipt no. or customer\u2026"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search sales"
          />
        </div>
        <div role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="dsk-chip"
              aria-pressed={status === f.id ? "true" : "false"}
              onClick={() => onStatusChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="dsk-cmdbar__spacer" />
        <span className="dsk-text-muted" style={{ fontSize: 12 }}>
          {sales.length} {sales.length === 1 ? "sale" : "sales"}
        </span>
      </div>

      {sales.length === 0 ? (
        <div className="dsk-card">
          <EmptyState
            icon={<IconReceipt width={44} height={44} />}
            title="No sales match your filters"
            text="Adjust the search term or status filter to see more receipts. New sales appear here immediately after checkout."
            tag={demoMode ? "Sample data" : undefined}
          />
        </div>
      ) : (
        <div className="dsk-table__wrap">
          <table className="dsk-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Cashier</th>
                <th>Date</th>
                <th>Method</th>
                <th data-num>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const Icon = METHOD_ICON[s.method] ?? IconBanknote;
                return (
                  <tr
                    key={s.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => onSelect(s)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelect(s);
                    }}
                  >
                    <td>
                      <div className="dsk-table__cell-main">{s.receiptNo}</div>
                      <div className="dsk-table__cell-sub">{s.lines.length} lines</div>
                    </td>
                    <td>{s.customerName}</td>
                    <td className="dsk-text-muted">{s.cashierName}</td>
                    <td className="dsk-table__cell-mono">{fmtDateTime(s.occurredAt)}</td>
                    <td>
                      <span className="dsk-row" style={{ gap: 6 }}>
                        <Icon width={14} height={14} style={{ color: "var(--tos-text-muted)" }} />
                        {s.method}
                      </span>
                    </td>
                    <td data-num>
                      <span className="dsk-text-strong tnum">{fmtMoneyMinor(s.totalMinor)}</span>
                    </td>
                    <td>
                      <span className={`dsk-badge ${STATUS_BADGE[s.status]?.cls ?? "dsk-badge--neutral"}`}>
                        {STATUS_BADGE[s.status]?.label ?? s.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected ? <SaleDetailDialog sale={selected} onClose={() => onSelect(null)} /> : null}
    </div>
  );
}

function SaleDetailDialog({ sale, onClose }: { sale: DesktopSaleRow; onClose: () => void }) {
  const Icon = METHOD_ICON[sale.method] ?? IconBanknote;
  const subtotalMinor = sale.lines.reduce((s, l) => s + l.totalMinor, 0);
  return (
    <div
      className="dsk-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dsk-dialog dsk-dialog--lg" role="dialog" aria-modal="true" aria-labelledby="sale-title">
        <div className="dsk-dialog__head">
          <div>
            <h2 id="sale-title" className="dsk-dialog__title">
              {sale.receiptNo}
            </h2>
            <div className="dsk-dialog__sub">
              {sale.customerName} · {fmtDateTime(sale.occurredAt)} · {sale.cashierName}
            </div>
          </div>
          <button type="button" className="dsk-dialog__close" onClick={onClose} aria-label="Close">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="dsk-dialog__body">
          <div className="dsk-banner dsk-banner--neutral">
            <IconReceipt className="dsk-banner__icon" />
            <div className="dsk-banner__body">
              <div className="dsk-banner__title">Posted sale · immutable evidence</div>
              <div className="dsk-banner__text">
                This sale is recorded in the ledger. Corrections happen via returns or voids,
                never by editing the posted receipt.
              </div>
            </div>
          </div>
          <div className="dsk-table__wrap" style={{ maxHeight: "none" }}>
            <table className="dsk-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th data-ctr>Qty</th>
                  <th data-num>Unit</th>
                  <th data-num>Total</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <div className="dsk-table__cell-main">{l.name}</div>
                      <div className="dsk-table__cell-sub">per {l.unitLabel}</div>
                    </td>
                    <td data-ctr className="tnum">{l.quantity}</td>
                    <td data-num className="tnum">{fmtMoneyMinor(l.unitPriceMinor)}</td>
                    <td data-num className="tnum dsk-text-strong">{fmtMoneyMinor(l.totalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dsk-cart__totals" style={{ background: "var(--tos-surface-soft)" }}>
            <div className="dsk-cart__total-row">
              <span>Subtotal</span>
              <span className="tnum">{fmtMoneyMinor(subtotalMinor)}</span>
            </div>
            <div className="dsk-cart__total-row">
              <span>Paid via</span>
              <span className="dsk-row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Icon width={14} height={14} /> {sale.method}
              </span>
            </div>
            <div className="dsk-cart__total-row dsk-cart__total-row--grand">
              <span>Total</span>
              <span className="tnum">{fmtMoneyMinor(sale.totalMinor)}</span>
            </div>
          </div>
        </div>
        <div className="dsk-dialog__foot">
          <span className={`dsk-badge ${STATUS_BADGE[sale.status]?.cls ?? "dsk-badge--neutral"}`}>
            {STATUS_BADGE[sale.status]?.label ?? sale.status}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--tos-space-2)" }}>
            <button type="button" className="dsk-btn dsk-btn--outline dsk-btn--sm" disabled>
              Print
            </button>
            <button type="button" className="dsk-btn dsk-btn--primary dsk-btn--sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
