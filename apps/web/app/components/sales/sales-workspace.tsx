"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { SaleDetailSheet } from "./sale-detail-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { IconRefresh, IconSales, IconSearch } from "../ui/icons";
import { Button } from "../ui/button";
import type { SaleSummary } from "../workspace/workspace-provider";

interface SalesResponse {
  sales: SaleSummary[];
}

export function SalesWorkspace() {
  const { session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const path = session
    ? `/v1/sales?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=50${query ? `&query=${encodeURIComponent(query)}` : ""}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SalesResponse>(path);

  const sales = useMemo(() => data?.sales ?? [], [data]);

  if (loading) {
    return (
      <div className="tos-page">
        <SalesHeader onRefresh={() => { refetch(); setNonce((n) => n + 1); }} />
        <div className="tos-card tos-card--padded">
          <StatePanel inline variant="loading" title="Loading sales…" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tos-page">
        <SalesHeader onRefresh={() => { refetch(); setNonce((n) => n + 1); }} />
        <StatePanel variant="error" title="Could not load sales" text={error} actionLabel="Retry" onAction={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="tos-page">
      <SalesHeader onRefresh={() => { refetch(); setNonce((n) => n + 1); }} />
      <div className="tos-toolbar">
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
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{sales.length} receipt(s)</span>
      </div>

      {sales.length === 0 ? (
        <StatePanel
          variant="empty"
          title="No sales yet"
          text="Sales you complete in the POS will appear here as immutable receipts."
          actionLabel="Open POS"
          onAction={() => { window.location.href = "/sell"; }}
        />
      ) : (
        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>Cashier</th>
                  <th>When</th>
                  <th data-align="right">Total</th>
                  <th data-align="center">Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} data-clickable="true" onClick={() => setSelectedId(sale.id)}>
                    <td>
                      <div className="tos-table__cell-main">
                        <span className="tos-table__cell-title tos-table__mono">{sale.id.slice(0, 8)}</span>
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
                    <td data-align="right">
                      <span className="tos-table__num">
                        <MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} tone="muted" />
                      </span>
                    </td>
                    <td data-align="center">
                      <span className={`tos-badge ${sale.status === "COMPLETED" ? "tos-badge--positive" : sale.status === "VOID" ? "tos-badge--danger" : "tos-badge--neutral"}`}>
                        <span className="tos-badge__dot" />{sale.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SaleDetailSheet saleId={selectedId} onClose={() => setSelectedId(null)} />
      {/* nonce is intentionally read to force re-render on refresh */}
      <span hidden aria-hidden="true">{nonce}</span>
    </div>
  );
}

function SalesHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <header className="tos-page__head">
      <div className="tos-page__heading">
        <span className="tos-page__eyebrow">TradeOS</span>
        <h1 className="tos-page__title">Sales</h1>
        <p className="tos-page__subtitle">Every completed sale is an immutable receipt. Tap a row to view evidence.</p>
      </div>
      <div className="tos-page__actions">
        <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={onRefresh}>Refresh</Button>
      </div>
    </header>
  );
}
