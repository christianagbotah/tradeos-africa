"use client";

import React, { type FormEvent, useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import { CommandBar } from "../ui/command-bar";
import { MobileRecordCard } from "../ui/mobile-record-card";
import { StatusBadge } from "../ui/status-badge";
import type { SaleSummary } from "./types";

export type SalesFilters = {
  query: string;
  status: "ALL" | "COMPLETED" | "REFUNDED";
  payment: string;
  customer: "ALL" | "WALK_IN" | "NAMED";
};

type Props = {
  sales: SaleSummary[];
  selectedId: string | null;
  loading: boolean;
  canProcessReturns: boolean;
  onSelect: (saleId: string) => void;
  onSearch: (query: string) => void;
};

export function filterSales(sales: SaleSummary[], filters: SalesFilters): SaleSummary[] {
  const query = filters.query.trim().toLowerCase();
  return sales.filter((sale) => {
    const searchable = [sale.id, sale.customer?.name ?? "", sale.customer?.phone ?? "", sale.cashierName ?? ""]
      .join(" ")
      .toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (filters.status === "COMPLETED" && sale.status !== "COMPLETED") return false;
    if (filters.status === "REFUNDED" && sale.refundTotalMinor <= 0 && !sale.status.includes("REFUND")) return false;
    if (filters.payment !== "ALL" && !sale.payments.some((payment) => payment.method === filters.payment)) return false;
    if (filters.customer === "WALK_IN" && sale.customer !== null) return false;
    if (filters.customer === "NAMED" && sale.customer === null) return false;
    return true;
  });
}

export function SalesWorkspace({ sales, selectedId, loading, canProcessReturns, onSelect, onSearch }: Props) {
  const [filters, setFilters] = useState<SalesFilters>({ query: "", status: "ALL", payment: "ALL", customer: "ALL" });
  const visible = useMemo(() => filterSales(sales, filters), [filters, sales]);
  const paymentMethods = useMemo(() => [...new Set(sales.flatMap((sale) => sale.payments.map((payment) => payment.method)))].sort(), [sales]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(filters.query);
  };

  return (
    <section className="sales-workspace" aria-label="Sales history">
      <form className="sales-commandbar" onSubmit={submit}>
        <CommandBar ariaLabel="Sales filters">
        <label className="sales-command-search"><span>Search sales</span><input type="search" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Receipt, customer or phone" /></label>
        <label><span>Status</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as SalesFilters["status"] }))}><option value="ALL">All statuses</option><option value="COMPLETED">Completed</option><option value="REFUNDED">Refunded / partial</option></select></label>
        <label><span>Payment</span><select value={filters.payment} onChange={(event) => setFilters((current) => ({ ...current, payment: event.target.value }))}><option value="ALL">All payments</option>{paymentMethods.map((method) => <option value={method} key={method}>{humanize(method)}</option>)}</select></label>
        <label><span>Customer</span><select value={filters.customer} onChange={(event) => setFilters((current) => ({ ...current, customer: event.target.value as SalesFilters["customer"] }))}><option value="ALL">All customers</option><option value="WALK_IN">Walk-in customer</option><option value="NAMED">Named customer</option></select></label>
        <Button variant="secondary" type="submit">Search</Button>
        </CommandBar>
      </form>

      <div className="sales-history-shell" aria-busy={loading}>
        <div className="sales-history-head" aria-hidden="true"><span>Receipt</span><span>Customer</span><span>Payment</span><span>Total</span><span>Status</span><span /></div>
        {loading && sales.length === 0 ? <div className="sales-workspace-empty">Loading sales…</div> : null}
        {!loading && visible.length === 0 ? <div className="sales-workspace-empty"><strong>No sales match this view.</strong><span>Change the search or filters to review another receipt.</span></div> : null}
        <div className="sales-history-list">
          {visible.map((sale) => (
            <React.Fragment key={sale.id}>
            <article className={selectedId === sale.id ? "sales-history-row sales-history-row--desktop active" : "sales-history-row sales-history-row--desktop"}>
              <button type="button" className="sales-history-open" onClick={() => onSelect(sale.id)}>
                <div><strong>{shortReceipt(sale.id)}</strong><span>{formatDate(sale.completedAt ?? sale.createdAt)}</span></div>
                <div><strong>{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</strong><span>{sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"}</span></div>
                <div><strong>{sale.payments.length ? sale.payments.map((payment) => humanize(payment.method)).join(" + ") : "—"}</strong><span>{sale.payments.map((payment) => humanize(payment.status)).join(" · ")}</span></div>
                <div><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong><span>{sale.refundTotalMinor > 0 ? `${formatMoney(sale.refundTotalMinor, sale.currencyCode)} refunded` : "No refund"}</span></div>
                <div><span className={`sales-status sales-status--${sale.status.toLowerCase()}`}>{humanize(sale.status)}</span></div>
              </button>
              <div className="sales-history-actions">
                <Button variant="secondary" size="compact" type="button" onClick={() => onSelect(sale.id)}>View receipt</Button>
                {canProcessReturns ? <a className="tos-button tos-button--ghost tos-button--compact" href={`/returns?saleId=${encodeURIComponent(sale.id)}`}>Process return / refund</a> : null}
              </div>
            </article>
            {/* Mobile record-card representation */}
            <div className="sales-history-row--mobile">
              <MobileRecordCard
                title={<span>{shortReceipt(sale.id)} · {sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</span>}
                meta={<span>{formatDate(sale.completedAt ?? sale.createdAt)} · {sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"} · {sale.payments.length ? sale.payments.map((payment) => humanize(payment.method)).join(" + ") : "—"}</span>}
                status={<StatusBadge tone={sale.refundTotalMinor > 0 ? "warning" : "positive"}>{humanize(sale.status)}</StatusBadge>}
                actions={
                  <>
                    <Button variant="secondary" size="compact" type="button" onClick={() => onSelect(sale.id)}>View receipt</Button>
                    {canProcessReturns ? <a className="tos-button tos-button--ghost tos-button--compact" href={`/returns?saleId=${encodeURIComponent(sale.id)}`}>Process return / refund</a> : null}
                  </>
                }
              >
                <p><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong>{sale.refundTotalMinor > 0 ? ` · ${formatMoney(sale.refundTotalMinor, sale.currencyCode)} refunded` : " · No refund"}</p>
              </MobileRecordCard>
            </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function shortReceipt(id: string): string { return `#${id.slice(0, 8).toUpperCase()}`; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
