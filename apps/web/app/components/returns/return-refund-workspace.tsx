"use client";

import { useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { ReturnRefundSheet } from "./return-refund-sheet";
import { ExchangeSheet } from "./exchange-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconRefresh, IconReturns, IconSearch } from "../ui/icons";
import type { SaleSummary } from "../workspace/workspace-provider";

interface SalesResponse { sales: SaleSummary[] }

export function ReturnRefundWorkspace() {
  const { session, role } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [mode, setMode] = useState<"return" | "refund" | "exchange">("return");
  const path = session
    ? `/v1/sales?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=50${query ? `&query=${encodeURIComponent(query)}` : ""}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SalesResponse>(path);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(role);

  const open = (saleId: string, m: typeof mode) => {
    setSelectedSaleId(saleId);
    setMode(m);
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Trade</span>
          <h1 className="tos-page__title">Returns, refunds &amp; exchanges</h1>
          <p className="tos-page__subtitle">Corrective transactions on completed sales. The original receipt is never edited.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => refetch()}>Refresh</Button>
        </div>
      </header>

      {!canWrite ? (
        <div className="tos-callout tos-callout--info">
          You do not have permission to process returns or refunds. Only owners, admins, managers, and cashiers can.
        </div>
      ) : null}

      <div className="tos-toolbar">
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
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{data?.sales.length ?? 0} receipt(s)</span>
      </div>

      {loading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : error ? (
        <StatePanel variant="error" title="Could not load receipts" text={error} actionLabel="Retry" onAction={() => refetch()} />
      ) : (data?.sales.length ?? 0) === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconReturns className="tos-state__icon" />}
          title="No receipts to correct"
          text="Find the receipt you want to correct, then choose Return, Refund, or Exchange."
        />
      ) : (
        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>When</th>
                  <th data-align="right">Total</th>
                  {canWrite ? <th data-align="center">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {data!.sales.map((sale) => (
                  <tr key={sale.id}>
                    <td><span className="tos-table__cell-title tos-table__mono">{sale.id.slice(0, 8)}</span></td>
                    <td className="tos-table__muted">{sale.customer?.name ?? "Walk-in"}</td>
                    <td className="tos-table__muted">{sale.completedAt ? new Date(sale.completedAt).toLocaleDateString() : "—"}</td>
                    <td data-align="right"><MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} tone="muted" /></td>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedSaleId && (mode === "return" || mode === "refund") ? (
        <ReturnRefundSheet
          saleId={selectedSaleId}
          mode={mode}
          onClose={() => setSelectedSaleId(null)}
          onComplete={() => setSelectedSaleId(null)}
        />
      ) : null}
      {selectedSaleId && mode === "exchange" ? (
        <ExchangeSheet
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
          onComplete={() => setSelectedSaleId(null)}
        />
      ) : null}
    </div>
  );
}
