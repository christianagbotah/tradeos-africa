"use client";

import React, { useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import { CommandBar } from "../ui/command-bar";
import { MobileRecordCard } from "../ui/mobile-record-card";
import { StatePanel } from "../ui/state-panel";
import { StatusBadge } from "../ui/status-badge";
import type { PurchaseSummary } from "./types";

export function filterPurchases(purchases: PurchaseSummary[], query: string): PurchaseSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return purchases;
  return purchases.filter((purchase) => [
    purchase.supplierName, purchase.supplierReference ?? "", purchase.receiverName ?? "",
    purchase.settlementMethod.replaceAll("_", " "), purchase.id,
  ].join(" ").toLowerCase().includes(normalized));
}

export function PurchaseWorkspace({ purchases, loadingId, onOpen }: {
  purchases: PurchaseSummary[];
  loadingId: string | null;
  onOpen: (purchase: PurchaseSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterPurchases(purchases, query), [purchases, query]);
  return <section className="purchase-workspace">
    <div className="purchase-workspace-head"><div><span>Posted receiving history</span><h3>Recent purchases</h3><p>Posted receipts are read-only business evidence. Open a receipt to inspect it or create a linked purchase return.</p></div><strong>{purchases.length} receipt{purchases.length === 1 ? "" : "s"}</strong></div>
    <div className="purchase-commandbar">
      <CommandBar ariaLabel="Purchase receipt search">
        <label className="purchase-search"><span>Search purchases</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Supplier, invoice, payment or receipt ID" /></label>
      </CommandBar>
    </div>
    <div className="purchase-history-list">
      {visible.length === 0 ? <StatePanel state="empty" title="No purchase receipts match this view" description="Change the search to review another posted receiving receipt." /> : visible.map((purchase) => (
        <React.Fragment key={purchase.id}>
          <article className="purchase-history-row purchase-history-row--desktop">
            <div className="purchase-history-identity"><strong>{purchase.supplierName}</strong><span>{purchase.supplierReference ?? `Receipt ${purchase.id.slice(0, 8)}`} · {formatDate(purchase.receivedAt)}</span></div>
            <div className="purchase-history-fact"><span>Total</span><strong>{formatMoney(purchase.totalMinor, purchase.currencyCode)}</strong></div>
            <div className="purchase-history-fact"><span>Settlement</span><strong>{title(purchase.settlementMethod)}</strong><small>{purchase.receiverName ?? "Staff"}</small></div>
            <div className="purchase-history-fact"><span>Lines</span><strong>{purchase.lineCount}</strong></div>
            <Button variant="secondary" type="button" disabled={loadingId === purchase.id} onClick={() => onOpen(purchase)}>{loadingId === purchase.id ? "Opening…" : "Open receipt"}</Button>
          </article>
          <div className="purchase-history-row--mobile">
            <MobileRecordCard
              title={purchase.supplierName}
              meta={<span>{purchase.supplierReference ?? `Receipt ${purchase.id.slice(0, 8)}`} · {formatDate(purchase.receivedAt)} · {purchase.receiverName ?? "Staff"}</span>}
              status={<StatusBadge tone="info">{title(purchase.settlementMethod)}</StatusBadge>}
              actions={<Button variant="secondary" type="button" disabled={loadingId === purchase.id} onClick={() => onOpen(purchase)}>{loadingId === purchase.id ? "Opening…" : "Open receipt"}</Button>}
            >
              <p><strong>{formatMoney(purchase.totalMinor, purchase.currencyCode)}</strong> · {purchase.lineCount} line{purchase.lineCount === 1 ? "" : "s"}</p>
            </MobileRecordCard>
          </div>
        </React.Fragment>
      ))}
    </div>
  </section>;
}

function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function title(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
