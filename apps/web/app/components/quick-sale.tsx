"use client";

import { useMemo, useState } from "react";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId } from "../lib/offline-sync";

type PaymentMethod = "CASH" | "MOMO" | "CUSTOMER_CREDIT";

export type QuickSaleItem = {
  key: string;
  itemId: string;
  name: string;
  unitCode: string;
  unitLabel: string;
  priceMinor: number;
};

type CartLine = QuickSaleItem & { quantity: number };

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  items: QuickSaleItem[];
};

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toFixed(2)}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}

export function QuickSale({ businessId, branchId, currencyCode, items }: Props) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalMinor = useMemo(
    () => cart.reduce((sum, line) => sum + line.priceMinor * line.quantity, 0),
    [cart],
  );
  const itemCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  const addItem = (item: QuickSaleItem) => {
    setMessage(null);
    setCart((current) => {
      const existing = current.find((line) => line.key === item.key);
      if (!existing) return [...current, { ...item, quantity: 1 }];
      return current.map((line) => line.key === item.key ? { ...line, quantity: line.quantity + 1 } : line);
    });
  };

  const recordSale = async () => {
    if (cart.length === 0 || saving) return;
    setSaving(true);

    try {
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        businessId,
        branchId,
        mutationType: "SALE_CREATE",
        occurredAt: new Date().toISOString(),
        payload: {
          currencyCode,
          paymentMethod,
          lines: cart.map(({ itemId, unitCode, quantity }) => ({
            itemId,
            saleUnitCode: unitCode,
            quantity,
          })),
        },
      });

      setCart([]);
      if (!navigator.onLine) {
        setMessage("Sale saved safely offline. It will sync automatically when the connection returns.");
        return;
      }

      const summary = await flushPendingMutations();
      if (summary.rejected > 0) setMessage("Sale was saved locally but needs review before it can sync.");
      else if (summary.applied > 0) setMessage("Sale recorded and synchronized.");
      else setMessage("Sale saved locally and queued for synchronization.");
    } catch {
      setMessage("Sale is saved on this device, but synchronization is not available right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="panel quick-sale" id="sell">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fast counter mode</p>
          <h2>Quick sale</h2>
        </div>
        <span className="workflow-badge">Server-priced</span>
      </div>

      {items.length === 0 ? (
        <div className="empty-sale-state">
          <strong>No sellable items yet</strong>
          <span>Add your first product or service to start selling.</span>
        </div>
      ) : (
        <div className="quick-items">
          {items.map((item) => {
            const quantity = cart.find((line) => line.key === item.key)?.quantity ?? 0;
            return (
              <button className="quick-item" key={item.key} type="button" onClick={() => addItem(item)}>
                <span>{item.name}</span>
                <small>{item.unitLabel}{quantity > 0 ? ` · ${quantity} selected` : ""}</small>
                <strong>{formatMoney(item.priceMinor, currencyCode)}</strong>
              </button>
            );
          })}
        </div>
      )}

      <div className="checkout-strip">
        <div>
          <span>Current sale</span>
          <strong>{itemCount} item{itemCount === 1 ? "" : "s"} · {formatMoney(totalMinor, currencyCode)}</strong>
          {message ? <small className="sale-message">{message}</small> : null}
        </div>
        <div className="payment-actions">
          <button className={paymentMethod === "CASH" ? "selected" : undefined} type="button" onClick={() => setPaymentMethod("CASH")}>Cash</button>
          <button className={paymentMethod === "MOMO" ? "selected" : undefined} type="button" onClick={() => setPaymentMethod("MOMO")}>MoMo</button>
          <button className={paymentMethod === "CUSTOMER_CREDIT" ? "selected" : undefined} type="button" onClick={() => setPaymentMethod("CUSTOMER_CREDIT")}>Pay later</button>
          <button className="checkout-button" type="button" disabled={cart.length === 0 || saving} onClick={() => void recordSale()}>
            {saving ? "Saving…" : `Record ${formatMoney(totalMinor, currencyCode)}`}
          </button>
        </div>
      </div>
    </article>
  );
}
