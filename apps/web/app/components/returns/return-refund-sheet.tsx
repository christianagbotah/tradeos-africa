"use client";

import React, { useEffect, useRef } from "react";
import { formatMoney } from "@tradeos/contracts";
import { Button } from "../ui/button";
import { ActorReasonEvidence, PostedHistoryNote, TransactionStatusBadge } from "../business/transaction-evidence";
import type { SaleDetail, SaleLine } from "../sales/types";

export type ReturnMode = "RETURN_REFUND" | "REFUND_ONLY" | "EXCHANGE";
export type RefundMethod = "ORIGINAL_METHOD" | "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT";
export type ReturnDisposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_RETURNED" | "NOT_APPLICABLE";
export type ReturnLineDraft = { selected: boolean; quantity: string; disposition: ReturnDisposition };

type Props = {
  sale: SaleDetail;
  open: boolean;
  drafts: Record<string, ReturnLineDraft>;
  mode: ReturnMode;
  refundMethod: RefundMethod;
  reason: string;
  busy: boolean;
  refundPreviewMinor: number;
  selectedLineCount: number;
  onClose: () => void;
  onModeChange: (mode: ReturnMode) => void;
  onRefundMethodChange: (method: RefundMethod) => void;
  onReasonChange: (reason: string) => void;
  onDraftChange: (lineId: string, patch: Partial<ReturnLineDraft>) => void;
  onSubmit: () => void;
};

type SyncOutcome = { rejected: number; received: number; applied: number };

export function returnSyncMessage(summary: SyncOutcome): string {
  if (summary.rejected > 0) return "Return/refund needs review before it can be applied. Open Sync issues to resolve the rejected correction.";
  if (summary.received > 0 || summary.applied === 0) return "Return/refund is saved and pending synchronization.";
  return "Return/refund applied. MoMo, card or bank reversals may remain processing until the provider confirms them.";
}

