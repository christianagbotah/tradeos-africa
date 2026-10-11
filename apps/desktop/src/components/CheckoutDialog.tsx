/**
 * CheckoutDialog — checkout modal for the POS.
 *
 * Three phases: TENDER (pick method + amount tendered) -> PENDING (offline
 * sale queued, waiting for sync) -> SUCCESS (sale applied by the server) or
 * NEEDS_REVIEW (server rejected — show evidence).
 *
 * The dialog does NOT record a sale locally — it calls
 * `runtime.captureSale()` which routes through the OfflineMutationQueue and
 * the canonical SALE_CREATE mutation. The server is authoritative for
 * pricing, stock, and accounting.
 *
 * Keyboard: Esc closes; Enter charges when tendered >= total. Receipt print
 * + cash drawer go through the tauri-api adapter (graceful browser fallback).
 */
import { useEffect, useState } from "react";
import type { DesktopCartLine, DesktopPaymentMethod } from "../lib/types.js";
import { fmtMoneyMinor, minorToMajorNumber } from "../lib/format.js";
import {
  IconClose,
  IconBanknote,
  IconCreditCard,
  IconSmartphone,
  IconCheck,
  IconPrinter,
  IconAlert,
  IconRefresh,
} from "./icons.js";
import { printReceipt, openCashDrawer } from "../lib/tauri-api.js";

export interface CheckoutDialogProps {
  open: boolean;
  lines: DesktopCartLine[];
  customerName: string;
  cashier: string;
  taxRate: number;
  pendingSale: boolean;
  /** Outcome of the most recent captureSale call. */
  captureOutcome: CheckoutCaptureOutcome | null;
  onClose: () => void;
  onCapture: (method: DesktopPaymentMethod) => void;
  onRetry: () => void;
}

export type CheckoutCaptureOutcome =
  | { kind: "SYNCED"; receiptNo: string }
  | { kind: "PENDING" }
  | { kind: "NEEDS_REVIEW"; errorCode?: string; errorMessage?: string };

const METHODS: ReadonlyArray<{ id: DesktopPaymentMethod; label: string; icon: typeof IconBanknote }> = [
  { id: "CASH", label: "Cash", icon: IconBanknote },
  { id: "CARD", label: "Card", icon: IconCreditCard },
  { id: "MOMO", label: "MoMo", icon: IconSmartphone },
];

export function CheckoutDialog({
  open,
  lines,
  customerName,
  cashier,
  taxRate,
  pendingSale,
  captureOutcome,
  onClose,
  onCapture,
  onRetry,
}: CheckoutDialogProps) {
  const [method, setMethod] = useState<DesktopPaymentMethod>("CASH");
  const [tendered, setTendered] = useState<string>("");

  const subtotalMinor = lines.reduce((s, l) => s + l.displayPriceMinor * l.quantity, 0);
  const taxMinor = Math.round(subtotalMinor * taxRate);
  const totalMinor = subtotalMinor + taxMinor;
  const tenderedMinor = Math.round(tenderedMinorOf(tendered));
  const changeMinor = tenderedMinor - totalMinor;
  const canCharge = method !== "CASH" || tenderedMinor >= totalMinor;

  useEffect(() => {
    if (open) {
      setMethod("CASH");
      setTendered("");
    }
  }, [open]);

  // Esc closes (the global shortcut hook also handles Esc). Enter charges
  // during the tender phase.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && captureOutcome === null && canCharge && totalMinor > 0) {
        e.preventDefault();
        onCapture(method);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, captureOutcome, canCharge, method, totalMinor, onClose, onCapture]);

  if (!open) return null;

  function handlePrint() {
    void printReceipt({
      receiptNo: captureOutcome?.kind === "SYNCED" ? captureOutcome.receiptNo : "PENDING",
      lines: lines.map((l) => ({
        name: l.displayName,
        qty: l.quantity,
        unitPrice: minorToMajorNumber(l.displayPriceMinor),
        total: minorToMajorNumber(l.displayPriceMinor * l.quantity),
      })),
      total: minorToMajorNumber(totalMinor),
      method,
      cashier,
      customerName,
      date: new Date().toISOString(),
    });
  }

  const quickAmounts = [totalMinor, Math.ceil(totalMinor / 100) * 100, Math.ceil(totalMinor / 500) * 500, Math.ceil(totalMinor / 1000) * 1000]
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)
    .slice(0, 4);

  return (
    <div className="dsk-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="dsk-dialog dsk-dialog--lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
      >
        <div className="dsk-dialog__head">
          <div>
            <h2 id="checkout-title" className="dsk-dialog__title">
              {captureOutcome?.kind === "SYNCED" ? "Sale complete" :
               captureOutcome?.kind === "PENDING" ? "Sale queued" :
               captureOutcome?.kind === "NEEDS_REVIEW" ? "Sale needs review" :
               "Checkout"}
            </h2>
            <div className="dsk-dialog__sub">
              {customerName} · {cashier}
            </div>
          </div>
          <button type="button" className="dsk-dialog__close" onClick={onClose} aria-label="Close checkout">
            <IconClose width={16} height={16} />
          </button>
        </div>

        {captureOutcome === null ? (
          <>
            <div className="dsk-dialog__body">
              <div className="dsk-checkout__amount">
                <div className="dsk-checkout__amount-label">Amount due (server-authoritative)</div>
                <div className="dsk-checkout__amount-val tnum">{fmtMoneyMinor(totalMinor)}</div>
                {pendingSale ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "var(--tos-warning)" }}>
                    Offline — sale will sync automatically when back online.
                  </div>
                ) : null}
              </div>
              <div className="dsk-field">
                <span className="dsk-field__label">Payment method</span>
                <div className="dsk-checkout__methods">
                  {METHODS.map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        className="dsk-paymethod"
                        data-active={method === m.id ? "true" : "false"}
                        onClick={() => setMethod(m.id)}
                      >
                        <Icon width={20} height={20} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {method === "CASH" ? (
                <div className="dsk-field">
                  <span className="dsk-field__label">Amount tendered</span>
                  <input
                    type="number"
                    className="dsk-input dsk-input--mono"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                    autoFocus
                    aria-label="Amount tendered in cash"
                  />
                  <div className="dsk-checkout__tendered">
                    {quickAmounts.map((amt, i) => (
                      <button
                        key={i}
                        type="button"
                        className="dsk-checkout__quick tnum"
                        onClick={() => setTendered((amt / 100).toFixed(2))}
                      >
                        {fmtMoneyMinor(amt, "GHS")}
                      </button>
                    ))}
                  </div>
                  {tenderedMinor > 0 ? (
                    <div className={`dsk-checkout__change ${changeMinor < 0 ? "dsk-checkout__change--short" : ""}`}>
                      <span className="dsk-checkout__change-label">
                        {changeMinor < 0 ? "Short" : "Change"}
                      </span>
                      <span className="dsk-checkout__change-val tnum">
                        {fmtMoneyMinor(Math.abs(changeMinor))}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="dsk-banner dsk-banner--info">
                  <div className="dsk-banner__body">
                    <div className="dsk-banner__title">
                      {method === "CARD" ? "Card payment" : "Mobile money payment"}
                    </div>
                    <div className="dsk-banner__text">
                      Confirm the {method === "CARD" ? "card" : "MoMo"} transaction on the terminal,
                      then press Charge. The server validates the final amount.
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="dsk-dialog__foot">
              <span className="dsk-dialog__foot-info">
                <kbd style={{ fontFamily: "var(--tos-font-mono)", background: "var(--tos-surface)", border: "1px solid var(--tos-border)", borderRadius: 4, padding: "1px 5px" }}>Enter</kbd>
                to charge
              </span>
              <button type="button" className="dsk-btn dsk-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="dsk-btn dsk-btn--success"
                onClick={() => onCapture(method)}
                disabled={!canCharge}
              >
                <IconCheck width={16} height={16} />
                Charge {fmtMoneyMinor(totalMinor)}
              </button>
            </div>
          </>
        ) : captureOutcome.kind === "SYNCED" ? (
          <>
            <div className="dsk-dialog__body">
              <div className="dsk-success">
                <div className="dsk-success__check" aria-hidden>
                  <IconCheck width={32} height={32} />
                </div>
                <div className="dsk-success__title">Payment received</div>
                <div className="dsk-success__receipt">{captureOutcome.receiptNo}</div>
                <div className="dsk-success__amount tnum">{fmtMoneyMinor(totalMinor)}</div>
                <div className="dsk-text-muted" style={{ fontSize: "12px" }}>
                  {method === "CASH" ? `Change: ${fmtMoneyMinor(Math.max(changeMinor, 0))}` : `Paid via ${method.toLowerCase()}`}
                </div>
              </div>
            </div>
            <div className="dsk-dialog__foot">
              <span className="dsk-dialog__foot-info">
                <IconCheck width={13} height={13} style={{ color: "var(--tos-positive)" }} />
                Sale applied to the immutable ledger
              </span>
              <button type="button" className="dsk-btn dsk-btn--outline" onClick={handlePrint}>
                <IconPrinter width={16} height={16} />
                Print receipt
              </button>
              <button type="button" className="dsk-btn dsk-btn--primary" onClick={onClose}>
                New sale
              </button>
            </div>
          </>
        ) : captureOutcome.kind === "PENDING" ? (
          <>
            <div className="dsk-dialog__body">
              <div className="dsk-success">
                <div className="dsk-success__check" aria-hidden style={{ background: "var(--tos-warning)", color: "#fff" }}>
                  <IconAlert width={28} height={28} />
                </div>
                <div className="dsk-success__title">Sale queued for sync</div>
                <div className="dsk-success__receipt">Pending offline</div>
                <div className="dsk-success__amount tnum">{fmtMoneyMinor(totalMinor)}</div>
                <div className="dsk-text-muted" style={{ fontSize: "12px" }}>
                  The sale is durably captured. It will sync automatically when the desktop is back online.
                </div>
              </div>
            </div>
            <div className="dsk-dialog__foot">
              <span className="dsk-dialog__foot-info" style={{ color: "var(--tos-warning)" }}>
                <IconAlert width={13} height={13} />
                Sale pending sync
              </span>
              <button type="button" className="dsk-btn dsk-btn--outline" onClick={handlePrint}>
                <IconPrinter width={16} height={16} />
                Print provisional receipt
              </button>
              <button type="button" className="dsk-btn dsk-btn--primary" onClick={onClose}>
                New sale
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dsk-dialog__body">
              <div className="dsk-success">
                <div className="dsk-success__check" aria-hidden style={{ background: "var(--tos-danger)", color: "#fff" }}>
                  <IconAlert width={28} height={28} />
                </div>
                <div className="dsk-success__title">Sale needs review</div>
                <div className="dsk-success__receipt">
                  {captureOutcome.errorCode ?? "REJECTED"}
                </div>
                <div className="dsk-success__amount tnum">{fmtMoneyMinor(totalMinor)}</div>
                <div className="dsk-text-muted" style={{ fontSize: "12px" }}>
                  {captureOutcome.errorMessage ?? "The server rejected this sale. The evidence is preserved for review."}
                </div>
              </div>
              <div className="dsk-banner dsk-banner--warning" style={{ marginTop: "var(--tos-space-3)" }}>
                <IconAlert className="dsk-banner__icon" />
                <div className="dsk-banner__body">
                  <div className="dsk-banner__title">Correction evidence preserved</div>
                  <div className="dsk-banner__text">
                    The rejected sale is held in the offline queue with its server-rejection reason. Review and either retry or dismiss it from the sync panel.
                  </div>
                </div>
              </div>
            </div>
            <div className="dsk-dialog__foot">
              <button type="button" className="dsk-btn dsk-btn--ghost" onClick={onClose}>
                Dismiss for review
              </button>
              <button type="button" className="dsk-btn dsk-btn--outline" onClick={onRetry}>
                <IconRefresh width={15} height={15} />
                Retry sync
              </button>
              <button type="button" className="dsk-btn dsk-btn--primary" onClick={onClose}>
                New sale
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Parse a major-unit decimal string into minor units (pesewas for GHS). */
function tenderedMinorOf(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}
