"use client";

import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { clientApi, messageFrom } from "../../lib/client-api";
import { readFeatureCache, writeFeatureCache } from "../../lib/feature-cache";
import { captureSessionEpoch, isSessionEpochCurrent } from "../../lib/session-lifecycle";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import type { PurchaseDetail, PurchaseDetailLine, PurchaseSummary } from "./types";

function isPurchaseDetail(value: unknown): value is PurchaseDetail {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PurchaseDetail>;
  return Boolean(row.purchase && Array.isArray(row.lines) && Array.isArray(row.returns));
}

export function purchaseReturnPreview(line: PurchaseDetailLine, quantity: number): number {
  const original = BigInt(Math.round(line.purchaseQuantity * 1e8));
  if (original <= 0n || !Number.isFinite(quantity) || quantity < 0 || quantity > line.remainingQuantity) return 0;
  const cumulative = BigInt(Math.round(line.returnedQuantity * 1e8)) + BigInt(Math.round(quantity * 1e8));
  return Number((BigInt(line.lineCostMinor) * cumulative + original / 2n) / original) - line.returnedRecoveryMinor;
}

export function PurchaseReturnSheet({ businessId, branchId, purchase, onClose, onMessage }: {
  businessId: string;
  branchId: string;
  purchase: PurchaseSummary;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const [lines, setLines] = useState<PurchaseDetailLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("CREDIT_NOTE");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousActive = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", keydown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown); previousActive.current?.focus(); };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const sessionEpoch = captureSessionEpoch();
    const cached = readFeatureCache("purchase-detail", businessId, branchId, purchase.id, isPurchaseDetail);
    if (cached) { setLines(cached.lines); setLoaded(true); }
    if (!navigator.onLine) {
      if (!cached) setLoadError("Offline: this purchase has not been opened on this device yet.");
      return () => { active = false; };
    }
    clientApi<PurchaseDetail>(`/api/tradeos/v1/purchases/${purchase.id}?businessId=${encodeURIComponent(businessId)}`)
      .then((data) => {
        if (!active || !isSessionEpochCurrent(sessionEpoch)) return;
        setLines(data.lines); setLoaded(true); setLoadError(null);
        writeFeatureCache("purchase-detail", businessId, branchId, data, purchase.id);
      })
      .catch((error) => { if (active && isSessionEpochCurrent(sessionEpoch) && !cached) setLoadError(messageFrom(error)); });
    return () => { active = false; };
  }, [businessId, branchId, purchase.id]);

  const preview = lines.reduce((sum, line) => sum + purchaseReturnPreview(line, Number(quantities[line.id] || 0)), 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const selected = lines.filter((line) => Number(quantities[line.id] || 0) > 0);
    if (!selected.length || selected.some((line) => !Number.isFinite(Number(quantities[line.id])) || Number(quantities[line.id]) > line.remainingQuantity)) {
      onMessage("Choose quantities within the remaining purchased quantities.");
      return;
    }
    setBusy(true);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(), clientMutationId: crypto.randomUUID(), businessId, branchId,
        mutationType: "PURCHASE_RETURN_CREATE", occurredAt: new Date().toISOString(),
        payload: {
          originalPurchaseId: purchase.id, supplierId: purchase.supplierId, recoveryMethod: method,
          lines: selected.map((line) => ({ purchaseLineId: line.id, quantity: Number(quantities[line.id]), sourceLocation: locations[line.id] || "AVAILABLE" })),
        },
      });
      onClose();
      if (!navigator.onLine) { onMessage("Purchase return saved offline; stock and recovery will post when synchronized."); return; }
      const result = await flushPendingMutations();
      onMessage(result.rejected ? "Purchase return needs review." : result.applied > 0 ? "Purchase return applied." : "Purchase return saved for synchronization.");
    } catch (error) { onMessage(messageFrom(error)); }
    finally { setBusy(false); }
  };

  return <div className="purchase-return-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="purchase-return-sheet" role="dialog" aria-modal="true" aria-labelledby="purchase-return-title" onSubmit={(event) => void submit(event)}>
      <header className="purchase-return-head">
        <div><span>Linked purchase correction</span><h2 id="purchase-return-title">Purchase return</h2><small>Return to {purchase.supplierName} · original receipt remains unchanged</small></div>
        <button ref={closeRef} className="purchase-return-close" aria-label="Close purchase return" type="button" onClick={onClose}>×</button>
      </header>
      <div className="purchase-return-scroll">
        {!loaded ? <StatePanel state={loadError?.startsWith("Offline:") ? "offline" : loadError ? "error" : "loading"} title={loadError ? "Purchase receipt unavailable" : "Loading original purchase"} description={loadError ?? "TradeOS is loading the returnable quantities from the posted receipt."} /> : <section className="purchase-return-lines" aria-label="Returnable purchase lines">
          <div className="purchase-return-section-head"><strong>Items returning to supplier</strong><span>Select quantities only from stock still available to reverse.</span></div>
          {lines.map((line) => <article className="purchase-return-line" key={line.id}>
            <div className="purchase-return-identity"><strong>{line.itemName}</strong><span>Remaining {formatQuantity(line.remainingQuantity)} {line.purchaseUnitCode} · originally {formatQuantity(line.purchaseQuantity)} {line.purchaseUnitCode}</span><small>{formatQuantity(line.stockQuantity)} {line.stockUnitCode} was posted to stock</small></div>
            <label>Return quantity ({line.purchaseUnitCode})<input type="number" min="0" max={line.remainingQuantity} step="0.00000001" disabled={line.remainingQuantity <= 0} value={quantities[line.id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
            <label>Stock source<select value={locations[line.id] || "AVAILABLE"} onChange={(event) => setLocations((current) => ({ ...current, [line.id]: event.target.value }))}><option value="AVAILABLE">Available stock</option><option value="QUARANTINE">Quarantine</option></select></label>
          </article>)}
        </section>}
        <section className="purchase-return-settlement">
          <label>Recovery method<select value={method} onChange={(event) => setMethod(event.target.value)}>{["CREDIT_NOTE","CASH","MOMO","CARD","BANK","OTHER"].map((value) => <option key={value} value={value}>{value === "CREDIT_NOTE" ? "Supplier credit note" : title(value)}</option>)}</select></label>
          <div><span>{method === "CREDIT_NOTE" ? "Supplier credit" : "Supplier recovery"} preview</span><strong>{formatMoney(preview, purchase.currencyCode)}</strong><small>Server validates stock and recovery before posting.</small></div>
        </section>
      </div>
      <footer className="purchase-return-footer"><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button disabled={busy || !loaded} type="submit">{busy ? "Saving…" : "Save purchase return"}</Button></footer>
    </form>
  </div>;
}

function formatMoney(minor: number, currencyCode: string): string { return currencyCode === "GHS" ? `₵${(minor / 100).toFixed(2)}` : new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100); }
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function title(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
