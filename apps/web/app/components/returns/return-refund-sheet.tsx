"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconClose,
  IconCreditCard,
  IconReceipt,
  IconShield,
  IconSmartphone,
  IconWallet,
} from "../ui/icons";
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
  unitCostMinor: number;
  lineCostMinor: number;
  lineTotalMinor: number;
}

interface SaleDetailPayment {
  id: string;
  method: string;
  amountMinor: number;
  refundedMinor: number;
  status: string;
  providerReference: string | null;
}

interface SaleDetail {
  sale: {
    id: string;
    businessId: string;
    branchId: string;
    status: string;
    currencyCode: string;
    totalMinor: number;
    completedAt: string | null;
    createdAt: string;
    customer: { id: string; name: string | null; phone: string | null } | null;
    lines: ReadonlyArray<SaleDetailLine>;
    payments: ReadonlyArray<SaleDetailPayment>;
  };
}

interface ReturnRefundSheetProps {
  saleId: string | null;
  mode: "return" | "refund";
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
    hint: "Goods return to available inventory. COGS is reversed — the inventory asset is restored.",
    cls: "tos-restock-option tos-restock-option--restock",
  },
  {
    value: "DAMAGE",
    label: "Damaged / unsellable",
    hint: "Goods are discarded. Inventory is NOT restored — the cost is written off as a discarded loss.",
    cls: "tos-restock-option tos-restock-option--damage",
  },
];

const REFUND_METHODS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: "ORIGINAL_METHOD", label: "Original payment method", hint: "Reverse to the payment method(s) used on the sale" },
  { value: "CASH", label: "Cash refund", hint: "Pay out cash from the till" },
  { value: "CUSTOMER_CREDIT", label: "Customer credit", hint: "Add to the customer's credit balance for future sales" },
];

const RETURN_REASONS: ReadonlyArray<string> = [
  "Defective goods",
  "Wrong item supplied",
  "Customer changed mind",
  "Customer dissatisfaction",
  "Damaged in transit",
  "Pricing dispute",
  "Other",
];

function dispositionForLine(line: SaleDetailLine, choice: RestockChoice): string {
  if (line.itemKind === "SERVICE") return "NOT_APPLICABLE";
  if (line.itemKind === "PREPARED_PRODUCT") {
    return choice === "DAMAGE" ? "DISCARD" : "NOT_RETURNED";
  }
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

function paymentMethodIcon(method: string): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 18, height: 18 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 18, height: 18 }} />;
    case "CARD": return <IconCreditCard style={{ width: 18, height: 18 }} />;
    case "BANK": return <IconWallet style={{ width: 18, height: 18 }} />;
    default: return <IconReceipt style={{ width: 18, height: 18 }} />;
  }
}

export function ReturnRefundSheet({ saleId, mode, onClose, onComplete }: ReturnRefundSheetProps) {
  const { session, role } = useWorkspace();
  const path = saleId && session
    ? `/v1/sales/${encodeURIComponent(saleId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error } = useApiFetch<SaleDetail>(path);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [restockChoice, setRestockChoice] = useState<RestockChoice>("RESTOCK");
  const [refundMethod, setRefundMethod] = useState<string>("ORIGINAL_METHOD");
  const [reason, setReason] = useState<string>(RETURN_REASONS[0]!);
  const [customReason, setCustomReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER"].includes(role);

  useEffect(() => {
    if (data) {
      const initial: Record<string, number> = {};
      for (const line of data.sale.lines) initial[line.id] = 0;
      setQuantities(initial);
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

  // Financial impact preview — computed from server-provided per-unit values.
  // The final tax/COGS/refund allocation is computed server-side on posting.
  const impact = useMemo(() => {
    if (!data) return { revenueMinor: 0, taxMinor: 0, refundMinor: 0, cogsMinor: 0, selectedCount: 0, selectedQty: 0 };
    let revenueMinor = 0;
    let taxMinor = 0;
    let cogsMinor = 0;
    let selectedCount = 0;
    let selectedQty = 0;
    for (const line of data.sale.lines) {
      const qty = quantities[line.id] ?? 0;
      if (qty <= 0) continue;
      selectedCount += 1;
      selectedQty += qty;
      revenueMinor += line.unitNetMinor * qty;
      taxMinor += line.unitTaxMinor * qty;
      // COGS only applies when goods are physically returned (RESTOCK or DISCARD).
      // NOT_RETURNED / NOT_APPLICABLE reverses revenue+tax only — no COGS impact.
      const disposition = dispositionForLine(line, restockChoice);
      if (disposition === "RESTOCK" || disposition === "DISCARD") {
        cogsMinor += line.unitCostMinor * qty;
      }
    }
    return { revenueMinor, taxMinor, refundMinor: revenueMinor + taxMinor, cogsMinor, selectedCount, selectedQty };
  }, [data, quantities, restockChoice]);

  // Reversible payments — when refundMethod is ORIGINAL_METHOD, show which
  // payments will be reversed (excluding already-refunded amounts and OTHER).
  const reversiblePayments = useMemo(() => {
    if (!data) return [];
    return data.sale.payments
      .filter((p) => p.status === "SUCCEEDED" || p.status === "PARTIALLY_REVERSED")
      .filter((p) => p.method !== "OTHER")
      .map((p) => ({
        id: p.id,
        method: p.method,
        availableMinor: p.amountMinor - p.refundedMinor,
        providerReference: p.providerReference,
      }))
      .filter((p) => p.availableMinor > 0);
  }, [data]);

  const fullRefund = data ? impact.selectedQty === data.sale.lines.reduce((sum, l) => sum + l.quantityReturnable, 0) && impact.selectedQty > 0 : false;

  const handleSubmit = async () => {
    if (!data || busy || !canWrite) return;
    const lines = data.sale.lines
      .filter((l) => (quantities[l.id] ?? 0) > 0)
      .map((l) => ({
        saleLineId: l.id,
        quantity: quantities[l.id] ?? 0,
        disposition: dispositionForLine(l, restockChoice),
      }));
    if (lines.length === 0) {
      setSubmitError("Set a return quantity on at least one line.");
      return;
    }
    const finalReason = reason === "Other" ? customReason.trim() : reason;
    if (!finalReason) {
      setSubmitError("A reason is required.");
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const queue = getOfflineQueue();
      const mutationType = mode === "return" ? "RETURN_CREATE" : "REFUND_CREATE";
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType,
        payload: {
          originalSaleId: data.sale.id,
          reason: finalReason,
          refundMethod,
          lines,
        },
      });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      onComplete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setBusy(false);
    }
  };

  const eyebrow = mode === "return" ? "Return" : "Refund";
  const title = mode === "return" ? "Process return" : "Issue refund";
  const submitLabel = mode === "return" ? "Post return" : "Post refund";

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label={title}>
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">{eyebrow}</span>
            <h2 className="tos-sheet__title">{title}</h2>
            <p className="tos-sheet__sub">Receipt #{saleId.slice(0, 8)} · {fullRefund ? "Full return" : "Partial return"}</p>
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
                  {mode === "return" ? "Returns" : "Refunds"} are immutable once posted. The original sale is never edited — a corrective transaction is created and recorded as server-authoritative business evidence.
                  <span className="tos-callout__sub"> The refund total, tax reversal, COGS impact, and payment allocation are computed server-side on posting.</span>
                </span>
              </div>

              {/* Payment reversal indicator — which payment(s) will be reversed */}
              {refundMethod === "ORIGINAL_METHOD" && reversiblePayments.length > 0 ? (
                <div className="tos-payment-reversal">
                  <span className="tos-payment-reversal__icon" aria-hidden="true">
                    {paymentMethodIcon(reversiblePayments[0]!.method)}
                  </span>
                  <div className="tos-payment-reversal__body">
                    <span className="tos-payment-reversal__label">
                      {reversiblePayments.length === 1
                        ? `Reversing ${paymentMethodLabel(reversiblePayments[0]!.method)}`
                        : `Reversing ${reversiblePayments.length} payments`}
                    </span>
                    <span className="tos-payment-reversal__sub">
                      {reversiblePayments.map((p) => `${paymentMethodLabel(p.method)}${p.providerReference ? ` (${p.providerReference})` : ""}`).join(" · ")}
                    </span>
                  </div>
                  <span className="tos-payment-reversal__amount">
                    <MoneyValue minor={reversiblePayments.reduce((s, p) => s + p.availableMinor, 0)} currencyCode={currency} />
                  </span>
                </div>
              ) : null}

              {/* Line items — returnable lines with qty stepper */}
              <div className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Items to {mode === "return" ? "return" : "refund"}</h3>
                  <span className="tos-section__sub">{data.sale.lines.length} line(s) on receipt</span>
                </div>
                <div className="tos-section__body">
                  <div className="tos-purchase-lines">
                    {data.sale.lines.map((line) => {
                      const qty = quantities[line.id] ?? 0;
                      const lineRefundMinor = (line.unitNetMinor + line.unitTaxMinor) * qty;
                      const isService = line.itemKind === "SERVICE";
                      return (
                        <div key={line.id} className="tos-return-line">
                          <div className="tos-return-line__main">
                            <span className="tos-return-line__title">{line.itemName}</span>
                            <span className="tos-return-line__sub">
                              {line.quantity} × {line.saleUnitCode} · {line.quantityReturnable} returnable
                              {isService ? " · service" : ""}
                            </span>
                            <div className="tos-return-line__stepper">
                              <button
                                type="button"
                                className="tos-return-line__stepper-btn"
                                onClick={() => setQuantities((p) => ({ ...p, [line.id]: Math.max(0, qty - 1) }))}
                                aria-label={`Decrease return quantity for ${line.itemName}`}
                                disabled={busy || qty <= 0}
                              >−</button>
                              <span className="tos-return-line__stepper-val">{qty}</span>
                              <button
                                type="button"
                                className="tos-return-line__stepper-btn"
                                onClick={() => setQuantities((p) => ({ ...p, [line.id]: Math.min(line.quantityReturnable, qty + 1) }))}
                                aria-label={`Increase return quantity for ${line.itemName}`}
                                disabled={busy || qty >= line.quantityReturnable}
                              >+</button>
                            </div>
                          </div>
                          <div className="tos-return-line__total">
                            {qty > 0 ? (
                              <span className="tos-return-line__amount tos-return-line__amount--negative">
                                −<MoneyValue minor={lineRefundMinor} currencyCode={currency} />
                              </span>
                            ) : (
                              <span className="tos-return-line__amount tos-return-line__amount--muted">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Restockable vs damaged toggle — inventory effect explained */}
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
                  <span className="tos-field__hint" style={{ marginTop: "var(--tos-space-2)" }}>
                    Service lines always use NOT_APPLICABLE disposition — no inventory effect. Prepared items cannot be restocked (ingredients are already consumed).
                  </span>
                </div>
              </div>

              {/* Refund method — which payment will be reversed */}
              <div className="tos-field">
                <label className="tos-field__label" htmlFor="rr-refund-method">Refund method<span className="tos-field__label-required">*</span></label>
                <select
                  id="rr-refund-method"
                  className="tos-select"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  disabled={busy}
                >
                  {REFUND_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <span className="tos-field__hint">{REFUND_METHODS.find((m) => m.value === refundMethod)?.hint}</span>
              </div>

              {/* Reason — required by server */}
              <div className="tos-field">
                <label className="tos-field__label" htmlFor="rr-reason">Reason<span className="tos-field__label-required">*</span></label>
                <select
                  id="rr-reason"
                  className="tos-select"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                >
                  {RETURN_REASONS.map((r) => (
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

              {/* Financial impact summary — server-provided unit values */}
              <div className="tos-impact-summary">
                <div className="tos-impact-summary__head">
                  <span className="tos-impact-summary__title">Financial impact (preview)</span>
                  <span className="tos-impact-summary__sub">{fullRefund ? "Full return" : "Partial"}</span>
                </div>
                <div className="tos-impact-summary__rows">
                  <div className="tos-impact-row">
                    <span className="tos-impact-row__label">Revenue reversal</span>
                    <span className="tos-impact-row__val tos-impact-row__val--negative">
                      −<MoneyValue minor={impact.revenueMinor} currencyCode={currency} />
                    </span>
                  </div>
                  <div className="tos-impact-row">
                    <span className="tos-impact-row__label">Tax reversal</span>
                    <span className="tos-impact-row__val tos-impact-row__val--negative">
                      −<MoneyValue minor={impact.taxMinor} currencyCode={currency} />
                    </span>
                  </div>
                  <div className="tos-impact-row">
                    <span className="tos-impact-row__label">
                      COGS impact{restockChoice === "RESTOCK" ? " (restocked)" : " (discarded)"}
                    </span>
                    <span className={
                      impact.cogsMinor > 0
                        ? "tos-impact-row__val tos-impact-row__val--muted"
                        : "tos-impact-row__val tos-impact-row__val--muted"
                    }>
                      {impact.cogsMinor > 0 ? (
                        <MoneyValue minor={impact.cogsMinor} currencyCode={currency} />
                      ) : (
                        <span>—</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="tos-impact-summary__total">
                  <span className="tos-impact-summary__total-label">Refund due to customer</span>
                  <span className="tos-impact-summary__total-val tos-impact-summary__total-val--negative">
                    −<MoneyValue minor={impact.refundMinor} currencyCode={currency} />
                  </span>
                </div>
                <span className="tos-impact-summary__note">
                  Preview uses server-recorded per-unit net, tax, and cost from the sale line snapshots. Final figures (including tax reversal, COGS, and payment allocation) are computed server-side on posting.
                </span>
              </div>

              {submitError ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{submitError}</span></div> : null}
            </>
          ) : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={handleSubmit} loading={busy} disabled={!canWrite || !data || impact.refundMinor <= 0}>
            {canWrite ? `${submitLabel} (${impact.selectedCount} line${impact.selectedCount === 1 ? "" : "s"})` : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
