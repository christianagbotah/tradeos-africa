"use client";

import React, { useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { CartPanel } from "./cart-panel";
import { CheckoutSheet, displayTotalMinor } from "./checkout-sheet";
import { CustomerPicker, type PosCustomer } from "./customer-picker";
import {
  addCartItem,
  changeCartUnit,
  removeCartLine,
  setCartQuantity,
  toPosSelection,
  type CartLine,
  type PosLineKey,
  type PosSellableItem,
} from "./pos-model";
import { ProductBrowser } from "./product-browser";

export type PosSaleStatus = {
  message: string;
  tone: "success" | "pending" | "error";
};

export function PosWorkspace({
  businessId,
  branchId,
  currencyCode,
  role,
  items,
}: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  items: PosSellableItem[];
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [status, setStatus] = useState<PosSaleStatus | null>(null);
  const totalMinor = useMemo(() => displayTotalMinor(cart), [cart]);

  const addItem = (item: PosSellableItem) => {
    setStatus(null);
    setCart((current) => addCartItem(current, toPosSelection(item)));
  };

  const increase = (key: PosLineKey) => {
    setCart((current) => {
      const line = current.find((candidate) => candidate.key === key);
      return line ? setCartQuantity(current, key, line.quantity + 1) : current;
    });
  };

  const decrease = (key: PosLineKey) => {
    setCart((current) => {
      const line = current.find((candidate) => candidate.key === key);
      if (!line) return current;
      const next = line.quantity - 1;
      return next > 0 ? setCartQuantity(current, key, next) : current;
    });
  };

  const changeUnit = (key: PosLineKey, unit: PosSellableItem) => {
    setCart((current) => changeCartUnit(current, key, toPosSelection(unit)));
  };

  const onStatus = (message: string, tone: "success" | "pending" | "error" = "pending") => {
    setStatus({ message, tone });
  };

  return (
    <section className="pos-workspace zai-pos-workspace" aria-label="Sell point of sale">
      {status ? (
        <div className={`pos-sale-status pos-sale-status--${status.tone}`} role="status">
          <span>{status.tone === "success" ? "✓" : status.tone === "pending" ? "↻" : "!"}</span>
          <strong>{status.message}</strong>
          <button type="button" aria-label="Dismiss sale status" onClick={() => setStatus(null)}>×</button>
        </div>
      ) : null}

      <div className="pos-workspace-grid">
        <div className="pos-browser-pane">
          <ProductBrowser items={items} query={query} currencyCode={currencyCode} onQueryChange={setQuery} onAdd={addItem} />
        </div>

        <aside className="pos-sale-pane" aria-label="Current sale cart">
          <button className="pos-cart-customer" type="button" aria-label="Choose customer" onClick={() => setCustomerPickerOpen(true)}>
            <span className="pos-cart-customer-icon" aria-hidden="true">♙</span>
            <strong>{selectedCustomer?.name ?? "Walk-in Customer"}</strong>
            <span aria-hidden="true">⌄</span>
          </button>

          <div className="pos-cart-scroll">
            <CartPanel
              cart={cart}
              items={items}
              currencyCode={currencyCode}
              onIncrease={increase}
              onDecrease={decrease}
              onSetQuantity={(key, quantity) => setCart((current) => setCartQuantity(current, key, quantity))}
              onRemove={(key) => setCart((current) => removeCartLine(current, key))}
              onChangeUnit={changeUnit}
            />
          </div>

          <div className="pos-sale-summary">
            <div><span>Subtotal</span><strong>{formatMoney(totalMinor, currencyCode)}</strong></div>
            <div className="pos-sale-total"><span>Total</span><strong>{formatMoney(totalMinor, currencyCode)}</strong></div>
            <div className="pos-payment-preview" aria-label="Available payment methods">
              {[
                ["Cash", "▣"],
                ["MoMo", "▯"],
                ["Bank", "▤"],
                ["Card", "▭"],
                ["Credit", "◷"],
              ].map(([label, icon], index) => <span className={index === 0 ? "active" : ""} key={label}><i aria-hidden="true">{icon}</i>{label}</span>)}
            </div>
            <button className="pos-desktop-charge" type="button" disabled={cart.length === 0} onClick={() => setCheckoutOpen(true)}>
              <span>✓ Charge</span><strong>{formatMoney(totalMinor, currencyCode)}</strong>
            </button>
          </div>
        </aside>
      </div>

      <div className="pos-charge-bar">
        <div><span>{cart.length} line{cart.length === 1 ? "" : "s"}</span><strong>{formatMoney(totalMinor, currencyCode)}</strong></div>
        <button type="button" disabled={cart.length === 0} onClick={() => setCheckoutOpen(true)}>Charge {formatMoney(totalMinor, currencyCode)}</button>
      </div>

      <CustomerPicker
        businessId={businessId}
        currencyCode={currencyCode}
        selectedCustomer={selectedCustomer}
        role={role}
        open={customerPickerOpen}
        onSelect={setSelectedCustomer}
        onWalkIn={() => setSelectedCustomer(null)}
        onClose={() => setCustomerPickerOpen(false)}
      />

      <CheckoutSheet
        open={checkoutOpen}
        businessId={businessId}
        branchId={branchId}
        currencyCode={currencyCode}
        cart={cart}
        customer={selectedCustomer}
        onClose={() => setCheckoutOpen(false)}
        onDurablySaved={() => {
          setCart([]);
          setQuery("");
          setSelectedCustomer(null);
        }}
        onStatus={onStatus}
      />
    </section>
  );
}
