"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [status, setStatus] = useState<PosSaleStatus | null>(null);
  const mobileCartSheetRef = useRef<HTMLElement>(null);
  const mobileCartTriggerRef = useRef<HTMLButtonElement>(null);
  const checkoutReturnFocusRef = useRef<HTMLElement | null>(null);
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

  const focusProductSearch = () => {
    document.querySelector<HTMLInputElement>(".pos-product-search input")?.focus();
  };

  const focusCartSheetStart = () => {
    queueMicrotask(() => {
      const sheet = mobileCartSheetRef.current;
      if (!sheet) return;
      const tabbables = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.offsetParent !== null);
      tabbables[0]?.focus();
    });
  };

  const closeMobileCart = () => {
    setMobileCartOpen(false);
    queueMicrotask(() => {
      const trigger = mobileCartTriggerRef.current;
      if (trigger && !trigger.disabled && trigger.isConnected) trigger.focus();
      else focusProductSearch();
    });
  };

  const openCheckout = (returnFocusTarget: HTMLElement | null) => {
    checkoutReturnFocusRef.current = returnFocusTarget;
    setMobileCartOpen(false);
    setCheckoutOpen(true);
  };

  useEffect(() => {
    if (!mobileCartOpen) return;
    const phoneViewport = window.matchMedia("(max-width: 767px)");
    if (!phoneViewport.matches) {
      setMobileCartOpen(false);
      return;
    }
    const onViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileCartOpen(false);
    };
    phoneViewport.addEventListener("change", onViewportChange);
    return () => phoneViewport.removeEventListener("change", onViewportChange);
  }, [mobileCartOpen]);

  useEffect(() => {
    if (!mobileCartOpen) return;
    const sheet = mobileCartSheetRef.current;
    if (!sheet) return;
    const initialTabbables = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    initialTabbables[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileCart();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const tabbables = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!tabbables.length) {
        event.preventDefault();
        return;
      }
      const first = tabbables[0]!;
      const last = tabbables[tabbables.length - 1]!;
      if (!sheet.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileCartOpen]);

  return (
    <section className="pos-workspace" aria-label="Sell point of sale">
      {/* Sale status — accessible region for sync/pending/error */}
      {status ? (
        <div className={`pos-sale-status pos-sale-status--${status.tone}`} role="status">
          <span>{status.tone === "success" ? "✓" : status.tone === "pending" ? "↻" : "!"}</span>
          <strong>{status.message}</strong>
          <button type="button" aria-label="Dismiss sale status" onClick={() => setStatus(null)}>×</button>
        </div>
      ) : null}

      {/* Customer bar — compact, accessible, not intrusive */}
      <button className="pos-customer-bar" type="button" onClick={() => setCustomerPickerOpen(true)}>
        <span className="pos-customer-bar-avatar" aria-hidden="true">{selectedCustomer ? initials(selectedCustomer.name) : "W"}</span>
        <span className="pos-customer-bar-copy">
          <small>Customer</small>
          <strong>{selectedCustomer?.name ?? "Walk-in customer"}</strong>
          <em>{selectedCustomer ? selectedCustomer.phone ?? selectedCustomer.email ?? "Named customer" : "No account attached"}</em>
        </span>
        <span className="pos-customer-bar-action">Choose customer</span>
      </button>

      {/* Desktop: product discovery + cart side-by-side; Mobile: stacked with sticky charge */}
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

        <aside className="pos-sale-pane pos-sale-pane--desktop" aria-label="Current sale cart">
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
          {/* Desktop charge button — prominent, always visible */}
          <button
            className="pos-desktop-charge"
            type="button"
            disabled={cart.length === 0}
            onClick={(event) => openCheckout(event.currentTarget)}
          >
            <span>Charge</span>
            <strong>{formatMoney(totalMinor, currencyCode)}</strong>
          </button>
        </aside>
      </div>

      {/* Mobile sticky cart summary — edit cart first or continue directly to payment */}
      <div className="pos-charge-bar">
        <button
          ref={mobileCartTriggerRef}
          className="pos-mobile-cart-trigger"
          type="button"
          aria-label="Open cart"
          disabled={cart.length === 0}
          onClick={() => setMobileCartOpen(true)}
        >
          <span>{cart.length} line{cart.length === 1 ? "" : "s"}</span>
          <strong>{formatMoney(totalMinor, currencyCode)}</strong>
        </button>
        <button className="pos-charge-primary" type="button" disabled={cart.length === 0} onClick={(event) => openCheckout(event.currentTarget)}>
          Charge {formatMoney(totalMinor, currencyCode)}
        </button>
      </div>

      {mobileCartOpen ? (
        <div className="pos-mobile-cart-layer">
          <button className="pos-mobile-cart-backdrop" type="button" aria-label="Close cart" onClick={closeMobileCart} />
          <section
            ref={mobileCartSheetRef}
            className="pos-mobile-cart-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-mobile-cart-title"
            tabIndex={-1}
          >
            <header className="pos-mobile-cart-header">
              <div>
                <span>Current sale</span>
                <h2 id="pos-mobile-cart-title">Review cart</h2>
              </div>
              <button type="button" aria-label="Close cart" onClick={closeMobileCart}>×</button>
            </header>
            <div className="pos-mobile-cart-body">
              <CartPanel
                cart={cart}
                items={items}
                currencyCode={currencyCode}
                onIncrease={increase}
                onDecrease={decrease}
                onSetQuantity={(key, quantity) => setCart((current) => setCartQuantity(current, key, quantity))}
                onRemove={(key) => {
                  setCart((current) => removeCartLine(current, key));
                  focusCartSheetStart();
                }}
                onChangeUnit={changeUnit}
              />
            </div>
            <footer className="pos-mobile-cart-footer">
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => openCheckout(mobileCartTriggerRef.current)}
              >
                Continue to payment · {formatMoney(totalMinor, currencyCode)}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

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
        returnFocusRef={checkoutReturnFocusRef}
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

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "C";
}
