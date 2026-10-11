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
    status: string;
    currencyCode: string;
    totalMinor: number;
    completedAt: string | null;
    createdAt: string;
    customer: { id: string; name: string | null; phone: string | null } | null;
    lines: ReadonlyArray<{
      id: string;
      itemId: string;
      itemName: string;
      quantity: number;
      quantityReturnable: number;
      saleUnitCode: string;
      lineTotalMinor: number;
    }>;
    payments: ReadonlyArray<{ id: string; method: string; amountMinor: number; status: string }>;
  };
}

interface ReturnRefundSheetProps {
  saleId: string | null;
  mode: "return" | "refund";
  onClose: () => void;
  onComplete: () => void;
}

export function ReturnRefundSheet({ saleId, mode, onClose, onComplete }: ReturnRefundSheetProps) {
  const { session, role } = useWorkspace();
  const path = saleId && session
    ? `/v1/sales/${encodeURIComponent(saleId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error } = useApiFetch<SaleDetail>(path);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(role);

  useEffect(() => {
    if (data) {
      const initial: Record<string, number> = {};
      for (const line of data.sale.lines) initial[line.id] = 0;
      setQuantities(initial);
    }
  }, [data]);

  if (!saleId || !session) return null;

  const currency = data?.sale.currencyCode ?? session.currencyCode;

  const totalRefundMinor = data
    ? data.sale.lines.reduce((sum, l) => {
        const qty = quantities[l.id] ?? 0;
        if (qty <= 0) return sum;
        const unitPrice = l.quantity > 0 ? Math.round(l.lineTotalMinor / l.quantity) : 0;
        return sum + unitPrice * qty;
      }, 0)
    : 0;

  const handleSubmit = async () => {
    if (!data || busy || !canWrite) return;
    const lines = data.sale.lines
      .map((l) => ({ lineId: l.id, itemId: l.itemId, saleUnitCode: l.saleUnitCode, quantity: quantities[l.id] ?? 0 }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) {
      setSubmitError("Set a return quantity on at least one line.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const queue = getOfflineQueue();
      const mutationType = mode === "return" ? "RETURN_CREATE" : "REFUND_CREATE";
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType,
        payload: {
          originalSaleId: data.sale.id,
          lines,
        },
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      onComplete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label={mode === "return" ? "Process return" : "Issue refund"}>
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">{mode === "return" ? "Return" : "Refund"}</span>
            <h2 className="tos-sheet__title">{mode === "return" ? "Process return" : "Issue refund"}</h2>
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
              <div className="tos-callout tos-callout--warning">
                Returns and refunds are immutable once posted. The original sale is never edited — a corrective transaction is created.
              </div>
              <ul className="tos-list" style={{ border: "none", boxShadow: "none" }}>
                {data.sale.lines.map((line) => {
                  const qty = quantities[line.id] ?? 0;
                  const unitPrice = line.quantity > 0 ? Math.round(line.lineTotalMinor / line.quantity) : 0;
                  return (
                    <li key={line.id} className="tos-cart-line" style={{ gridTemplateColumns: "1fr auto" }}>
                      <div>
                        <div className="tos-cart-line__name">{line.itemName}</div>
                        <div className="tos-cart-line__sub">{line.quantity} × {line.saleUnitCode} · returnable: {line.quantityReturnable}</div>
                        <div className="tos-cart-line__qty" style={{ marginTop: "var(--tos-space-2)" }}>
                          <button
                            type="button"
                            className="tos-cart-line__qty-btn"
                            onClick={() => setQuantities((p) => ({ ...p, [line.id]: Math.max(0, qty - 1) }))}
                            aria-label="Decrease"
                          >−</button>
                          <span className="tos-cart-line__qty-val">{qty}</span>
                          <button
                            type="button"
                            className="tos-cart-line__qty-btn"
                            onClick={() => setQuantities((p) => ({ ...p, [line.id]: Math.min(line.quantityReturnable, qty + 1) }))}
                            aria-label="Increase"
                            disabled={qty >= line.quantityReturnable}
                          >+</button>
                        </div>
                      </div>
                      <div className="tos-cart-line__total">
                        {qty > 0 ? <MoneyValue minor={unitPrice * qty} currencyCode={currency} /> : <span className="tos-money-value tos-money-value--muted">—</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="tos-checkout-summary">
                <span className="tos-checkout-summary__total-key">{mode === "return" ? "Refund due" : "Refund total"}</span>
                <span className="tos-checkout-summary__total-val"><MoneyValue minor={totalRefundMinor} currencyCode={currency} tone="negative" /></span>
              </div>
              {submitError ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{submitError}</span></div> : null}
            </>
          ) : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={handleSubmit} loading={busy} disabled={!canWrite || !data || totalRefundMinor <= 0}>
            {canWrite ? (mode === "return" ? "Post return" : "Post refund") : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
