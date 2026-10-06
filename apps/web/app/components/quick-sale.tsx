"use client";

import { useMemo, useState } from "react";

type PaymentMethod = "CASH" | "MOMO" | "CUSTOMER_CREDIT";

type QuickItem = {
  id: string;
  name: string;
  unit: string;
  priceMinor: number;
};

type CartLine = QuickItem & { quantity: number };

const items: QuickItem[] = [
  { id: "waakye-medium", name: "Medium Waakye", unit: "plate", priceMinor: 3000 },
  { id: "egg", name: "Egg", unit: "piece", priceMinor: 500 },
  { id: "malt", name: "Malt", unit: "bottle", priceMinor: 1800 },
  { id: "haircut-standard", name: "Standard Haircut", unit: "service", priceMinor: 4000 },
  { id: "suv-full-wash", name: "SUV Full Wash", unit: "service", priceMinor: 8000 },
  { id: "cable-2-5", name: "2.5mm Cable", unit: "yard", priceMinor: 1150 },
];

const queueKey = "tradeos.pendingMutations.v1";

function formatMoney(minor: number): string {
  return `₵${(minor / 100).toFixed(2)}`;
}

export function QuickSale() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [message, setMessage] = useState<string | null>(null);

  const totalMinor = useMemo(
    () => cart.reduce((sum, line) => sum + line.priceMinor * line.quantity, 0),
    [cart],
  );
  const itemCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  const addItem = (item: QuickItem) => {
    setMessage(null);
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (!existing) return [...current, { ...item, quantity: 1 }];
      return current.map((line) =>
        line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
  };

  const recordSale = () => {
    if (cart.length === 0) return;

    const mutation = {
      clientId: "tradeos-web-demo",
      clientMutationId: crypto.randomUUID(),
      businessId: "demo-business",
      branchId: "demo-main",
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currency: "GHS",
        paymentMethod,
        totalMinor,
        lines: cart.map(({ id, name, unit, priceMinor, quantity }) => ({
          itemId: id,
          itemName: name,
          saleUnit: unit,
          unitPriceMinor: priceMinor,
          quantity,
        })),
      },
    };

    try {
      const existing = JSON.parse(localStorage.getItem(queueKey) ?? "[]") as unknown[];
      existing.push(mutation);
      localStorage.setItem(queueKey, JSON.stringify(existing));
      setCart([]);
      setMessage(
        navigator.onLine
          ? "Sale queued safely for server sync."
          : "Sale saved offline. It will sync when connectivity returns.",
      );
    } catch {
      setMessage("This device could not save the sale locally. Please retry before serving the next customer.");
    }
  };

  return (
    <article className="panel quick-sale" id="sell">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fast counter mode</p>
          <h2>Quick sale</h2>
        </div>
        <button className="text-button" type="button">View full POS</button>
      </div>

      <div className="quick-items">
        {items.map((item) => {
          const quantity = cart.find((line) => line.id === item.id)?.quantity ?? 0;
          return (
            <button className="quick-item" key={item.id} type="button" onClick={() => addItem(item)}>
              <span>{item.name}</span>
              <small>{item.unit}{quantity > 0 ? ` · ${quantity} selected` : ""}</small>
              <strong>{formatMoney(item.priceMinor)}</strong>
            </button>
          );
        })}
      </div>

      <div className="checkout-strip">
        <div>
          <span>Current sale</span>
          <strong>{itemCount} item{itemCount === 1 ? "" : "s"} · {formatMoney(totalMinor)}</strong>
          {message ? <small className="sale-message">{message}</small> : null}
        </div>
        <div className="payment-actions">
          <button
            className={paymentMethod === "CASH" ? "selected" : undefined}
            type="button"
            onClick={() => setPaymentMethod("CASH")}
          >
            Cash
          </button>
          <button
            className={paymentMethod === "MOMO" ? "selected" : undefined}
            type="button"
            onClick={() => setPaymentMethod("MOMO")}
          >
            MoMo
          </button>
          <button
            className={paymentMethod === "CUSTOMER_CREDIT" ? "selected" : undefined}
            type="button"
            onClick={() => setPaymentMethod("CUSTOMER_CREDIT")}
          >
            Pay later
          </button>
          <button className="checkout-button" type="button" disabled={cart.length === 0} onClick={recordSale}>
            Record {formatMoney(totalMinor)}
          </button>
        </div>
      </div>
    </article>
  );
}