export function ReturnRefundSheet(props: Props) {
  const { sale, open, drafts, mode, refundMethod, reason, busy, refundPreviewMinor, selectedLineCount } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousActive = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
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
  }, [open, props.onClose]);

  if (!open) return null;

  return (
    <div className="return-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div ref={sheetRef} className="return-refund-sheet" role="dialog" aria-modal="true" aria-labelledby="return-refund-title">
        <header className="return-sheet-header">
          <div><span>Original sale {shortReceipt(sale.id)}</span><h2 id="return-refund-title">Return &amp; refund</h2><small>{formatDate(sale.completedAt ?? sale.createdAt)} · {sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</small></div>
          <button ref={closeRef} type="button" className="return-sheet-close" aria-label="Close return" onClick={props.onClose}>×</button>
        </header>

        <div className="return-sheet-scroll">
          <section className="return-original-evidence" aria-label="Original posted sale evidence">
            <div className="return-original-evidence-head">
              <div>
                <span>Posted receipt · read only</span>
                <strong>{shortReceipt(sale.id)}</strong>
              </div>
              <TransactionStatusBadge status={sale.status} label={humanize(sale.status)} />
            </div>
            <div className="return-original-evidence-grid">
              <div><span>Original total</span><strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong></div>
              <div><span>Sold at</span><strong>{formatDate(sale.completedAt ?? sale.createdAt)}</strong></div>
              <div><span>Customer</span><strong>{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</strong></div>
            </div>
            <p>This correction will be linked to the original sale. Posted receipt values remain unchanged.</p>
          </section>

          <section className="return-sheet-section">
            <div className="return-sheet-section-heading"><div><strong>Correction type</strong><span>TradeOS records a linked correction; the original receipt never changes.</span></div></div>
            <PostedHistoryNote subject="Original sale" correction="linked returns, refunds or exchanges" />
            <div className="return-sheet-modes">
              <button type="button" aria-pressed={mode === "RETURN_REFUND"} className={mode === "RETURN_REFUND" ? "active" : undefined} onClick={() => props.onModeChange("RETURN_REFUND")}><strong>Return + refund</strong><span>Physical product comes back where applicable.</span></button>
              <button type="button" aria-pressed={mode === "REFUND_ONLY"} className={mode === "REFUND_ONLY" ? "active" : undefined} onClick={() => props.onModeChange("REFUND_ONLY")}><strong>Refund only</strong><span>Customer keeps the item; stock is unchanged.</span></button>
              <button type="button" aria-pressed={mode === "EXCHANGE"} className={mode === "EXCHANGE" ? "active" : undefined} onClick={() => props.onModeChange("EXCHANGE")}><strong>Exchange items</strong><span>Return selected items and choose replacements in one linked correction.</span></button>
            </div>
          </section>

          <section className="return-sheet-section">
            <div className="return-sheet-section-heading"><div><strong>Returnable lines</strong><span>Select only quantities still available for correction.</span></div></div>
            <div className="return-sheet-lines">{sale.lines.map((line) => <ReturnLine key={line.id} line={line} currencyCode={sale.currencyCode} draft={drafts[line.id]} mode={mode} onChange={(patch) => props.onDraftChange(line.id, patch)} />)}</div>
          </section>

          <section className="return-sheet-section return-consequence-section" aria-label="Correction consequences">
            <div className="return-sheet-section-heading"><div><strong>What this correction will do</strong><span>Preview the operational effect before recording the correction.</span></div></div>
            <div className="return-consequence-grid">
              <div>
                <span>Stock outcome</span>
                <strong>{stockOutcome(mode, sale.lines, drafts)}</strong>
                <small>{mode === "REFUND_ONLY" ? "The customer keeps the item; inventory is not increased." : "Product stock follows the selected disposition. Services never create stock."}</small>
              </div>
              <div>
                <span>Refund outcome</span>
                <strong>{formatMoney(refundPreviewMinor, sale.currencyCode)}</strong>
                <small>Final financial, tax, cash and provider effects are validated by TradeOS when the correction syncs.</small>
              </div>
            </div>
          </section>

          <section className="return-sheet-section">
            <div className="return-sheet-section-heading"><div><strong>Refund destination</strong><span>Cash and customer credit settle immediately. MoMo, card and bank reversals remain processing until the provider confirms them.</span></div></div>
            <div className="return-refund-fields">
              <label>Refund method<select value={refundMethod} onChange={(event) => props.onRefundMethodChange(event.target.value as RefundMethod)}><option value="ORIGINAL_METHOD">Original payment method</option><option value="CASH">Cash</option><option value="MOMO">MoMo</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="CUSTOMER_CREDIT">Customer credit</option></select></label>
              <label>Reason<input required aria-required="true" value={reason} onChange={(event) => props.onReasonChange(event.target.value)} placeholder="Why is this return/refund needed?" /></label>
            </div>
          </section>

          <section className="return-sheet-preview">
            <div><span>Refund preview</span><strong>{formatMoney(refundPreviewMinor, sale.currencyCode)}</strong></div>
            <div><span>Selected lines</span><strong>{selectedLineCount}</strong></div>
            <div><span>Audit</span><strong>Actor + reason recorded</strong></div>
            <ActorReasonEvidence actor="Authenticated staff" reason={reason || "Reason required"} />
          </section>
        </div>

        <footer className="return-sheet-footer">
          <Button variant="ghost" type="button" onClick={props.onClose}>Cancel</Button>
          <Button type="button" disabled={busy || selectedLineCount === 0 || !reason.trim()} onClick={props.onSubmit}>{busy ? "Processing…" : mode === "REFUND_ONLY" ? "Process refund only" : "Process return / refund"}</Button>
        </footer>
      </div>
    </div>
  );
}

function ReturnLine({ line, currencyCode, draft, mode, onChange }: { line: SaleLine; currencyCode: string; draft: ReturnLineDraft | undefined; mode: ReturnMode; onChange: (patch: Partial<ReturnLineDraft>) => void }) {
  const disabled = line.quantityReturnable <= 0;
  return (
    <div className={disabled ? "return-sheet-line exhausted" : "return-sheet-line"}>
      <label className="return-line-check"><input type="checkbox" disabled={disabled} checked={Boolean(draft?.selected)} onChange={(event) => onChange({ selected: event.target.checked })} /><span><strong>{line.itemName}</strong><small>{formatQuantity(line.quantityReturnable)} of {formatQuantity(line.quantity)} {line.saleUnitCode} returnable</small></span></label>
      <label>Qty<input type="number" min="0.00000001" max={line.quantityReturnable} step="any" disabled={disabled || !draft?.selected} value={draft?.quantity ?? "0"} onChange={(event) => onChange({ quantity: event.target.value })} /></label>
      <DispositionControl line={line} draft={draft} mode={mode} onChange={(disposition) => onChange({ disposition })} />
      <div className="return-line-amount"><span>Original line</span><strong>{formatMoney(line.lineTotalMinor, currencyCode)}</strong></div>
    </div>
  );
}

function DispositionControl({ line, draft, mode, onChange }: { line: SaleLine; draft: ReturnLineDraft | undefined; mode: ReturnMode; onChange: (value: ReturnDisposition) => void }) {
  if (mode === "REFUND_ONLY") return <div className="return-stock-effect"><span>Stock</span><strong>No stock return</strong></div>;
  if (line.itemKind === "SERVICE") return <div className="return-stock-effect"><span>Stock</span><strong>Not applicable</strong></div>;
  if (line.itemKind === "PREPARED_PRODUCT") return <div className="return-stock-effect"><span>Returned item</span><strong>Discard / waste</strong></div>;
  return <label>Returned stock<select disabled={!draft?.selected} value={draft?.disposition ?? "RESTOCK"} onChange={(event) => onChange(event.target.value as ReturnDisposition)}><option value="RESTOCK">Available stock</option><option value="QUARANTINE">Quarantine / inspect</option><option value="DISCARD">Discard / unusable</option></select></label>;
}


function stockOutcome(mode: ReturnMode, lines: SaleLine[], drafts: Record<string, ReturnLineDraft>): string {
  if (mode === "REFUND_ONLY") return "Stock unchanged";
  const selected = lines.filter((line) => drafts[line.id]?.selected);
  if (selected.length === 0) return "Choose a line to preview stock";
  if (selected.some((line) => line.itemKind === "PREPARED_PRODUCT")) return "Prepared items → discard / waste";
  if (selected.every((line) => line.itemKind === "SERVICE")) return "No stock movement for services";
  return "Selected products follow disposition";
}

function shortReceipt(id: string): string { return `#${id.slice(0, 8).toUpperCase()}`; }
function humanize(value: string): string { return value.replaceAll("_", " "); }
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }