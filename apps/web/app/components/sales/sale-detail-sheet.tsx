"use client";

import React, { useEffect, useRef } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import { PostedHistoryNote, TransactionStatusBadge } from "../business/transaction-evidence";
import type { SaleDetail } from "./types";

type Props = {
  sale: SaleDetail;
  open: boolean;
  canProcessReturns: boolean;
  onClose: () => void;
};

export function SaleDetailSheet({ sale, open, canProcessReturns, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousActive = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      previousActive.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  const refundedMinor = sale.payments.reduce((sum, payment) => sum + payment.refundedMinor, 0);

  return (
    <div className="sale-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="sale-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="sale-detail-title">
        <header className="sale-detail-sheet-header">
          <div><span>Posted receipt · read only</span><h2 id="sale-detail-title">Receipt {shortReceipt(sale.id)}</h2><small>{formatDate(sale.completedAt ?? sale.createdAt)} · {sale.cashierName ?? "Staff"}</small></div>
          <button ref={closeRef} type="button" className="sale-detail-close" aria-label="Close receipt" onClick={onClose}>×</button>
        </header>

        <div className="sale-detail-scroll">
          <section className="sale-detail-hero">
            <div><span>Total</span><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong><small><TransactionStatusBadge status={sale.status} label={humanize(sale.status)} /></small></div>
            <div><span>Customer</span><strong>{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</strong><small>{sale.customer?.phone ?? "No customer account attached"}</small></div>
            <div><span>Refunded</span><strong>{formatMoney(refundedMinor, sale.currencyCode)}</strong><small>{refundedMinor > 0 ? "Posted / processing refund evidence below" : "No refund recorded"}</small></div>
          </section>

          <section className="sale-detail-section">
            <div className="sale-detail-section-heading"><strong>Items & services</strong><span>Original line snapshots cannot be edited after posting</span></div>
            <div className="sale-detail-line-list">{sale.lines.map((line) => (
              <div className="sale-detail-evidence-row" key={line.id}>
                <div><strong>{line.itemName}</strong><span>{formatQuantity(line.quantity)} {line.saleUnitCode} · {humanize(line.itemKind)}</span></div>
                <div><span>Return state</span><strong>{formatQuantity(line.quantityReturned)} of {formatQuantity(line.quantity)} returned</strong></div>
                <div><span>Line total</span><strong>{formatMoney(line.lineTotalMinor, sale.currencyCode)}</strong></div>
              </div>
            ))}</div>
          </section>

          <section className="sale-detail-section">
            <div className="sale-detail-section-heading"><strong>Payments</strong><span>Refund status remains visible until external providers confirm reversals</span></div>
            <div className="sale-detail-payment-list">{sale.payments.map((payment) => (
              <div className="sale-detail-payment" key={payment.id}>
                <div><strong>{humanize(payment.method)}</strong><span>{payment.providerReference ?? "No provider reference"}</span></div>
                <div><span>Received</span><strong>{formatMoney(payment.amountMinor, sale.currencyCode)}</strong></div>
                <div><span>Status</span><TransactionStatusBadge status={payment.status} label={humanize(payment.status)} />{payment.refundedMinor > 0 ? <small>{formatMoney(payment.refundedMinor, sale.currencyCode)} refunded</small> : null}</div>
              </div>
            ))}</div>
          </section>

          <PostedHistoryNote subject="Sale receipt" correction="returns, refunds or exchanges" title="Immutable transaction history" />
        </div>

        <footer className="sale-detail-footer">
          <Button variant="ghost" type="button" onClick={onClose}>Close</Button>
          {canProcessReturns && sale.lines.some((line) => line.quantityReturnable > 0) ? <><a className="tos-button tos-button--secondary tos-button--default" href={`/returns?saleId=${encodeURIComponent(sale.id)}`}>Process return / refund</a><a className="tos-button tos-button--primary tos-button--default" href={`/returns?saleId=${encodeURIComponent(sale.id)}&mode=exchange`}>Exchange items</a></> : null}
        </footer>
      </div>
    </div>
  );
}

function shortReceipt(id: string): string { return `#${id.slice(0, 8).toUpperCase()}`; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }