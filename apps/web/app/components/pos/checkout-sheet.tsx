"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, getCurrencyMeta, parseMoneyInput } from "@tradeos/contracts";
import {
  enqueueMutation,
  flushPendingMutations,
  getFailedMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  type AppliedMutationDetail,
  type PendingMutation,
} from "../../lib/offline-sync";
import { messageFrom } from "../../lib/client-api";
import { Button } from "../ui/button";
import type { PosCustomer } from "./customer-picker";
import type { CartLine, PosPaymentMethod } from "./pos-model";

const paymentMethods: Array<{ value: PosPaymentMethod; label: string; detail: string }> = [
  { value: "CASH", label: "Cash", detail: "Cash received at checkout" },
  { value: "MOMO", label: "MoMo", detail: "Mobile money payment" },
  { value: "CARD", label: "Card", detail: "Card or POS terminal" },
  { value: "BANK", label: "Bank", detail: "Bank transfer or deposit" },
  { value: "OTHER", label: "Other", detail: "Another immediate payment method" },
  { value: "CUSTOMER_CREDIT", label: "Customer Credit", detail: "Post the amount to the selected customer account" },
];

export type SaleMutationInput = {
  clientId: string;
  clientMutationId: string;
  businessId: string;
  branchId: string;
  currencyCode: string;
  cart: CartLine[];
  customer: PosCustomer | null;
  paymentMethod: PosPaymentMethod;
  occurredAt: string;
};

export function buildSaleMutation(input: SaleMutationInput): PendingMutation & { payload: {
  currencyCode: string;
  customerId?: string;
  paymentMethod: PosPaymentMethod;
  lines: Array<{ itemId: string; saleUnitCode: string; quantity: number }>;
} } {
  if (input.cart.length === 0) throw new Error("Add at least one item before charging.");
  for (const line of input.cart) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("Every sale quantity must be greater than zero.");
  }
  if (input.paymentMethod === "CUSTOMER_CREDIT" && !customerCreditReadiness(input.customer, displayTotalMinor(input.cart)).allowed) {
    throw new Error("Customer Credit is not available for this sale.");
  }

  return {
    clientId: input.clientId,
    clientMutationId: input.clientMutationId,
    businessId: input.businessId,
    branchId: input.branchId,
    mutationType: "SALE_CREATE",
    occurredAt: input.occurredAt,
    payload: {
      currencyCode: input.currencyCode,
      ...(input.customer ? { customerId: input.customer.id } : {}),
      paymentMethod: input.paymentMethod,
      lines: input.cart.map((line) => ({
        itemId: line.itemId,
        saleUnitCode: line.saleUnitCode,
        quantity: line.quantity,
      })),
    },
  };
}

export function customerCreditReadiness(customer: PosCustomer | null, totalMinor: number): { allowed: boolean; reason: string } {
  if (!customer) return { allowed: false, reason: "Choose a named customer before using Customer Credit." };
  if (!customer.active) return { allowed: false, reason: "This customer is archived and cannot receive new credit." };
  if (!customer.creditEnabled || customer.creditLimitMinor === null) return { allowed: false, reason: "Customer Credit is not enabled for this customer." };
  if ((customer.availableCreditMinor ?? 0) < totalMinor) return { allowed: false, reason: "The customer does not have enough available credit for this sale." };
  return { allowed: true, reason: "Customer Credit is available. Final approval is checked again by the server." };
}

export function displayTotalMinor(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + Math.round(line.priceMinor * line.quantity), 0);
}

export type CheckoutSuccessSnapshot = {
  saleId: string | null;
  reference: string;
  totalMinor: number;
  lineCount: number;
  customerName: string;
  changeDueMinor: number | null;
  synced: boolean;
};

export function calculateChangeDueMinor(amountTendered: string, totalMinor: number, currencyCode: string): number | null {
  if (!amountTendered.trim()) return null;
  const tenderedMinor = parseMoneyInput(amountTendered, currencyCode);
  if (tenderedMinor === null || tenderedMinor < 0) return null;
  return tenderedMinor - totalMinor;
}

export function createCheckoutSuccessSnapshot(input: {
  clientMutationId: string;
  estimatedTotalMinor: number;
  lineCount: number;
  customerName: string;
  changeDueMinor: number | null;
  synced: boolean;
  appliedResult?: unknown;
}): CheckoutSuccessSnapshot {
  const applied = readAppliedSaleResult(input.appliedResult);
  const saleId = applied?.saleId ?? null;
  const totalMinor = applied?.totalMinor ?? input.estimatedTotalMinor;
  return {
    saleId,
    reference: (saleId ?? input.clientMutationId).slice(0, 8).toUpperCase(),
    totalMinor,
    lineCount: input.lineCount,
    customerName: input.customerName,
    changeDueMinor: input.changeDueMinor,
    synced: input.synced,
  };
}

