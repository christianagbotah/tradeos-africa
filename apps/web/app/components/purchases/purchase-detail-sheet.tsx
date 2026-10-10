"use client";

import React, { useEffect, useRef } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import { PostedHistoryNote } from "../business/transaction-evidence";
import type { PurchaseDetail, PurchaseSummary } from "./types";

export function PurchaseDetailSheet({ open, purchase, detail, canReturn, onClose, onReturn }: {
  open: boolean;
  purchase: PurchaseSummary | null;
  detail: PurchaseDetail | null;
  canReturn: boolean;
  onClose: () => void;
  onReturn: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousActive = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", keydown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown); previousActive.current?.focus(); };
  }, [onClose, open]);
  if (!open || !purchase) return null;
  return <div className="purchase-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={sheetRef} className="purchase-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="purchase-detail-title">
      <header className="purchase-detail-head"><div><span>Posted purchase receipt</span><h2 id="purchase-detail-title">{purchase.supplierName}</h2><small>{purchase.supplierReference ?? `Receipt ${purchase.id.slice(0, 8)}`}</small></div><button ref={closeRef} type="button" aria-label="Close purchase receipt" onClick={onClose}>×</button></header>
      <div className="purchase-detail-scroll">
        <PostedHistoryNote subject="Purchase receipt" correction="linked purchase-return events" title="Recorded receipt is read-only." />
        <div className="purchase-detail-metrics">
          <div><span>Total</span><strong>{formatMoney(purchase.totalMinor, purchase.currencyCode)}</strong></div>
          <div><span>Settlement</span><strong>{title(purchase.settlementMethod)}</strong></div>
          <div><span>Received</span><strong>{formatDate(purchase.receivedAt)}</strong></div>
          <div><span>Received by</span><strong>{purchase.receiverName ?? "Staff"}</strong></div>
        </div>
        {!detail ? <div className="inventory-empty">Loading receipt detail…</div> : <>
          <section className="purchase-detail-section"><div className="purchase-detail-section-head"><strong>Received lines</strong><span>Purchase-unit quantities and the stock quantity posted by the server</span></div>
            <div className="purchase-detail-lines">{detail.lines.map((line) => <div className="purchase-detail-line" key={line.id}>
              <div><strong>{line.itemName}</strong><span>{formatQuantity(line.purchaseQuantity)} {line.purchaseUnitCode} → {formatQuantity(line.stockQuantity)} {line.stockUnitCode}</span></div>
              <div><span>Unit cost</span><strong>{formatMoney(line.unitCostMinor, purchase.currencyCode)}</strong></div>
              <div><span>Line total</span><strong>{formatMoney(line.lineCostMinor, purchase.currencyCode)}</strong></div>
              <div><span>Returnable</span><strong>{formatQuantity(line.remainingQuantity)} {line.purchaseUnitCode}</strong></div>
            </div>)}</div>
          </section>
          {detail.returns.length > 0 ? <section className="purchase-detail-section"><div className="purchase-detail-section-head"><strong>Linked corrections</strong><span>Purchase returns are separate posted events</span></div>{detail.returns.map((item) => <div className="purchase-correction-row" key={item.id}><span>{title(item.recoveryMethod)} · {formatDate(item.occurredAt)}</span><strong>{formatMoney(item.supplierRecoveryMinor, purchase.currencyCode)}</strong></div>)}</section> : null}
        </>}
      </div>
      <footer className="purchase-detail-footer"><Button variant="ghost" type="button" onClick={onClose}>Close</Button>{canReturn && detail?.lines.some((line) => line.remainingQuantity > 0) ? <Button variant="secondary" type="button" onClick={onReturn}>Create purchase return</Button> : null}</footer>
    </div>
  </div>;
}

function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function title(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
