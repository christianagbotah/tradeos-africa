"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import type { ExchangeResult } from "@tradeos/contracts";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId, mutationAppliedEvent, type AppliedMutationDetail } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import { ProductBrowser } from "../pos/product-browser";
import { CartPanel } from "../pos/cart-panel";
import {
  addCartItem,
  changeCartUnit,
  removeCartLine,
  setCartQuantity,
  toPosSelection,
  type CartLine,
  type PosLineKey,
  type PosSellableItem,
} from "../pos/pos-model";
import type { SaleDetail } from "../sales/types";

export type ExchangeDisposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_APPLICABLE";
export type ExchangeSettlementMethod = "ORIGINAL_METHOD" | "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT";
export type ExchangeReturnDraft = { selected: boolean; quantity: string; disposition: ExchangeDisposition };

type ExchangeDraft = {
  reason: string;
  settlementMethod: ExchangeSettlementMethod;
  returned: Record<string, ExchangeReturnDraft>;
  cart: CartLine[];
};

type Props = {
  open: boolean;
  sale: SaleDetail;
  catalog: PosSellableItem[];
  businessId: string;
  branchId: string;
  onClose: () => void;
  onMessage: (message: string) => void;
};

export function buildExchangePayload(sale: SaleDetail, draft: ExchangeDraft) {
  return {
    originalSaleId: sale.id,
    reason: draft.reason.trim(),
    settlementMethod: draft.settlementMethod,
    returnedLines: sale.lines.flatMap((line) => {
      const selected = draft.returned[line.id];
      if (!selected?.selected) return [];
      const quantity = Number(selected.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.quantityReturnable) return [];
      return [{ saleLineId: line.id, quantity, disposition: exchangeDisposition(line.itemKind, selected.disposition) }];
    }),
    replacementLines: draft.cart.map((line) => ({ itemId: line.itemId, saleUnitCode: line.saleUnitCode, quantity: line.quantity })),
  };
}

export function exchangePreview(sale: SaleDetail, returned: Record<string, ExchangeReturnDraft>, cart: CartLine[]) {
  const returnedMinor = sale.lines.reduce((sum, line) => {
    const selected = returned[line.id];
    if (!selected?.selected) return sum;
    const quantity = Number(selected.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.quantityReturnable) return sum;
    return sum + Math.round((line.unitNetMinor + line.unitTaxMinor) * quantity);
  }, 0);
  const replacementMinor = cart.reduce((sum, line) => sum + Math.round(line.priceMinor * line.quantity), 0);
  const netDifferenceMinor = replacementMinor - returnedMinor;
  return {
    returnedMinor,
    replacementMinor,
    netDifferenceMinor,
    label: netDifferenceMinor > 0 ? "Customer pays" : netDifferenceMinor < 0 ? "Customer receives" : "No difference",
  } as const;
}

export function ExchangeSheet({ open, sale, catalog, businessId, branchId, onClose, onMessage }: Props) {
  const [returned, setReturned] = useState<Record<string, ExchangeReturnDraft>>({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("Customer exchange");
  const [settlementMethod, setSettlementMethod] = useState<ExchangeSettlementMethod>("ORIGINAL_METHOD");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [linkedResult, setLinkedResult] = useState<ExchangeResult | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const pendingMutationId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReturned(Object.fromEntries(sale.lines.map((line) => [line.id, {
      selected: false,
      quantity: line.quantityReturnable > 0 ? String(Math.min(1, line.quantityReturnable)) : "0",
      disposition: defaultDisposition(line.itemKind),
    }])));
    setCart([]);
    setQuery("");
    setReason("Customer exchange");
    setSettlementMethod("ORIGINAL_METHOD");
    setMessage(null);
    setLinkedResult(null);
    pendingMutationId.current = null;
  }, [open, sale]);

  useEffect(() => {
    if (!open) return;
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (!detail || detail.mutationType !== "EXCHANGE_CREATE" || detail.clientMutationId !== pendingMutationId.current) return;
      if (!isExchangeResult(detail.result)) return;
      setLinkedResult(detail.result);
      const text = detail.result.status === "PROCESSING"
        ? "Exchange applied. The linked correction is recorded; an external refund is still processing."
        : "Exchange applied. The linked replacement receipt and return correction are recorded.";
      setMessage(text);
      onMessage(text);
    };
    window.addEventListener(mutationAppliedEvent, onApplied);
    return () => window.removeEventListener(mutationAppliedEvent, onApplied);
  }, [onMessage, open]);

  useEffect(() => {
    if (!open) return;
    previousActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [onClose, open]);

  const preview = useMemo(() => exchangePreview(sale, returned, cart), [cart, returned, sale]);
  const payload = useMemo(() => buildExchangePayload(sale, { reason, settlementMethod, returned, cart }), [cart, reason, returned, sale, settlementMethod]);
  const canSubmit = payload.returnedLines.length > 0 && payload.replacementLines.length > 0 && Boolean(reason.trim());

  if (!open) return null;

  const updateReturned = (lineId: string, patch: Partial<ExchangeReturnDraft>) => {
    setReturned((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? { selected: false, quantity: "0", disposition: "RESTOCK" }), ...patch } }));
  };
  const addReplacement = (item: PosSellableItem) => setCart((current) => addCartItem(current, toPosSelection(item)));
  const increase = (key: PosLineKey) => setCart((current) => {
    const line = current.find((entry) => entry.key === key);
    return line ? setCartQuantity(current, key, line.quantity + 1) : current;
  });
  const decrease = (key: PosLineKey) => setCart((current) => {
    const line = current.find((entry) => entry.key === key);
    if (!line) return current;
    if (line.quantity <= 1) return removeCartLine(current, key);
    return setCartQuantity(current, key, line.quantity - 1);
  });

  const processExchange = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const clientMutationId = crypto.randomUUID();
      pendingMutationId.current = clientMutationId;
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId,
        businessId,
        branchId,
        mutationType: "EXCHANGE_CREATE",
        occurredAt: new Date().toISOString(),
        payload,
      });
      if (!navigator.onLine) {
        const text = "Exchange saved safely offline and is pending synchronization.";
        setMessage(text); onMessage(text); onClose(); return;
      }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) {
        const text = "Exchange needs review before it can be applied. Open Sync issues to resolve the rejected correction.";
        setMessage(text); onMessage(text); return;
      }
      if (summary.received > 0 || summary.applied === 0) {
        const text = "Exchange is saved and pending synchronization.";
        setMessage(text); onMessage(text); return;
      }
      const text = "Exchange applied. Linked transaction evidence is loading; provider refunds may remain processing until confirmed.";
      setMessage(text); onMessage(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : "The exchange could not be synchronized.";
      setMessage(text); onMessage(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="exchange-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="exchange-sheet" role="dialog" aria-modal="true" aria-labelledby="exchange-sheet-title">
        <header className="exchange-sheet-header">
          <div><span>Linked correction · original receipt stays read only</span><h2 id="exchange-sheet-title">Exchange items</h2><small>{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in customer"}</small></div>
          <button ref={closeRef} type="button" className="exchange-sheet-close" aria-label="Close exchange" onClick={onClose}>×</button>
        </header>
        <div className="exchange-sheet-scroll">
          <section className="exchange-section">
            <div className="exchange-section-heading"><strong>Items coming back</strong><span>Select quantities still returnable from the posted receipt.</span></div>
            <div className="exchange-return-lines">{sale.lines.map((line) => {
              const draft = returned[line.id];
              const exhausted = line.quantityReturnable <= 0;
              return <article className={exhausted ? "exchange-return-line exhausted" : "exchange-return-line"} key={line.id}>
                <label className="exchange-return-check"><input type="checkbox" disabled={exhausted} checked={Boolean(draft?.selected)} onChange={(event) => updateReturned(line.id, { selected: event.target.checked })} /><span><strong>{line.itemName}</strong><small>{formatQuantity(line.quantityReturnable)} {line.saleUnitCode} returnable</small></span></label>
                <label>Quantity<input type="number" step="any" min="0.000001" max={line.quantityReturnable} disabled={exhausted || !draft?.selected} value={draft?.quantity ?? "0"} onChange={(event) => updateReturned(line.id, { quantity: event.target.value })} /></label>
                {line.itemKind === "PRODUCT" ? <label>Disposition<select disabled={!draft?.selected} value={draft?.disposition ?? "RESTOCK"} onChange={(event) => updateReturned(line.id, { disposition: event.target.value as ExchangeDisposition })}><option value="RESTOCK">Return to available stock</option><option value="QUARANTINE">Quarantine / inspect</option><option value="DISCARD">Discard / unusable</option></select></label> : <div className="exchange-stock-note">{line.itemKind === "SERVICE" ? "No stock return" : "Returned item is discarded"}</div>}
              </article>;
            })}</div>
          </section>

          <section className="exchange-section exchange-replacement-section">
            <div className="exchange-section-heading"><strong>Replacement items</strong><span>Display prices are estimates only. TradeOS confirms current prices on the server when the exchange is applied.</span></div>
            <div className="exchange-search-label"><strong>Search replacements</strong><span>Find by item, service, SKU or selling unit.</span></div>
            <ProductBrowser items={catalog} query={query} currencyCode={sale.currencyCode} onQueryChange={setQuery} onAdd={addReplacement} />
            <div className="exchange-cart-help">After adding a replacement, use Decrease / Increase, direct quantity, unit selection or Remove to adjust the exchange cart.</div>
            <CartPanel cart={cart} items={catalog} currencyCode={sale.currencyCode} onIncrease={increase} onDecrease={decrease} onSetQuantity={(key, quantity) => setCart((current) => setCartQuantity(current, key, quantity))} onRemove={(key) => setCart((current) => removeCartLine(current, key))} onChangeUnit={(key, unit) => setCart((current) => changeCartUnit(current, key, toPosSelection(unit)))} />
          </section>

          <section className="exchange-section">
            <div className="exchange-section-heading"><strong>Difference preview</strong><span>Final amounts are recalculated by the server from current prices and accepted return quantities.</span></div>
            <div className="exchange-preview-grid"><div><span>Estimated return value</span><strong>{formatMoney(preview.returnedMinor, sale.currencyCode)}</strong></div><div><span>Estimated replacements</span><strong>{formatMoney(preview.replacementMinor, sale.currencyCode)}</strong></div><div className="exchange-preview-net"><span>{preview.label}</span><strong>{formatMoney(Math.abs(preview.netDifferenceMinor), sale.currencyCode)}</strong></div></div>
            <div className="exchange-settlement-grid">
              <label>Settlement method<select value={settlementMethod} onChange={(event) => setSettlementMethod(event.target.value as ExchangeSettlementMethod)}><option value="ORIGINAL_METHOD">Original payment method</option><option value="CASH">Cash</option><option value="MOMO">MoMo</option><option value="CARD">Card</option><option value="BANK">Bank</option>{sale.customer ? <option value="CUSTOMER_CREDIT">Customer credit</option> : null}</select></label>
              <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this exchange needed?" /></label>
            </div>
            {linkedResult ? <ExchangeLinkedResult result={linkedResult} /> : null}
            {message ? <div className="exchange-message" role="status">{message}</div> : null}
          </section>
        </div>
        <footer className="exchange-sheet-footer"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy || !canSubmit} onClick={() => void processExchange()}>{busy ? "Processing…" : "Process exchange"}</Button></footer>
      </div>
    </div>
  );
}

