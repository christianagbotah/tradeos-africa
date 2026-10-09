"use client";

import React, { type FormEvent, useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import { CommandBar } from "../ui/command-bar";
import { MobileRecordCard } from "../ui/mobile-record-card";
import { StatePanel } from "../ui/state-panel";
import { StatusBadge } from "../ui/status-badge";
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
        <CommandBar ariaLabel="Return and refund sale search">
          <label className="return-command-search">
            <span>Find original sale</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Receipt, customer or phone" />
          </label>
          <Button variant="secondary" type="submit">Search</Button>
        </CommandBar>
      </form>

      <div className="return-sale-list" aria-busy={loading}>
        {loading && sales.length === 0 ? <StatePanel state="loading" title="Loading eligible sales" description="TradeOS is finding posted receipts that can be corrected." /> : null}
        {!loading && visible.length === 0 ? <StatePanel state="empty" title="No eligible sale found" description="Returns, refunds and exchanges always start from the original posted sale." /> : null}
        {visible.map((sale) => {
          const customer = sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer";
          const refunded = sale.refundTotalMinor > 0 ? `${formatMoney(sale.refundTotalMinor, sale.currencyCode)} already refunded` : "No refund yet";
          const tone = sale.refundTotalMinor > 0 || sale.status.includes("REFUND") ? "warning" : "positive";
          return (
            <React.Fragment key={sale.id}>
              <button type="button" className={selectedId === sale.id ? "return-sale-row return-sale-row--desktop active" : "return-sale-row return-sale-row--desktop"} onClick={() => onSelect(sale.id)}>
                <div><strong>{shortReceipt(sale.id)}</strong><span>{formatDate(sale.completedAt ?? sale.createdAt)}</span></div>
                <div><strong>{customer}</strong><span>{sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"}</span></div>
                <div><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong><span>{refunded}</span></div>
                <StatusBadge tone={tone}>{humanize(sale.status)}</StatusBadge>
              </button>
              <div className="return-sale-row--mobile">
                <MobileRecordCard
                  title={<span>{shortReceipt(sale.id)} · {customer}</span>}
                  meta={<span>{formatDate(sale.completedAt ?? sale.createdAt)} · {sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"}</span>}
                  status={<StatusBadge tone={tone}>{humanize(sale.status)}</StatusBadge>}
                  actions={<Button variant="secondary" type="button" onClick={() => onSelect(sale.id)}>Choose sale</Button>}
                >
                  <p><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong> · {refunded}</p>
                </MobileRecordCard>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

function shortReceipt(id: string): string { return `#${id.slice(0, 8).toUpperCase()}`; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }