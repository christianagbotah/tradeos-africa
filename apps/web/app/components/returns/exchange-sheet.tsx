"use client";

import { useEffect, useState } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { primarySellableUnit } from "../../../lib/catalog-read-model";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { IconBanknote, IconClose, IconCreditCard, IconRefresh, IconShield, IconSmartphone, IconWallet } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

interface SaleDetailLine {
  id: string;
  itemId: string;
  itemName: string;
  itemKind: string;
  quantity: number;
  quantityReturnable: number;
  saleUnitCode: string;
  unitNetMinor: number;
  unitTaxMinor: number;
  lineTotalMinor: number;
}

interface SaleDetailPayment {
  id: string;
  method: string;
  amountMinor: number;
  refundedMinor: number;
  status: string;
}

interface SaleDetail {
  sale: {
    id: string;
    businessId: string;
    branchId: string;
    currencyCode: string;
    lines: ReadonlyArray<SaleDetailLine>;
    payments: ReadonlyArray<SaleDetailPayment>;
  };
}

interface ExchangeSheetProps {
  saleId: string | null;
  onClose: () => void;
  onComplete: () => void;
}

type RestockChoice = "RESTOCK" | "DAMAGE";

const RESTOCK_OPTIONS: ReadonlyArray<{
  value: RestockChoice;
  label: string;
  hint: string;
  cls: string;
}> = [
  {
    value: "RESTOCK",
    label: "Restockable",
    hint: "Returned goods go back to available inventory.",
    cls: "tos-restock-option tos-restock-option--restock",
  },
  {
    value: "DAMAGE",
    label: "Damaged / unsellable",
    hint: "Returned goods are discarded — inventory is NOT restored.",
    cls: "tos-restock-option tos-restock-option--damage",
  },
];

const SETTLEMENT_METHODS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: "ORIGINAL_METHOD", label: "Original payment method", hint: "Settle via the payment method used on the original sale" },
  { value: "CASH", label: "Cash", hint: "Pay out or collect cash at the till" },
  { value: "CUSTOMER_CREDIT", label: "Customer credit", hint: "Add to or draw from the customer's credit balance" },
];

const EXCHANGE_REASONS: ReadonlyArray<string> = [
  "Wrong size / variant",
  "Defective goods",
  "Customer preference",
  "Wrong item supplied",
  "Other",
];

function exchangeDispositionForLine(line: SaleDetailLine, choice: RestockChoice): string {
  if (line.itemKind === "SERVICE") return "NOT_APPLICABLE";
  if (line.itemKind === "PREPARED_PRODUCT") return choice === "DAMAGE" ? "DISCARD" : "NOT_APPLICABLE";
  // PRODUCT
  return choice === "DAMAGE" ? "DISCARD" : "RESTOCK";
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case "CASH": return "Cash";
    case "MOMO": return "Mobile money";
    case "CARD": return "Card";
    case "BANK": return "Bank transfer";
    case "OTHER": return "Other";
    default: return method;
  }
}

function paymentMethodIcon(method: string) {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 18, height: 18 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 18, height: 18 }} />;
    case "CARD": return <IconCreditCard style={{ width: 18, height: 18 }} />;
    case "BANK": return <IconWallet style={{ width: 18, height: 18 }} />;
    default: return <IconRefresh style={{ width: 18, height: 18 }} />;
  }
}

export function ExchangeSheet({ saleId, onClose, onComplete }: ExchangeSheetProps) {
  const { session, role, catalog } = useWorkspace();
  const path = saleId && session
    ? `/v1/sales/${encodeURIComponent(saleId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error } = useApiFetch<SaleDetail>(path);
  const [returnLineId, setReturnLineId] = useState<string | null>(null);
  const [returnQty, setReturnQty] = useState(1);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const [newQty, setNewQty] = useState(1);
  const [restockChoice, setRestockChoice] = useState<RestockChoice>("RESTOCK");
  const [settlementMethod, setSettlementMethod] = useState<string>("ORIGINAL_METHOD");
  const [reason, setReason] = useState<string>(EXCHANGE_REASONS[0]!);
  const [customReason, setCustomReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(role);

  useEffect(() => {
    if (data && data.sale.lines.length > 0) {
      setReturnLineId(data.sale.lines[0]!.id);
    }
  }, [data]);

  useEffect(() => {
    if (!saleId) return;
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => {
      if (typeof document !== "undefined") document.body.style.overflow = "";
    };
  }, [saleId]);

  if (!saleId || !session) return null;

  const currency = data?.sale.currencyCode ?? session.currencyCode;
  const activeCatalog = catalog.filter((c) => c.active);
  const returnLine = data?.sale.lines.find((l) => l.id === returnLineId);
  const returnUnit = returnLine && returnLine.quantity > 0
    ? Math.round(returnLine.lineTotalMinor / returnLine.quantity)
    : 0;
  const newItem = activeCatalog.find((c) => c.id === newItemId);
  const newUnit = newItem ? primarySellableUnit(newItem) : null;
  const newTotalMinor = newUnit ? (newUnit.defaultSalePriceMinor ?? 0) * newQty : 0;
  const effectiveReturnQty = returnLine ? Math.min(returnQty, returnLine.quantityReturnable) : 0;
  const returnTotalMinor = returnLine ? returnUnit * effectiveReturnQty : 0;
  const netMinor = newTotalMinor - returnTotalMinor;
  const customerPays = netMinor > 0;
  const refundDue = netMinor < 0;

  // Reversible payments — when settlement is ORIGINAL_METHOD, show which payment(s) settle the exchange.
  const reversiblePayments = data
    ? data.sale.payments
        .filter((p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REVERSED")
        .filter((p) => p.method !== "OTHER")
        .map((p) => ({ id: p.id, method: p.method, availableMinor: p.amountMinor - p.refundedMinor }))
        .filter((p) => p.availableMinor > 0)
    : [];

  const handleSubmit = async () => {
    if (!data || busy || !canWrite || !returnLine || !newItem || !newUnit) return;
    const finalReason = reason === "Other" ? customReason.trim() : reason;
    if (!finalReason) {
      setSubmitError("A reason is required.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: "EXCHANGE_CREATE",
        payload: {
          originalSaleId: data.sale.id,
          reason: finalReason,
          settlementMethod,
          returnedLines: [{
            saleLineId: returnLine.id,
            quantity: effectiveReturnQty,
            disposition: exchangeDispositionForLine(returnLine, restockChoice),
          }],
          replacementLines: [{ itemId: newItem.id, saleUnitCode: newUnit.code, quantity: newQty }],
        },
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      onComplete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit exchange.");
    } finally {
      setBusy(false);
    }
  };

  const netCls = customerPays
    ? "tos-exchange-net__val tos-exchange-net__val--customer-pays"
    : refundDue
      ? "tos-exchange-net__val tos-exchange-net__val--refund-due"
      : "tos-exchange-net__val";

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label="Exchange">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Exchange</span>
            <h2 className="tos-sheet__title">Process exchange</h2>
            <p className="tos-sheet__sub">Receipt #{saleId.slice(0, 8)} · swap returned goods for a different item</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="tos-sheet__body">
          {loading ? (
            <div className="tos-state tos-state--inline"><span className="tos-spinner" /></div>
          ) : error ? (
            <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div>
          ) : data ? (
            <>
              {/* Immutable-evidence callout */}
              <div className="tos-callout tos-callout--warning">
                <span className="tos-callout__icon-wrap" aria-hidden="true">
                  <IconShield style={{ width: 16, height: 16 }} />
                </span>
                <span className="tos-callout__body">
                  Exchanges are immutable once posted. The original sale is never edited — a corrective exchange case is created with the returned goods and the new goods recorded as server-authoritative line items.
                  <span className="tos-callout__sub"> The net difference is settled server-side: the customer pays if the new item costs more, or receives a refund if it costs less.</span>
                </span>
              </div>

              {/* Two-column exchange layout — return (left) / new (right) */}
              <div className="tos-exchange-grid">
                {/* Return side */}
                <div className="tos-exchange-side tos-exchange-side--return">
                  <div className="tos-exchange-side__head">
                    <span className="tos-exchange-side__title">Return from receipt</span>
                    <span className="tos-exchange-side__sub">Goods going back</span>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-ret-line">Line item</label>
                    <select
                      id="ex-ret-line"
                      className="tos-select"
                      value={returnLineId ?? ""}
                      onChange={(e) => setReturnLineId(e.target.value)}
                      disabled={busy}
                    >
                      {data.sale.lines.map((l) => (
                        <option key={l.id} value={l.id}>{l.itemName} ({l.quantityReturnable} returnable)</option>
                      ))}
                    </select>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-ret-qty">Quantity to return</label>
                    <input
                      id="ex-ret-qty"
                      type="number"
                      min={1}
                      max={returnLine?.quantityReturnable ?? 1}
                      className="tos-input"
                      value={returnQty}
                      onChange={(e) => setReturnQty(Math.max(1, Number(e.target.value)))}
                      disabled={busy}
                    />
                    <span className="tos-field__hint">
                      {returnLine ? `${returnLine.quantityReturnable} returnable of ${returnLine.quantity} sold` : ""}
                    </span>
                  </div>
                  <div className="tos-exchange-side__amount">
                    <span className="tos-exchange-side__amount-label">Return value</span>
                    <span className="tos-exchange-side__amount-val tos-exchange-side__amount-val--negative">
                      −<MoneyValue minor={returnTotalMinor} currencyCode={currency} />
                    </span>
                  </div>
                </div>

                {/* New side */}
                <div className="tos-exchange-side tos-exchange-side--new">
                  <div className="tos-exchange-side__head">
                    <span className="tos-exchange-side__title">New item</span>
                    <span className="tos-exchange-side__sub">Goods going out</span>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-new-item">Replacement item</label>
                    <select
                      id="ex-new-item"
                      className="tos-select"
                      value={newItemId ?? ""}
                      onChange={(e) => setNewItemId(e.target.value || null)}
                      disabled={busy}
                    >
                      <option value="">Select…</option>
                      {activeCatalog.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {newItem && newUnit ? (
                      <span className="tos-field__hint">{newUnit.label} · current price</span>
                    ) : null}
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor="ex-new-qty">Quantity</label>
                    <input
                      id="ex-new-qty"
                      type="number"
                      min={1}
                      className="tos-input"
                      value={newQty}
                      onChange={(e) => setNewQty(Math.max(1, Number(e.target.value)))}
                      disabled={busy}
                    />
                  </div>
                  <div className="tos-exchange-side__amount">
                    <span className="tos-exchange-side__amount-label">New item value</span>
                    <span className="tos-exchange-side__amount-val tos-exchange-side__amount-val--positive">
                      +<MoneyValue minor={newTotalMinor} currencyCode={currency} />
                    </span>
                  </div>
                </div>
              </div>

              {/* Inventory effect — restockable vs damaged toggle */}
              <div className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Inventory effect</h3>
                  <span className="tos-section__sub">What happens to returned goods</span>
                </div>
                <div className="tos-section__body--padded">
                  <div className="tos-restock-toggle" role="radiogroup" aria-label="Inventory effect">
                    {RESTOCK_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={opt.cls}
                        aria-pressed={restockChoice === opt.value}
                        role="radio"
                        aria-checked={restockChoice === opt.value}
                        onClick={() => setRestockChoice(opt.value)}
                        disabled={busy}
                      >
                        <span className="tos-restock-option__label">{opt.label}</span>
                        <span className="tos-restock-option__hint">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Settlement method — which payment will settle the net difference */}
              <div className="tos-field">
                <label className="tos-field__label" htmlFor="ex-settlement">Settlement method<span className="tos-field__label-required">*</span></label>
                <select
                  id="ex-settlement"
                  className="tos-select"
                  value={settlementMethod}
                  onChange={(e) => setSettlementMethod(e.target.value)}
                  disabled={busy}
                >
                  {SETTLEMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <span className="tos-field__hint">{SETTLEMENT_METHODS.find((m) => m.value === settlementMethod)?.hint}</span>
              </div>

              {/* Payment reversal indicator when ORIGINAL_METHOD is selected */}
              {settlementMethod === "ORIGINAL_METHOD" && reversiblePayments.length > 0 ? (
                <div className="tos-payment-reversal">
                  <span className="tos-payment-reversal__icon" aria-hidden="true">
                    {paymentMethodIcon(reversiblePayments[0]!.method)}
                  </span>
                  <div className="tos-payment-reversal__body">
                    <span className="tos-payment-reversal__label">
                      {reversiblePayments.length === 1
                        ? `Settling via ${paymentMethodLabel(reversiblePayments[0]!.method)}`
                        : `Settling via ${reversiblePayments.length} payments`}
                    </span>
                    <span className="tos-payment-reversal__sub">
                      {reversiblePayments.map((p) => paymentMethodLabel(p.method)).join(" · ")}
                    </span>
                  </div>
                  <span className="tos-payment-reversal__amount">
                    <MoneyValue minor={reversiblePayments.reduce((s, p) => s + p.availableMinor, 0)} currencyCode={currency} />
                  </span>
                </div>
              ) : null}

              {/* Reason — required by server */}
              <div className="tos-field">
                <label className="tos-field__label" htmlFor="ex-reason">Reason<span className="tos-field__label-required">*</span></label>
                <select
                  id="ex-reason"
                  className="tos-select"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                >
                  {EXCHANGE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {reason === "Other" ? (
                  <input
                    type="text"
                    className="tos-input"
                    style={{ marginTop: "var(--tos-space-2)" }}
                    placeholder="Describe the reason…"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    disabled={busy}
                  />
                ) : null}
              </div>

              {/* Net-due summary — midnight hero with customer-pays / refund-due */}
              <div className="tos-exchange-net">
                <span className="tos-exchange-net__label">
                  {customerPays ? "Customer pays" : refundDue ? "Refund due to customer" : "Even exchange"}
                </span>
                <span className={netCls}>
                  <MoneyValue minor={Math.abs(netMinor)} currencyCode={currency} />
                </span>
                <span className="tos-exchange-net__hint">
                  {customerPays
                    ? "The new item costs more than the returned goods. The customer pays the difference."
                    : refundDue
                      ? "The returned goods cost more than the new item. The customer receives a refund of the difference."
                      : "The new item costs exactly the same as the returned goods. No payment or refund is due."}
                </span>
              </div>

              {submitError ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{submitError}</span></div> : null}
            </>
          ) : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={<IconRefresh className="tos-btn__icon" />} onClick={handleSubmit} loading={busy} disabled={!canWrite || !returnLine || !newItem}>
            {canWrite ? "Post exchange" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
