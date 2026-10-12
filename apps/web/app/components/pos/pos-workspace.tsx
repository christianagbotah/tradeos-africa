"use client";

import { useCallback, useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { ProductBrowser } from "./product-browser";
import { CartPanel, type CartLine } from "./cart-panel";
import { CheckoutSheet } from "./checkout-sheet";
import { Button } from "../ui/button";
import { IconSell } from "../ui/icons";
import type { CatalogItem } from "../workspace/workspace-provider";

export function PosWorkspace() {
  const { catalog, customers, session, queue, bump } = useWorkspace();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const currencyCode = session?.currencyCode ?? "GHS";
  const online = queue.online;

  const handlePick = useCallback((item: CatalogItem) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) {
        return prev.map((l) => (l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { item, quantity: 1 }];
    });
  }, []);

  const handleInc = useCallback((itemId: string) => {
    setLines((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, quantity: l.quantity + 1 } : l)));
  }, []);

  const handleDec = useCallback((itemId: string) => {
    setLines((prev) =>
      prev
        .map((l) => (l.item.id === itemId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const handleRemove = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.item.id !== itemId));
  }, []);

  const handleClear = useCallback(() => {
    setLines([]);
  }, []);

  const openCheckout = useCallback(() => {
    setCartOpen(false);
    setCheckoutOpen(true);
  }, []);

  const handleComplete = useCallback(() => {
    setLines([]);
    setCheckoutOpen(false);
    setCartOpen(false);
    bump();
  }, [bump]);

  // Surface "in cart" quantities on product tiles.
  const cartQuantities = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of lines) m[l.item.id] = l.quantity;
    return m;
  }, [lines]);

  const totalMinor = useMemo(
    () => lines.reduce((sum, l) => sum + l.item.priceMinor * l.quantity, 0),
    [lines],
  );
  const itemCount = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);

  if (!session) return null;

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Point of sale</span>
          <h1 className="tos-page__title">Sell</h1>
          <p className="tos-page__subtitle">
            Tap products to build a cart. Pricing is server-authoritative — the client sends only
            item, sale unit, and quantity.
          </p>
          <div className="tos-pos__hint-row" aria-hidden="true">
            <span>Quick search</span>
            <span className="tos-pos__hint-kbd">F2</span>
            <span>· add to cart by tapping a tile</span>
          </div>
        </div>
      </header>

      <div className="tos-pos">
        <ProductBrowser
          catalog={catalog}
          currencyCode={currencyCode}
          onPick={handlePick}
          cartQuantities={cartQuantities}
        />
        <div className="tos-pos__cart-wrap" data-open={cartOpen}>
          <div className="tos-pos__cart-sheet-handle" aria-hidden="true" />
          <CartPanel
            lines={lines}
            currencyCode={currencyCode}
            onInc={handleInc}
            onDec={handleDec}
            onRemove={handleRemove}
            onClear={handleClear}
            onCheckout={openCheckout}
            online={online}
          />
        </div>
      </div>

      {/* Mobile sticky charge bar — always visible total + charge. Hidden on desktop via CSS. */}
      <div className="tos-charge-bar" aria-label="Cart summary">
        <button
          type="button"
          className="tos-charge-bar__cart-btn"
          onClick={() => setCartOpen(true)}
          aria-label={`View cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
        >
          <IconSell style={{ width: 20, height: 20 }} />
          Cart
          <span className="tos-charge-bar__count">{itemCount}</span>
        </button>
        <div className="tos-charge-bar__info">
          <span className="tos-charge-bar__total">{formatMoney(totalMinor, currencyCode)}</span>
          <span className="tos-charge-bar__sub">
            {itemCount === 0 ? "Cart empty" : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <Button
          variant="gold"
          className="tos-charge-bar__charge"
          onClick={openCheckout}
          disabled={lines.length === 0}
          icon={<IconSell className="tos-btn__icon" />}
        >
          Charge
        </Button>
      </div>

      {/* Mobile cart sheet scrim. */}
      <div
        className="tos-pos__cart-scrim"
        data-open={cartOpen}
        onClick={() => setCartOpen(false)}
        aria-hidden="true"
      />

      <CheckoutSheet
        open={checkoutOpen}
        lines={lines}
        currencyCode={currencyCode}
        businessId={session.businessId}
        branchId={session.branchId}
        customers={customers}
        online={online}
        onClose={() => setCheckoutOpen(false)}
        onComplete={handleComplete}
      />
    </div>
  );
}
