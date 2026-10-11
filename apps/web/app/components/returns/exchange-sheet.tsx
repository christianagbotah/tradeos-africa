"use client";

import { useEffect, useState } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

interface SaleDetail {
  sale: {
    id: string;
    businessId: string;
    branchId: string;
    currencyCode: string;
    lines: ReadonlyArray<{ id: string; itemId: string; itemName: string; quantity: number; quantityReturnable: number; saleUnitCode: string; lineTotalMinor: number }>;
  };
}

interface ExchangeSheetProps {
  saleId: string | null;
  onClose: () => void;
  onComplete: () => void;
}

export function ExchangeSheet({ saleId, onClose, onComplete }: ExchangeSheetProps) {
  const { session, role, catalog } = useWorkspace();
  const path = saleId && session
    ? `/v1/sales/${encodeURIComponent(saleId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error } = useApiFetch<SaleDetail>(path);
  const [returnLineId, setReturnLineId] = useState<string | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const [newQty, setNewQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(role);

  useEffect(() => {
    if (data && data.sale.lines.length > 0) {
      setReturnLineId(data.sale.lines[0]!.id);
    }
  }, [data]);

  if (!saleId || !session) return null;

  const currency = data?.sale.currencyCode ?? session.currencyCode;
  const activeCatalog = catalog.filter((c) => c.status === "ACTIVE");
  const returnLine = data?.sale.lines.find((l) => l.id === returnLineId);
  const returnUnit = returnLine && returnLine.quantity > 0 ? Math.round(returnLine.lineTotalMinor / returnLine.quantity) : 0;
  const newItem = activeCatalog.find((c) => c.id === newItemId);
  const newTotalMinor = newItem ? newItem.priceMinor * newQty : 0;
  const returnTotalMinor = returnLine ? returnUnit * Math.min(returnQty, returnLine.quantityReturnable) : 0;
  const netMinor = newTotalMinor - returnTotalMinor;

  const handleSubmit = async () => {
    if (!data || busy || !canWrite || !returnLine || !newItem) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: "EXCHANGE_CREATE",
        payload: {
          originalSaleId: data.sale.id,
          returnLines: [{ lineId: returnLine.id, itemId: returnLine.itemId, saleUnitCode: returnLine.saleUnitCode, quantity: Math.min(returnQty, returnLine.quantityReturnable) }],
          newLines: [{ itemId: newItem.id, saleUnitCode: newItem.saleUnitCode, quantity: newQty }],
        },
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      onComplete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit exchange.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label="Exchange">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Exchange</span>
            <h2 className="tos-sheet__title">Process exchange</h2>
            <p className="tos-sheet__sub">Receipt {saleId.slice(0, 8)}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="tos-sheet__body">
          {loading ? (
            <div className="tos-state tos-state--inline"><span className="tos-spinner" /></div>
          ) : error ? (
            <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div>
          ) : data ? (
            <>
              <div className="tos-section">
                <div className="tos-section__head"><h3 className="tos-section__title">Return from receipt</h3></div>
                <div className="tos-section__body--padded">
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-ret-line">Line item</label>
                    <select id="ex-ret-line" className="tos-select" value={returnLineId ?? ""} onChange={(e) => setReturnLineId(e.target.value)}>
                      {data.sale.lines.map((l) => (
                        <option key={l.id} value={l.id}>{l.itemName} ({l.quantityReturnable} returnable)</option>
                      ))}
                    </select>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-ret-qty">Quantity to return</label>
                    <input id="ex-ret-qty" type="number" min={1} max={returnLine?.quantityReturnable ?? 1} className="tos-input" value={returnQty} onChange={(e) => setReturnQty(Math.max(1, Number(e.target.value)))} />
                  </div>
                </div>
              </div>
              <div className="tos-section">
                <div className="tos-section__head"><h3 className="tos-section__title">New item</h3></div>
                <div className="tos-section__body--padded">
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-new-item">Replacement item</label>
                    <select id="ex-new-item" className="tos-select" value={newItemId ?? ""} onChange={(e) => setNewItemId(e.target.value || null)}>
                      <option value="">Select…</option>
                      {activeCatalog.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-new-qty">Quantity</label>
                    <input id="ex-new-qty" type="number" min={1} className="tos-input" value={newQty} onChange={(e) => setNewQty(Math.max(1, Number(e.target.value)))} />
                  </div>
                </div>
              </div>
              <div className="tos-checkout-summary">
                <span className="tos-checkout-summary__key">Return value</span>
                <span className="tos-checkout-summary__val"><MoneyValue minor={returnTotalMinor} currencyCode={currency} tone="negative" /></span>
                <span className="tos-checkout-summary__key">New item value</span>
                <span className="tos-checkout-summary__val"><MoneyValue minor={newTotalMinor} currencyCode={currency} /></span>
                <span className="tos-checkout-summary__total-key">{netMinor >= 0 ? "Customer pays" : "Refund due"}</span>
                <span className="tos-checkout-summary__total-val"><MoneyValue minor={Math.abs(netMinor)} currencyCode={currency} tone={netMinor > 0 ? "negative" : "positive"} /></span>
              </div>
              {submitError ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{submitError}</span></div> : null}
            </>
          ) : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!canWrite || !returnLine || !newItem}>
            {canWrite ? "Post exchange" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
