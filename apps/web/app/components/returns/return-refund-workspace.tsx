"use client";

import React, { type FormEvent, useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import type { SaleSummary } from "../sales/types";

type Props = {
  sales: SaleSummary[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (saleId: string) => void;
  onSearch: (query: string) => void;
};

export function ReturnRefundWorkspace({ sales, selectedId, loading, onSelect, onSearch }: Props) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sales;
    return sales.filter((sale) => [sale.id, sale.customer?.name ?? "", sale.customer?.phone ?? "", sale.cashierName ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalized));
  }, [query, sales]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query);
  };

  return (
    <section className="return-workspace-shell" aria-label="Return and refund sales">
      <form className="return-commandbar" onSubmit={submit}>
        <label><span>Find original sale</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Receipt, customer or phone" /></label>
        <Button variant="secondary" type="submit">Search</Button>
      </form>

      <div className="return-sale-list" aria-busy={loading}>
        {loading && sales.length === 0 ? <div className="return-sale-empty">Loading completed sales…</div> : null}
        {!loading && visible.length === 0 ? <div className="return-sale-empty"><strong>No eligible sale found.</strong><span>Returns and refunds always start from the original posted sale.</span></div> : null}
        {visible.map((sale) => (
          <button type="button" className={selectedId === sale.id ? "return-sale-row active" : "return-sale-row"} key={sale.id} onClick={() => onSelect(sale.id)}>
            <div><strong>{shortReceipt(sale.id)}</strong><span>{formatDate(sale.completedAt ?? sale.createdAt)}</span></div>
            <div><strong>{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</strong><span>{sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"}</span></div>
            <div><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong><span>{sale.refundTotalMinor > 0 ? `${formatMoney(sale.refundTotalMinor, sale.currencyCode)} already refunded` : "No refund yet"}</span></div>
            <span className="return-sale-status">{humanize(sale.status)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function shortReceipt(id: string): string { return `#${id.slice(0, 8).toUpperCase()}`; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }