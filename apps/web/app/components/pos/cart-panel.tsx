"use client";

import React from "react";
import type { CartLine, PosLineKey, PosSellableItem } from "./pos-model";

export function CartPanel({
  cart,
  items,
  currencyCode,
  onIncrease,
  onDecrease,
  onSetQuantity,
  onRemove,
  onChangeUnit,
}: {
  cart: CartLine[];
  items: PosSellableItem[];
  currencyCode: string;
  onIncrease: (key: PosLineKey) => void;
  onDecrease: (key: PosLineKey) => void;
  onSetQuantity: (key: PosLineKey, quantity: number) => void;
  onRemove: (key: PosLineKey) => void;
  onChangeUnit: (key: PosLineKey, unit: PosSellableItem) => void;
}) {
  if (cart.length === 0) {
    return (
      <section className="pos-cart-panel pos-cart-empty" aria-label="Current sale">
        <strong>Your sale is empty</strong>
        <span>Tap a product or service to add it.</span>
      </section>
    );
  }

  const totalMinor = cart.reduce((sum, line) => sum + Math.round(line.priceMinor * line.quantity), 0);

  return (
    <section className="pos-cart-panel" aria-label="Current sale">
      <div className="pos-cart-heading">
        <div><span>Current sale</span><strong>{cart.length} line{cart.length === 1 ? "" : "s"}</strong></div>
        <strong>{formatMoney(totalMinor, currencyCode)}</strong>
      </div>

      <div className="pos-cart-lines">
        {cart.map((line) => {
          const unitOptions = items.filter((item) => item.itemId === line.itemId);
          const selectedMeta = unitOptions.find((item) => item.unitCode === line.saleUnitCode) ?? null;
          return (
            <article className="pos-cart-line" key={line.key}>
              <div className="pos-cart-line-title">
                <div>
                  <strong>{line.name}</strong>
                  <span>{formatMoney(line.priceMinor, currencyCode)} / {line.saleUnitLabel}</span>
                </div>
                <strong>{formatMoney(Math.round(line.priceMinor * line.quantity), currencyCode)}</strong>
              </div>

              <div className="pos-cart-controls">
                <div className="pos-qty-control">
                  <button className="pos-qty-button" type="button" aria-label={`Decrease ${line.name} quantity`} onClick={() => onDecrease(line.key)}>−</button>
                  <input
                    aria-label={`${line.name} quantity`}
                    inputMode="decimal"
                    type="number"
                    min="0.000001"
                    step="any"
                    value={line.quantity}
                    onChange={(event) => {
                      const quantity = Number(event.target.value);
                      if (Number.isFinite(quantity) && quantity > 0) onSetQuantity(line.key, quantity);
                    }}
                  />
                  <button className="pos-qty-button" type="button" aria-label={`Increase ${line.name} quantity`} onClick={() => onIncrease(line.key)}>+</button>
                </div>

                <select
                  className="pos-unit-select"
                  aria-label={`Change ${line.name} selling unit`}
                  value={line.saleUnitCode}
                  onChange={(event) => {
                    const next = unitOptions.find((item) => item.unitCode === event.target.value);
                    if (next) onChangeUnit(line.key, next);
                  }}
                >
                  {unitOptions.map((unit) => <option key={unit.key} value={unit.unitCode}>{unit.unitLabel}</option>)}
                </select>

                <button className="pos-remove-line" type="button" aria-label={`Remove ${line.name} from sale`} onClick={() => onRemove(line.key)}>Remove</button>
              </div>

              <div className="pos-cart-stock-context">
                {selectedMeta?.trackStock ? `Stock tracked in ${selectedMeta.stockUnitCode ?? "configured unit"}` : selectedMeta?.kind === "SERVICE" ? "Service · no stock quantity" : "Stock not tracked"}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}