function readAppliedSaleResult(value: unknown): { saleId: string; totalMinor: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { saleId?: unknown; totalMinor?: unknown };
  if (typeof candidate.saleId !== "string" || candidate.saleId.length === 0) return null;
  if (!Number.isSafeInteger(candidate.totalMinor) || (candidate.totalMinor as number) < 0) return null;
  return { saleId: candidate.saleId, totalMinor: candidate.totalMinor as number };
}

export function CheckoutSheet({
  open,
  businessId,
  branchId,
  currencyCode,
  cart,
  customer,
  onClose,
  returnFocusRef,
  onDurablySaved,
  onStatus,
}: {
  open: boolean;
  businessId: string;
  branchId: string;
  currencyCode: string;
  cart: CartLine[];
  customer: PosCustomer | null;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  onDurablySaved: (clientMutationId: string) => void;
  onStatus: (message: string, tone?: "success" | "pending" | "error") => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("CASH");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [amountTendered, setAmountTendered] = useState<string>("");
  const [success, setSuccess] = useState<CheckoutSuccessSnapshot | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const totalMinor = useMemo(() => displayTotalMinor(cart), [cart]);
  const credit = useMemo(() => customerCreditReadiness(customer, totalMinor), [customer, totalMinor]);

  const changeDueMinor = useMemo(() => {
    if (paymentMethod !== "CASH") return null;
    return calculateChangeDueMinor(amountTendered, totalMinor, currencyCode);
  }, [paymentMethod, amountTendered, totalMinor, currencyCode]);
  const cashStep = useMemo(() => {
    const exponent = getCurrencyMeta(currencyCode)?.exponent;
    if (exponent === undefined) return "any";
    if (exponent === 0) return "1";
    return `0.${"0".repeat(exponent - 1)}1`;
  }, [currencyCode]);

  useEffect(() => {
    if (!open) {
      setSuccess(null);
      setAmountTendered("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const sheet = sheetRef.current;
    const initialTabbables = sheet
      ? Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((element) => element.offsetParent !== null)
      : [];
    initialTabbables[0]?.focus();
    return () => {
      const target = restoreFocusRef.current;
      if (target?.isConnected && !target.hasAttribute("disabled")) target.focus();
      else document.querySelector<HTMLElement>(".pos-product-search input")?.focus();
    };
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const tabbables = Array.from(sheet.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.offsetParent !== null);
      if (tabbables.length === 0) return;
      const first = tabbables[0]!;
      const last = tabbables[tabbables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  const charge = async () => {
    if (busy || cart.length === 0) return;
    if (paymentMethod === "CUSTOMER_CREDIT" && !credit.allowed) {
      setMessage(credit.reason);
      return;
    }
    setBusy(true);
    setMessage(null);
    const clientMutationId = crypto.randomUUID();
    const receiptBase = {
      clientMutationId,
      estimatedTotalMinor: totalMinor,
      lineCount: cart.length,
      customerName: customer?.name ?? "Walk-in customer",
      changeDueMinor: paymentMethod === "CASH" ? changeDueMinor : null,
    };
    try {
      const mutation = buildSaleMutation({
        clientId: getOrCreateClientId(),
        clientMutationId,
        businessId,
        branchId,
        currencyCode,
        cart,
        customer,
        paymentMethod,
        occurredAt: new Date().toISOString(),
      });

      enqueueMutation(mutation);
      onDurablySaved(clientMutationId);

      if (!navigator.onLine) {
        onStatus("Saved offline · pending sync", "pending");
        setSuccess(createCheckoutSuccessSnapshot({ ...receiptBase, synced: false }));
        return;
      }

      let appliedResult: unknown;
      const handleApplied = (event: Event) => {
        const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
        if (detail.clientMutationId === clientMutationId) appliedResult = detail.result;
      };
      window.addEventListener(mutationAppliedEvent, handleApplied);
      try {
        const summary = await flushPendingMutations();
        const failed = getFailedMutations().find((entry) => entry.mutation.clientMutationId === clientMutationId);
        if (failed) {
          onStatus(`Sale needs review · ${failed.result.errorMessage ?? failed.result.errorCode ?? "server rejected the sale"}`, "error");
          onClose();
        } else {
          const synced = summary.received === 0 && summary.pending === 0;
          onStatus(synced ? "Sale completed and synchronized" : "Sale saved · pending sync", synced ? "success" : "pending");
          setSuccess(createCheckoutSuccessSnapshot({ ...receiptBase, synced, appliedResult }));
        }
      } catch {
        onStatus("Sale saved · pending sync", "pending");
        setSuccess(createCheckoutSuccessSnapshot({ ...receiptBase, synced: false, appliedResult }));
      } finally {
        window.removeEventListener(mutationAppliedEvent, handleApplied);
      }
    } catch (reason) {
      const nextMessage = messageFrom(reason);
      setMessage(nextMessage);
      onStatus(nextMessage, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos-checkout-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={sheetRef} className="pos-checkout-sheet" role="dialog" aria-modal="true" aria-labelledby="pos-checkout-title">
        <header className="pos-checkout-header">
          <div>
            <span>Complete sale</span>
            <h2 id="pos-checkout-title">Choose payment</h2>
            <p>{customer ? customer.name : "Walk-in customer"} · {cart.length} line{cart.length === 1 ? "" : "s"}</p>
          </div>
          <button className="pos-checkout-close" type="button" aria-label="Close checkout" disabled={busy} onClick={onClose}>×</button>
        </header>

        <div className="pos-checkout-total">
          <span>Charge</span>
          <strong>{formatMoney(totalMinor, currencyCode)}</strong>
          <small>Displayed total is an estimate; TradeOS validates authoritative prices when the sale syncs.</small>
        </div>

        <div className="pos-payment-grid" role="radiogroup" aria-label="Payment method">
          {paymentMethods.map((method) => {
            const disabled = method.value === "CUSTOMER_CREDIT" && !credit.allowed;
            return (
              <button
                key={method.value}
                type="button"
                role="radio"
                aria-checked={paymentMethod === method.value}
                className={`pos-payment-option${paymentMethod === method.value ? " selected" : ""}`}
                disabled={disabled || busy}
                onClick={() => setPaymentMethod(method.value)}
              >
                <strong>{method.label}</strong>
                <span>{method.value === "CUSTOMER_CREDIT" ? credit.reason : method.detail}</span>
              </button>
            );
          })}
        </div>

        {message ? <div className="pos-checkout-message" role="status">{message}</div> : null}
        {paymentMethod === "CASH" ? (
          <label className="pos-cash-tendered">
            <span>Cash received</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={cashStep}
              value={amountTendered}
              onChange={(event) => setAmountTendered(event.target.value)}
              placeholder={formatMoney(totalMinor, currencyCode)}
              aria-label="Cash received from customer"
            />
            {changeDueMinor !== null && changeDueMinor > 0 ? (
              <small className="pos-change-due">Change due: <strong>{formatMoney(changeDueMinor, currencyCode)}</strong></small>
            ) : changeDueMinor !== null && changeDueMinor < 0 ? (
              <small className="pos-change-due pos-change-due--short">Short by: <strong>{formatMoney(-changeDueMinor, currencyCode)}</strong></small>
            ) : null}
          </label>
        ) : null}
        <footer className="pos-checkout-footer">
          <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || cart.length === 0 || (paymentMethod === "CUSTOMER_CREDIT" && !credit.allowed) || (paymentMethod === "CASH" && changeDueMinor !== null && changeDueMinor < 0)} onClick={() => void charge()}>
            {busy ? "Saving…" : `Charge ${formatMoney(totalMinor, currencyCode)}`}
          </Button>
        </footer>
      </div>

      {success ? (
        <div className="pos-checkout-success-overlay" role="dialog" aria-modal="true" aria-labelledby="pos-success-title">
          <div className="pos-checkout-success">
            <div className="pos-checkout-success-icon" aria-hidden="true">{success.synced ? "✓" : "↻"}</div>
            <span className="pos-checkout-success-eyebrow">{success.synced ? "Sale completed" : "Saved · pending sync"}</span>
            <h2 id="pos-success-title">Receipt {success.reference}</h2>
            <p className="pos-checkout-success-total">{formatMoney(totalMinor, currencyCode)}</p>
            {success.changeDueMinor !== null && success.changeDueMinor > 0 ? (
              <div className="pos-checkout-success-change">
                <span>Change due</span>
                <strong>{formatMoney(success.changeDueMinor, currencyCode)}</strong>
              </div>
            ) : null}
            <div className="pos-checkout-success-customer">
              {success.customerName} · {success.lineCount} line{success.lineCount === 1 ? "" : "s"}
            </div>
            <div className="pos-checkout-success-actions">
              <Button variant="ghost" type="button" onClick={() => { if (typeof window !== "undefined") window.print(); }}>Print receipt</Button>
              <Button variant="ghost" type="button" onClick={() => {
                if (typeof navigator !== "undefined" && navigator.share) {
                  void navigator.share({ title: "TradeOS receipt", text: `Receipt ${success.reference} · ${formatMoney(success.totalMinor, currencyCode)}` }).catch(() => undefined);
                }
              }}>Share receipt</Button>
              <Button type="button" onClick={() => { setSuccess(null); setAmountTendered(""); onClose(); }}>New sale</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
