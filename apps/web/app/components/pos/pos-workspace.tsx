"use client";

import { useCallback, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { ProductBrowser } from "./product-browser";
import { CartPanel, type CartLine } from "./cart-panel";
import { CheckoutSheet } from "./checkout-sheet";
import type { CatalogItem } from "../workspace/workspace-provider";

export function PosWorkspace() {
  const { catalog, customers, session, queue, bump } = useWorkspace();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const currencyCode = session?.currencyCode ?? "GHS";

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

  const handleComplete = useCallback(() => {
    setLines([]);
    setCheckoutOpen(false);
    bump();
  }, [bump]);

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
        </div>
      </header>

      <div className="tos-pos">
        <ProductBrowser
          catalog={catalog}
          currencyCode={currencyCode}
          onPick={handlePick}
        />
        <CartPanel
          lines={lines}
          currencyCode={currencyCode}
          onInc={handleInc}
          onDec={handleDec}
          onRemove={handleRemove}
          onClear={handleClear}
          onCheckout={() => setCheckoutOpen(true)}
        />
      </div>

      <CheckoutSheet
        open={checkoutOpen}
        lines={lines}
        currencyCode={currencyCode}
        businessId={session.businessId}
        branchId={session.branchId}
        customers={customers}
        online={queue.online}
        onClose={() => setCheckoutOpen(false)}
        onComplete={handleComplete}
      />
    </div>
  );
}
