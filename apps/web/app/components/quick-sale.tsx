"use client";

import { useEffect, useMemo, useState } from "react";
import { clientApi } from "../lib/client-api";
import { customersChangedEvent } from "../lib/customer-events";
import {
  enqueueMutation,
  flushPendingMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  type AppliedMutationDetail,
} from "../lib/offline-sync";

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

type CreditCustomer = {
  id: string;
  name: string;
  phone: string | null;
  creditEnabled: boolean;
  creditLimitMinor: number | null;
  balanceMinor: number;
  availableCreditMinor: number | null;
  active: boolean;
};

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
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");

  const totalMinor = useMemo(
    () => cart.reduce((sum, line) => sum + line.priceMinor * line.quantity, 0),
    [cart],
  );
  const itemCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  const loadCreditCustomers = async () => {
    try {
      const response = await clientApi<{ customers: CreditCustomer[] }>(
        `/api/tradeos/v1/customers?businessId=${encodeURIComponent(businessId)}&limit=200`,
      );
      setCreditCustomers(response.customers.filter((customer) => customer.active && customer.creditEnabled));
    } catch {
      // Cash/MoMo selling must remain available even if customer lookup is temporarily unavailable.
    }
  };

  useEffect(() => {
    setCustomerId("");
    void loadCreditCustomers();
    const refresh = () => void loadCreditCustomers();
    const mutationApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (detail?.businessId === businessId && ["SALE_CREATE", "RETURN_CREATE", "REFUND_CREATE", "CUSTOMER_PAYMENT_CREATE"].includes(detail.mutationType)) refresh();
    };
    window.addEventListener(customersChangedEvent, refresh);
    window.addEventListener(mutationAppliedEvent, mutationApplied);
    return () => {
      window.removeEventListener(customersChangedEvent, refresh);
      window.removeEventListener(mutationAppliedEvent, mutationApplied);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const selectedCustomer = creditCustomers.find((customer) => customer.id === customerId) ?? null;
  const creditAvailable = selectedCustomer?.availableCreditMinor ?? 0;
  const creditReady = paymentMethod !== "CUSTOMER_CREDIT" || Boolean(selectedCustomer && creditAvailable >= totalMinor);

  const addItem = (item: QuickSaleItem) => {
    setMessage(null);
    setCart((current) => {
      const existing = current.find((line) => line.key === item.key);
      if (!existing) return [...current, { ...item, quantity: 1 }];
      return current.map((line) => line.key === item.key ? { ...line, quantity: line.quantity + 1 } : line);
    });
  };

  const recordSale = async () => {
    if (cart.length === 0 || saving || !creditReady) return;
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
          ...(paymentMethod === "CUSTOMER_CREDIT" && customerId ? { customerId } : {}),
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
          {paymentMethod === "CUSTOMER_CREDIT" ? (
            <div className="credit-customer-picker">
              <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} aria-label="Credit customer">
                <option value="">Select credit customer…</option>
                {creditCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · available {formatMoney(customer.availableCreditMinor ?? 0, currencyCode)}
                  </option>
                ))}
              </select>
              {creditCustomers.length === 0 ? <small>Add a customer with a credit limit below before using Pay later.</small> : null}
              {selectedCustomer && creditAvailable < totalMinor ? <small className="credit-warning">Only {formatMoney(creditAvailable, currencyCode)} credit is currently available.</small> : null}
              {selectedCustomer && creditAvailable >= totalMinor ? <small>{selectedCustomer.name} will owe {formatMoney(selectedCustomer.balanceMinor + totalMinor, currencyCode)} after this sale.</small> : null}
            </div>
          ) : null}
          <button className="checkout-button" type="button" disabled={cart.length === 0 || saving || !creditReady} onClick={() => void recordSale()}>
            {saving ? "Saving…" : `Record ${formatMoney(totalMinor, currencyCode)}`}
          </button>
        </div>
      </div>
    </article>
  );
}
