"use client";

import React, { useMemo, useState } from "react";
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
    <section className="pos-workspace" aria-label="Sell point of sale">
      {status ? (
        <div className={`pos-sale-status pos-sale-status--${status.tone}`} role="status">
          <span>{status.tone === "success" ? "✓" : status.tone === "pending" ? "↻" : "!"}</span>
          <strong>{status.message}</strong>
          <button type="button" aria-label="Dismiss sale status" onClick={() => setStatus(null)}>×</button>
        </div>
      ) : null}

      <button className="pos-customer-bar" type="button" onClick={() => setCustomerPickerOpen(true)}>
        <span className="pos-customer-bar-avatar" aria-hidden="true">{selectedCustomer ? initials(selectedCustomer.name) : "W"}</span>
        <span className="pos-customer-bar-copy">
          <small>Customer</small>
          <strong>{selectedCustomer?.name ?? "Walk-in customer"}</strong>
          <em>{selectedCustomer ? selectedCustomer.phone ?? selectedCustomer.email ?? "Named customer" : "No account attached"}</em>
        </span>
        <span className="pos-customer-bar-action">Choose customer</span>
      </button>

      <div className="pos-workspace-grid">
        <div className="pos-browser-pane">
          <ProductBrowser
            items={items}
            query={query}
            currencyCode={currencyCode}
            onQueryChange={setQuery}
            onAdd={addItem}
          />
        </div>

        <aside className="pos-sale-pane" aria-label="Current sale cart">
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
          <button
            className="pos-desktop-charge"
            type="button"
            disabled={cart.length === 0}
            onClick={() => setCheckoutOpen(true)}
          >
            <span>Charge</span>
            <strong>{formatMoney(totalMinor, currencyCode)}</strong>
          </button>
        </aside>
      </div>

      <div className="pos-charge-bar">
        <div>
          <span>{cart.length} line{cart.length === 1 ? "" : "s"}</span>
          <strong>{formatMoney(totalMinor, currencyCode)}</strong>
        </div>
        <button type="button" disabled={cart.length === 0} onClick={() => setCheckoutOpen(true)}>
          Charge {formatMoney(totalMinor, currencyCode)}
        </button>
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

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "C";
}
