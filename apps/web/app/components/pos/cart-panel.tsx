"use client";

import { useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import type { SellableItem } from "../../../lib/catalog-read-model";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { IconMinus, IconPlus, IconTrash, IconSell } from "../ui/icons";

/**
 * A cart line is one (item, sale unit) pair — a crate line and a bottle line
 * of the same item are distinct lines. `sellable.key` is `${itemId}:${unitCode}`.
 */
export interface CartLine {
  sellable: SellableItem;
  quantity: number;
}

interface CartPanelProps {
  lines: readonly CartLine[];
  currencyCode: string;
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  onRemove: (key: string) => void;
  onCheckout: () => void;
  onClear: () => void;
  busy?: boolean;
  online?: boolean;
}

export function CartPanel({
  lines,
  currencyCode,
  onInc,
  onDec,
  onRemove,
  onCheckout,
  onClear,
  busy,
  online = true,
}: CartPanelProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Display-only total — the server prices every sale from its own catalog.
  const totalMinor = lines.reduce((sum, l) => sum + l.sellable.priceMinor * l.quantity, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  const handleClearClick = () => {
    if (lines.length === 0) return;
    setConfirmingClear(true);
  };

  const confirmClear = () => {
    setConfirmingClear(false);
    onClear();
  };

  return (
    <aside className="tos-pos__cart" aria-label="Cart">
      <div className="tos-pos__cart-head">
        <h2 className="tos-pos__cart-title">
          Cart <span className="tos-pos-chips-meta">· {itemCount} item{itemCount === 1 ? "" : "s"}</span>
        </h2>
        {lines.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<IconTrash className="tos-btn__icon" />}
            onClick={handleClearClick}
            disabled={busy || confirmingClear}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <div className="tos-pos__cart-body">
        {confirmingClear ? (
          <div className="tos-cart-clear-confirm" role="alertdialog" aria-label="Clear cart">
            <span className="tos-cart-clear-confirm__text">
              Remove all {itemCount} item{itemCount === 1 ? "" : "s"} from the cart?
            </span>
            <div className="tos-cart-clear-confirm__actions">
              <Button size="sm" variant="ghost" onClick={() => setConfirmingClear(false)}>
                Keep
              </Button>
              <Button size="sm" variant="danger" icon={<IconTrash className="tos-btn__icon" />} onClick={confirmClear}>
                Clear
              </Button>
            </div>
          </div>
        ) : null}

        {lines.length === 0 ? (
          <div className="tos-cart-empty">
            <div className="tos-cart-empty__icon-wrap" aria-hidden="true">
              <IconSell className="tos-cart-empty__icon" />
            </div>
            <h3 className="tos-cart-empty__title">Your cart is empty</h3>
            <p className="tos-cart-empty__text">
              Tap a product to add it. Your sale builds here — pricing is calculated by the server.
            </p>
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.sellable.key} className="tos-cart-line tos-animate-slide-in-right">
              <div className="tos-cart-line__top">
                <div className="tos-cart-line__main">
                  <span className="tos-cart-line__name" title={line.sellable.name}>{line.sellable.name}</span>
                  <span className="tos-cart-line__sub">{line.sellable.unitLabel}</span>
                  <span className="tos-cart-line__unit">
                    {formatMoney(line.sellable.priceMinor, currencyCode)} each
                  </span>
                </div>
                <button
                  type="button"
                  className="tos-cart-line__remove"
                  onClick={() => onRemove(line.sellable.key)}
                  aria-label={`Remove ${line.sellable.name} (${line.sellable.unitLabel}) from cart`}
                  disabled={busy}
                >
                  <IconTrash style={{ width: 16, height: 16 }} />
                </button>
              </div>
              <div className="tos-cart-line__bottom">
                <div className="tos-cart-line__qty" role="group" aria-label={`Quantity for ${line.sellable.name} (${line.sellable.unitLabel})`}>
                  <button
                    type="button"
                    className="tos-cart-line__qty-btn"
                    onClick={() => onDec(line.sellable.key)}
                    aria-label={`Decrease ${line.sellable.name} (${line.sellable.unitLabel}) quantity`}
                    disabled={busy}
                  >
                    <IconMinus style={{ width: 18, height: 18 }} />
                  </button>
                  <span className="tos-cart-line__qty-val" aria-live="polite">{line.quantity}</span>
                  <button
                    type="button"
                    className="tos-cart-line__qty-btn"
                    onClick={() => onInc(line.sellable.key)}
                    aria-label={`Increase ${line.sellable.name} (${line.sellable.unitLabel}) quantity`}
                    disabled={busy}
                  >
                    <IconPlus style={{ width: 18, height: 18 }} />
                  </button>
                </div>
                <div className="tos-cart-line__total">
                  <MoneyValue minor={line.sellable.priceMinor * line.quantity} currencyCode={currencyCode} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="tos-pos__cart-foot">
        {online ? null : (
          <span className="tos-offline-pill" aria-label="Offline — sales will queue">
            <span className="tos-offline-pill__dot" aria-hidden="true" />
            Offline — sale will queue
          </span>
        )}
        <div className="tos-cart-total">
          <span className="tos-cart-total__label">Total</span>
          <span className="tos-cart-total__val">
            {formatMoney(totalMinor, currencyCode)}
          </span>
        </div>
        <Button
          variant="gold"
          size="lg"
          block
          icon={<IconSell className="tos-btn__icon" />}
          onClick={onCheckout}
          disabled={lines.length === 0 || busy}
        >
          {lines.length === 0 ? "Charge" : `Charge ${formatMoney(totalMinor, currencyCode)}`}
        </Button>
      </div>
    </aside>
  );
}
