/**
 * PosCart — cart panel for the POS workspace.
 *
 * Shows the active customer, editable line items (qty +/-, remove), running
 * totals (subtotal, tax estimate, total — all display-only previews; the
 * server is authoritative), and the Charge button (F9). Keyboard shortcut
 * hints are visible in the footer. Empty state when no lines.
 */
import type { DesktopCartLine } from "../lib/types.js";
import { fmtMoneyMinor } from "../lib/format.js";
import { IconSell, IconTrash, IconUser, IconMinus, IconPlus, IconKeyboard } from "./icons.js";

export interface PosCartProps {
  lines: DesktopCartLine[];
  customerName: string;
  onPickCustomer: () => void;
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onCharge: () => void;
  taxRate: number;
  pendingSale: boolean;
}

export function PosCart({
  lines,
  customerName,
  onPickCustomer,
  onInc,
  onDec,
  onRemove,
  onClear,
  onCharge,
  taxRate,
  pendingSale,
}: PosCartProps) {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.displayPriceMinor * l.quantity, 0);
  const taxMinor = Math.round(subtotalMinor * taxRate);
  const totalMinor = subtotalMinor + taxMinor;
  const count = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <section className="dsk-cart" aria-label="Sale cart">
      <div className="dsk-cart__head">
        <span className="dsk-cart__title">
          <IconSell width={16} height={16} />
          Current sale
        </span>
        <span className="dsk-cart__count tnum">{count} items</span>
        {lines.length > 0 ? (
          <button type="button" className="dsk-cart__clear" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="dsk-cart__customer">
        <IconUser width={14} height={14} style={{ color: "var(--tos-text-muted)" }} />
        <span className="dsk-cart__customer-label">Customer</span>
        <span className="dsk-cart__customer-name">{customerName}</span>
        <button type="button" className="dsk-cart__customer-change" onClick={onPickCustomer}>
          Change
        </button>
      </div>
      {lines.length === 0 ? (
        <div className="dsk-cart__empty">
          <div className="dsk-cart__empty-icon" aria-hidden>
            <IconSell width={40} height={40} />
          </div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--tos-text)" }}>Cart is empty</div>
          <div style={{ fontSize: "12px" }}>Click a product or scan a barcode to start a sale.</div>
        </div>
      ) : (
        <div className="dsk-cart__lines">
          {lines.map((line) => (
            <div className="dsk-cartline" key={line.key}>
              <div>
                <div className="dsk-cartline__name">{line.displayName}</div>
                <div className="dsk-cartline__unit">
                  {line.displaySku ?? line.itemId} · {fmtMoneyMinor(line.displayPriceMinor)} / {line.displayUnitLabel}
                </div>
                <div className="dsk-cartline__qty">
                  <button
                    type="button"
                    className="dsk-cartline__qty-btn"
                    onClick={() => onDec(line.key)}
                    disabled={line.quantity <= 1}
                    aria-label={`Decrease ${line.displayName} quantity`}
                  >
                    <IconMinus width={12} height={12} />
                  </button>
                  <span className="dsk-cartline__qty-val tnum">{line.quantity}</span>
                  <button
                    type="button"
                    className="dsk-cartline__qty-btn"
                    onClick={() => onInc(line.key)}
                    aria-label={`Increase ${line.displayName} quantity`}
                  >
                    <IconPlus width={12} height={12} />
                  </button>
                </div>
              </div>
              <div className="dsk-cartline__right">
                <span className="dsk-cartline__total tnum">{fmtMoneyMinor(line.displayPriceMinor * line.quantity)}</span>
                <button
                  type="button"
                  className="dsk-cartline__remove"
                  onClick={() => onRemove(line.key)}
                  aria-label={`Remove ${line.displayName} from cart`}
                >
                  <IconTrash width={12} height={12} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="dsk-cart__totals">
        <div className="dsk-cart__total-row">
          <span>Subtotal (preview)</span>
          <span className="dsk-cart__total-val tnum">{fmtMoneyMinor(subtotalMinor)}</span>
        </div>
        <div className="dsk-cart__total-row">
          <span>Tax estimate ({Math.round(taxRate * 100)}%)</span>
          <span className="dsk-cart__total-val tnum">{fmtMoneyMinor(taxMinor)}</span>
        </div>
        <div className="dsk-cart__total-row dsk-cart__total-row--grand">
          <span>Total (server-authoritative)</span>
          <span className="dsk-cart__total-val tnum">{fmtMoneyMinor(totalMinor)}</span>
        </div>
        {pendingSale ? (
          <div className="dsk-cart__total-row" style={{ color: "var(--tos-warning)" }}>
            <span>Sale pending sync</span>
            <span className="tnum">Offline</span>
          </div>
        ) : null}
      </div>
      <div className="dsk-cart__checkout">
        <button
          type="button"
          className="dsk-btn dsk-btn--gold dsk-btn--lg dsk-btn--block"
          onClick={onCharge}
          disabled={lines.length === 0}
        >
          Charge {fmtMoneyMinor(totalMinor)}
        </button>
        <div className="dsk-cart__shortcuts" aria-hidden>
          <span className="dsk-cart__shortcut">
            <kbd>F2</kbd> search
          </span>
          <span className="dsk-cart__shortcut">
            <kbd>F4</kbd> customer
          </span>
          <span className="dsk-cart__shortcut">
            <kbd>F9</kbd> charge
          </span>
          <span className="dsk-cart__shortcut">
            <kbd>Esc</kbd> close
          </span>
          <IconKeyboard width={12} height={12} style={{ marginLeft: "auto", opacity: 0.5 }} />
        </div>
      </div>
    </section>
  );
}
