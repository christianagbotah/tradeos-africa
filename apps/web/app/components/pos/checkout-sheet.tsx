"use client";

import { useEffect, useState } from "react";
import { formatMoney, majorToMinor, minorToMajor, getCurrencyMeta } from "@tradeos/contracts";
import type { SyncResponse } from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import type { CartLine } from "./cart-panel";
import { CustomerPicker } from "./customer-picker";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconCheck, IconClose, IconPrint, IconShare } from "../ui/icons";
import type { CatalogItem, Customer } from "../workspace/workspace-provider";

type PaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

interface CheckoutSheetProps {
  open: boolean;
  lines: readonly CartLine[];
  currencyCode: string;
  businessId: string;
  branchId: string;
  customers: readonly Customer[];
  online: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface SaleResult {
  status: "pending" | "completed";
  reference: string;
  changeMinor: number | null;
  totalMinor: number | null;
  message?: string;
}

export function CheckoutSheet({
  open,
  lines,
  currencyCode,
  businessId,
  branchId,
  customers,
  online,
  onClose,
  onComplete,
}: CheckoutSheetProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [cashReceivedMinor, setCashReceivedMinor] = useState<number | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);

  const totalMinor = lines.reduce((sum, l) => sum + l.item.priceMinor * l.quantity, 0);
  const changeMinor = cashReceivedMinor !== null ? cashReceivedMinor - totalMinor : null;
  const canCharge = lines.length > 0 && (paymentMethod !== "CASH" || (cashReceivedMinor !== null && cashReceivedMinor >= totalMinor));

  // Reset state when the sheet opens.
  useEffect(() => {
    if (open) {
      setPaymentMethod("CASH");
      setCashReceivedMinor(null);
      setCustomer(null);
      setBusy(false);
      setError(null);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const meta = getCurrencyMeta(currencyCode);

  const handleCharge = async () => {
    if (!canCharge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const saleLines = lines.map((l) => ({
        itemId: l.item.id,
        saleUnitCode: l.item.saleUnitCode,
        quantity: l.quantity,
      }));
      const payload: Record<string, unknown> = {
        currencyCode,
        paymentMethod,
        lines: saleLines,
      };
      if (customer) payload.customerId = customer.id;

      const mutation = queue.build({
        businessId,
        branchId,
        mutationType: "SALE_CREATE",
        payload,
      });

      if (online) {
        // Direct sync push for immediate feedback.
        const res = await fetch("/v1/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${queue.sessions.load()?.accessToken ?? ""}`,
          },
          body: JSON.stringify({ mutations: [mutation] }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Sale failed (${res.status})`);
        }
        const json = (await res.json()) as SyncResponse;
        const mr = json.mutationResults[0];
        if (!mr) throw new Error("Server did not return a sale result.");
        if (mr.status === "REJECTED") {
          throw new Error(mr.errorMessage ?? mr.errorCode ?? "Sale was rejected by the server.");
        }
        if (mr.status === "RECEIVED") {
          // Queued server-side but not yet applied — treat as pending.
          setResult({
            status: "pending",
            reference: mutation.clientMutationId,
            changeMinor: paymentMethod === "CASH" ? changeMinor : null,
            totalMinor,
            message: "Sale received and is being processed.",
          });
          return;
        }
        // APPLIED — extract receipt reference from the result if present.
        const resultData = mr.result as { saleId?: string; receiptNo?: string; totalMinor?: number } | undefined;
        setResult({
          status: "completed",
          reference: resultData?.saleId ?? resultData?.receiptNo ?? mutation.clientMutationId,
          changeMinor: paymentMethod === "CASH" ? changeMinor : null,
          totalMinor: resultData?.totalMinor ?? totalMinor,
          message: "Sale complete.",
        });
      } else {
        // Offline — enqueue and surface the queued reference.
        await queue.enqueue(mutation);
        setResult({
          status: "pending",
          reference: mutation.clientMutationId,
          changeMinor: paymentMethod === "CASH" ? changeMinor : null,
          totalMinor,
          message: "You are offline. Sale queued locally and will sync automatically.",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sale could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  const handleShare = async () => {
    if (typeof navigator === "undefined" || !navigator.share) return;
    try {
      await navigator.share({
        title: "TradeOS receipt",
        text: `Receipt ${result?.reference ?? ""}`,
      });
    } catch {
      // user cancelled — ignore
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label="Checkout">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Checkout</span>
            <h2 className="tos-sheet__title">{result ? "Sale complete" : "Take payment"}</h2>
            <p className="tos-sheet__sub">{online ? "Online — server-authoritative" : "Offline — sale will queue"}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close checkout">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="tos-sheet__body">
          {result ? (
            <SuccessPanel
              result={result}
              currencyCode={currencyCode}
              onPrint={handlePrint}
              onShare={handleShare}
              onNewSale={onComplete}
            />
          ) : (
            <>
              <section className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Order summary</h3>
                  <span className="tos-section__sub">{lines.length} line(s)</span>
                </div>
                <div className="tos-section__body">
                  <ul className="tos-list" style={{ borderRadius: 0, border: "none", boxShadow: "none" }}>
                    {lines.map((l) => (
                      <li key={l.item.id} className="tos-list__row" style={{ borderBottom: "1px solid var(--tos-border)" }}>
                        <div className="tos-list__row-main">
                          <span className="tos-list__row-title">{l.item.name}</span>
                          <span className="tos-list__row-sub">{l.quantity} × {l.item.saleUnitName}</span>
                        </div>
                        <div className="tos-list__row-meta">
                          <span className="tos-list__row-amount">
                            <MoneyValue minor={l.item.priceMinor * l.quantity} currencyCode={currencyCode} />
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="tos-section__foot">
                  <span className="tos-page__eyebrow">Total</span>
                  <MoneyValue minor={totalMinor} currencyCode={currencyCode} size="lg" />
                </div>
              </section>

              <CustomerPicker customers={customers} selected={customer} onSelect={setCustomer} />

              <div className="tos-field">
                <span className="tos-field__label">Payment method</span>
                <div className="tos-tabs">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className="tos-tabs__tab"
                      aria-selected={paymentMethod === m.value}
                      onClick={() => setPaymentMethod(m.value)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === "CASH" ? (
                <>
                  <MoneyInput
                    currencyCode={currencyCode}
                    valueMinor={cashReceivedMinor}
                    onChange={setCashReceivedMinor}
                    label="Cash received"
                    placeholder="0"
                    size="lg"
                  />
                  <div className="tos-kv">
                    <span className="tos-kv__key">Change due</span>
                    <span className="tos-kv__val">
                      {changeMinor !== null && changeMinor >= 0 ? (
                        <MoneyValue minor={changeMinor} currencyCode={currencyCode} tone="positive" size="lg" />
                      ) : (
                        <span className="tos-money-value tos-money-value--muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="tos-row">
                    {[totalMinor, totalMinor * 2, roundToNextCashUnit(totalMinor, currencyCode)].map((amt, i) => (
                      <button
                        key={i}
                        type="button"
                        className="tos-btn tos-btn--sm tos-btn--outline"
                        onClick={() => setCashReceivedMinor(amt)}
                      >
                        {formatMoney(amt, currencyCode)}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {error ? (
                <div className="tos-banner tos-banner--danger" role="alert">
                  <span className="tos-banner__title">{error}</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {!result ? (
          <div className="tos-sheet__foot">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              variant="gold"
              size="lg"
              onClick={handleCharge}
              loading={busy}
              disabled={!canCharge}
            >
              {paymentMethod === "CASH" && changeMinor !== null && changeMinor >= 0
                ? `Charge (${formatMoney(totalMinor, currencyCode)})`
                : `Charge ${formatMoney(totalMinor, currencyCode)}`}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SuccessPanel({
  result,
  currencyCode,
  onPrint,
  onShare,
  onNewSale,
}: {
  result: SaleResult;
  currencyCode: string;
  onPrint: () => void;
  onShare: () => void;
  onNewSale: () => void;
}) {
  return (
    <div className="tos-success">
      <div className="tos-success__check" aria-hidden="true">
        {result.status === "completed" ? (
          <IconCheck className="tos-success__check-icon" />
        ) : (
          <IconCheck className="tos-success__check-icon" style={{ color: "var(--tos-warning)" }} />
        )}
      </div>
      <h2 className="tos-success__title">
        {result.status === "completed" ? "Sale complete" : "Sale queued"}
      </h2>
      <p className="tos-success__text">{result.message}</p>

      <div className="tos-success__receipt">
        <span className="tos-success__receipt-label">Receipt reference</span>
        <span className="tos-success__receipt-ref">{result.reference}</span>
        {result.totalMinor !== null ? (
          <>
            <span className="tos-success__receipt-label" style={{ marginTop: "var(--tos-space-2)" }}>Total</span>
            <MoneyValue minor={result.totalMinor} currencyCode={currencyCode} size="lg" />
          </>
        ) : null}
        {result.changeMinor !== null && result.changeMinor > 0 ? (
          <>
            <span className="tos-success__receipt-label" style={{ marginTop: "var(--tos-space-2)" }}>Change due</span>
            <span className="tos-success__receipt-change">
              {formatMoney(result.changeMinor, currencyCode)}
            </span>
          </>
        ) : null}
      </div>

      <div className="tos-success__actions">
        <Button variant="outline" icon={<IconPrint className="tos-btn__icon" />} onClick={onPrint}>Print</Button>
        <Button variant="outline" icon={<IconShare className="tos-btn__icon" />} onClick={onShare}>Share</Button>
        <Button variant="gold" className="tos-btn--block" onClick={onNewSale}>New sale</Button>
      </div>
    </div>
  );
}

/** Rounds up to the next "natural" cash unit (e.g. nearest 10/50/100) for quick-cash buttons. */
function roundToNextCashUnit(minor: number, currencyCode: string): number {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) return minor;
  const major = minorToMajor(minor, currencyCode) ?? 0;
  const factor = major >= 100 ? 50 : major >= 20 ? 10 : 5;
  const rounded = Math.ceil(major / factor) * factor;
  const back = majorToMinor(rounded, currencyCode);
  return back ?? minor;
}