export function ExchangeLinkedResult({ result }: { result: ExchangeResult }) {
  return (
    <section className="exchange-linked-result" aria-label="Exchange linked transactions">
      <div className="exchange-linked-result-head"><strong>Exchange linked</strong><span>{result.status}</span></div>
      <div className="exchange-linked-result-grid">
        <div><span>Replacement receipt</span><strong>#{result.replacementSaleId.slice(0, 8).toUpperCase()}</strong></div>
        <div><span>Return correction</span><strong>#{result.returnCaseId.slice(0, 8).toUpperCase()}</strong></div>
      </div>
      <p>{result.status === "PROCESSING" ? "Provider refund confirmation is still processing. TradeOS keeps the exchange and correction linked while the external outcome completes." : "Replacement receipt and return correction are both posted and linked to this exchange."}</p>
    </section>
  );
}

function isExchangeResult(value: unknown): value is ExchangeResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExchangeResult>;
  return typeof candidate.exchangeCaseId === "string"
    && typeof candidate.returnCaseId === "string"
    && typeof candidate.replacementSaleId === "string"
    && typeof candidate.netDifferenceMinor === "number"
    && (candidate.status === "PROCESSING" || candidate.status === "COMPLETED");
}

function defaultDisposition(kind: SaleDetail["lines"][number]["itemKind"]): ExchangeDisposition {
  if (kind === "SERVICE") return "NOT_APPLICABLE";
  if (kind === "PREPARED_PRODUCT") return "DISCARD";
  return "RESTOCK";
}
function exchangeDisposition(kind: SaleDetail["lines"][number]["itemKind"], selected: ExchangeDisposition): ExchangeDisposition {
  return kind === "SERVICE" ? "NOT_APPLICABLE" : kind === "PREPARED_PRODUCT" ? "DISCARD" : selected;
}
function formatQuantity(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }