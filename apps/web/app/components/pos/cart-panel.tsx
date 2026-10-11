"use client";

import type { CatalogItem } from "../workspace/workspace-provider";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { IconMinus, IconPlus, IconTrash } from "../ui/icons";

export interface CartLine {
  item: CatalogItem;
  quantity: number;
}

interface CartPanelProps {
  lines: readonly CartLine[];
  currencyCode: string;
  onInc: (itemId: string) => void;
  onDec: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onCheckout: () => void;
  onClear: () => void;
  busy?: boolean;
}

export function CartPanel({ lines, currencyCode, onInc, onDec, onRemove, onCheckout, onClear, busy }: CartPanelProps) {
  const totalMinor = lines.reduce((sum, l) => sum + l.item.priceMinor * l.quantity, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <aside className="tos-pos__cart" aria-label="Cart">
      <div className="tos-pos__cart-head">
        <h2 className="tos-pos__cart-title">Cart ({itemCount})</h2>
        {lines.length > 0 ? (
          <Button size="sm" variant="ghost" icon={<IconTrash className="tos-btn__icon" />} onClick={onClear} disabled={busy}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="tos-pos__cart-body">
        {lines.length === 0 ? (
          <div className="tos-state tos-state--bare">
            <p className="tos-state__text">Tap a product to add it to the cart.</p>
          </div>
        ) : (
          lines.map((line) => (
            <div key={line.item.id} className="tos-cart-line">
              <div className="tos-cart-line__name" title={line.item.name}>{line.item.name}</div>
              <div className="tos-cart-line__sub">{line.item.saleUnitName}</div>
              <div className="tos-cart-line__qty">
                <button type="button" className="tos-cart-line__qty-btn" onClick={() => onDec(line.item.id)} aria-label={`Decrease ${line.item.name} quantity`} disabled={busy}>
                  <IconMinus style={{ width: 14, height: 14 }} />
                </button>
                <span className="tos-cart-line__qty-val">{line.quantity}</span>
                <button type="button" className="tos-cart-line__qty-btn" onClick={() => onInc(line.item.id)} aria-label={`Increase ${line.item.name} quantity`} disabled={busy}>
                  <IconPlus style={{ width: 14, height: 14 }} />
                </button>
              </div>
              <div className="tos-cart-line__total">
                <MoneyValue minor={line.item.priceMinor * line.quantity} currencyCode={currencyCode} />
              </div>
              <button
                type="button"
                className="tos-cart-line__remove"
                onClick={() => onRemove(line.item.id)}
                aria-label={`Remove ${line.item.name} from cart`}
                disabled={busy}
              >
                <IconTrash style={{ width: 14, height: 14 }} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="tos-pos__cart-foot">
        <div className="tos-checkout-summary">
          <span className="tos-checkout-summary__key">Subtotal</span>
          <span className="tos-checkout-summary__val">
            <MoneyValue minor={totalMinor} currencyCode={currencyCode} tone="muted" />
          </span>
          <span className="tos-checkout-summary__total-key">Total</span>
          <span className="tos-checkout-summary__total-val">
            <MoneyValue minor={totalMinor} currencyCode={currencyCode} />
          </span>
        </div>
        <Button
          variant="gold"
          size="lg"
          block
          onClick={onCheckout}
          disabled={lines.length === 0 || busy}
        >
          Charge
        </Button>
      </div>
    </aside>
  );
}
