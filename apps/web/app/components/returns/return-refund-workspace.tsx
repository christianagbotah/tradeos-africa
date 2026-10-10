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
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Receipt, customer or phone"
            />
          </label>
          <Button variant="secondary" type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</Button>
        </CommandBar>
      </form>

      <div className="return-sale-list" aria-busy={loading}>
        <div className="return-sale-head" aria-hidden="true">
          <span>Original receipt</span><span>Customer</span><span>Sale value</span><span>Status</span><span />
        </div>

        {loading && sales.length === 0 ? (
          <div className="return-sale-state">
            <StatePanel state="loading" title="Loading completed sales…" description="TradeOS is finding posted receipts that can be used as correction evidence." />
          </div>
        ) : null}
        {!loading && visible.length === 0 ? (
          <div className="return-sale-state">
            <StatePanel state="empty" title="No eligible sale found." description="Returns, refunds and exchanges always start from the original posted sale." />
          </div>
        ) : null}

        {visible.length > 0 ? (
          <div className="return-sale-records">
            {visible.map((sale) => {
              const customer = sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer";
              const date = formatDate(sale.completedAt ?? sale.createdAt);
              const active = selectedId === sale.id;
              const refundCopy = sale.refundTotalMinor > 0
                ? `${formatMoney(sale.refundTotalMinor, sale.currencyCode)} already refunded`
                : "No refund yet";
              return (
                <React.Fragment key={sale.id}>
                  <article className={active ? "return-sale-row return-sale-row--desktop active" : "return-sale-row return-sale-row--desktop"}>
                    <button type="button" className="return-sale-open" onClick={() => onSelect(sale.id)} aria-pressed={active}>
                      <div className="return-sale-cell return-sale-receipt">
                        <span className="return-sale-evidence-label">Original posted sale</span>
                        <strong>{shortReceipt(sale.id)}</strong>
                        <small>{date}</small>
                      </div>
                      <div className="return-sale-cell">
                        <strong>{customer}</strong>
                        <small>{sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"}</small>
                      </div>
                      <div className="return-sale-cell">
                        <strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong>
                        <small>{refundCopy}</small>
                      </div>
                      <StatusBadge tone={sale.refundTotalMinor > 0 ? "warning" : "positive"}>{humanize(sale.status)}</StatusBadge>
                      <span className="return-sale-review">Review sale</span>
                    </button>
                  </article>

                  <div className={active ? "return-sale-row--mobile active" : "return-sale-row--mobile"}>
                    <MobileRecordCard
                      title={<span>{shortReceipt(sale.id)} · {customer}</span>}
                      meta={<span>Original posted sale · {date} · {sale.cashierName ? `Served by ${sale.cashierName}` : "Staff sale"}</span>}
                      status={<StatusBadge tone={sale.refundTotalMinor > 0 ? "warning" : "positive"}>{humanize(sale.status)}</StatusBadge>}
                      actions={<Button variant="secondary" type="button" onClick={() => onSelect(sale.id)}>Review sale</Button>}
                    >
                      <div className="return-mobile-evidence">
                        <p><span>Sale value</span><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong></p>
                        <p><span>Refund history</span><strong>{refundCopy}</strong></p>
                      </div>
                    </MobileRecordCard>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function shortReceipt(id: string): string { return `#${id.slice(0, 8).toUpperCase()}`; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
