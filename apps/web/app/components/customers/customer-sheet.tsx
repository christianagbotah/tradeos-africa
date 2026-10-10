"use client";

import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { formatMoneyInput } from "@tradeos/contracts";
import { ClientApiError, clientApi, messageFrom } from "../../lib/client-api";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import { MasterDataActions, masterDataLifecycleMessage } from "../business/master-data-actions";
import {
  customerMoneyToMinor,
  formatCustomerDate,
  formatCustomerMoney,
  type CustomerDetail,
  type LedgerEntry,
  type PaymentMethod,
} from "./customer-types";

export type CustomerSheetMode = "create" | "edit" | "view";
export type CustomerDraft = {
  expectedUpdatedAt: string | null;
  name: string;
  phone: string;
  email: string;
  creditLimit: string;
  creditTermsDays: string;
};

type Props = {
  mode: CustomerSheetMode;
  detail: CustomerDetail | null;
  open: boolean;
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

const profileWriteRoles = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"]);
const creditControlRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const customerPaymentRoles = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"]);

export function customerDraftFor(mode: CustomerSheetMode, detail: CustomerDetail | null, currencyCode: string): CustomerDraft {
  if (mode === "create" || !detail) {
    return { expectedUpdatedAt: null, name: "", phone: "", email: "", creditLimit: "", creditTermsDays: "0" };
  }
  const customer = detail.customer;
  return {
    expectedUpdatedAt: customer.updatedAt,
    name: customer.name,
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    creditLimit: customer.creditLimitMinor === null ? "" : formatMoneyInput(customer.creditLimitMinor, currencyCode) ?? "",
    creditTermsDays: String(customer.creditTermsDays),
  };
}

export function customerSheetMessage(code: string | null | undefined, fallback = "Customer change could not be saved."): string {
  if (code === "OFFLINE_CREDIT_CONTROL") return "Credit settings and customer status require an online connection so TradeOS can verify the latest account state.";
  return masterDataLifecycleMessage(code, "customer", fallback);
}

export function CustomerSheet({ mode, detail, open, businessId, branchId, currencyCode, role, onClose, onSaved }: Props) {
  const customer = detail?.customer ?? null;
  const [draft, setDraft] = useState<CustomerDraft>(() => customerDraftFor(mode, detail, currencyCode));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [payment, setPayment] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [providerReference, setProviderReference] = useState("");
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previous_active_element = useRef<HTMLElement | null>(null);
  const canEditProfile = mode !== "view" && profileWriteRoles.has(role);
  const canSetCredit = mode !== "view" && creditControlRoles.has(role);
  const canControlCredit = mode === "edit" && canSetCredit;
  const canReceivePayment = mode === "edit" && customerPaymentRoles.has(role) && Boolean(customer?.active);

  useEffect(() => {
    if (!open) return;
    setDraft(customerDraftFor(mode, detail, currencyCode));
    setPayment("");
    setProviderReference("");
    setMessage(null);
  }, [currencyCode, detail, mode, open]);

  useEffect(() => {
    if (!open) return;
    previous_active_element.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstInputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previous_active_element.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditProfile || busy || !draft.name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const profile = { name: draft.name.trim(), phone: draft.phone.trim() || null, email: draft.email.trim() || null };
      if (mode === "create") {
        if (!navigator.onLine) {
          enqueueMutation({
            clientId: getOrCreateClientId(),
            clientMutationId: crypto.randomUUID(),
            businessId,
            mutationType: "CUSTOMER_CREATE",
            occurredAt: new Date().toISOString(),
            payload: profile,
          });
          setMessage(canSetCredit && (draft.creditLimit.trim() || Number(draft.creditTermsDays || 0) > 0)
            ? "Customer profile saved offline · pending sync. Credit settings were not queued and must be confirmed online after the customer synchronizes."
            : "Customer profile saved offline · pending sync.");
          return;
        }
        await clientApi("/api/tradeos/v1/customers", {
          method: "POST",
          body: JSON.stringify({
            businessId,
            ...profile,
            ...(canSetCredit ? {
              creditLimitMinor: draft.creditLimit.trim() ? customerMoneyToMinor(draft.creditLimit, currencyCode) : null,
              creditTermsDays: Number(draft.creditTermsDays || 0),
            } : {}),
          }),
        });
        await onSaved();
        onClose();
        return;
      }
      if (!customer || !draft.expectedUpdatedAt) return;
      if (!navigator.onLine) {
        enqueueMutation({
          clientId: getOrCreateClientId(),
          clientMutationId: crypto.randomUUID(),
          businessId,
          mutationType: "CUSTOMER_UPDATE",
          occurredAt: new Date().toISOString(),
          payload: { customerId: customer.id, expectedUpdatedAt: draft.expectedUpdatedAt, ...profile },
        });
        setMessage("Saved offline · pending sync. The original customer revision is preserved so a newer server edit cannot be overwritten.");
        return;
      }
      await clientApi(`/api/tradeos/v1/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, ...profile }),
      });
      await onSaved();
      onClose();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(customerSheetMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveCredit = async () => {
    if (!customer || !canControlCredit || busy) return;
    if (!navigator.onLine) { setMessage(customerSheetMessage("OFFLINE_CREDIT_CONTROL")); return; }
    setBusy(true); setMessage(null);
    try {
      await clientApi(`/api/tradeos/v1/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          businessId,
          expectedUpdatedAt: draft.expectedUpdatedAt,
          creditLimitMinor: draft.creditLimit.trim() ? customerMoneyToMinor(draft.creditLimit, currencyCode) : null,
          creditTermsDays: Number(draft.creditTermsDays || 0),
        }),
      });
      await onSaved();
      onClose();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(customerSheetMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
    } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    if (!customer || !canControlCredit || busy) return;
    if (!navigator.onLine) { setMessage(customerSheetMessage("OFFLINE_CREDIT_CONTROL")); return; }
    setBusy(true); setMessage(null);
    try {
      await clientApi(`/api/tradeos/v1/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, active: !customer.active }),
      });
      await onSaved();
      onClose();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(customerSheetMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
    } finally { setBusy(false); }
  };

  const recordPayment = async () => {
    if (!customer || !canReceivePayment || busy) return;
    const amountMinor = customerMoneyToMinor(payment, currencyCode);
    if (amountMinor <= 0) return;
    setBusy(true); setMessage(null);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(), clientMutationId: crypto.randomUUID(), businessId, branchId,
        mutationType: "CUSTOMER_PAYMENT_CREATE", occurredAt: new Date().toISOString(),
        payload: { customerId: customer.id, amountMinor, method, ...(providerReference.trim() ? { providerReference: providerReference.trim() } : {}) },
      });
      setPayment(""); setProviderReference("");
      if (!navigator.onLine) {
        setMessage("Customer payment saved offline. It will post to the account when this device reconnects.");
        return;
      }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) setMessage("The payment is saved but needs review before it can post.");
      else if (summary.applied > 0) { setMessage("Customer payment received and account balance updated."); await onSaved(); }
      else setMessage("Customer payment is queued for synchronization.");
    } catch (reason) { setMessage(messageFrom(reason)); }
    finally { setBusy(false); }
  };

  const title = mode === "create" ? "Add customer" : customer?.name ?? "Customer";
  return (
    <div className="customer-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="customer-sheet" role="dialog" aria-modal="true" aria-labelledby="customer-sheet-title">
        <header className="customer-sheet-header">
          <div><span>Customer management</span><h2 id="customer-sheet-title">{title}</h2>{customer ? <p>{customer.phone ?? customer.email ?? "No contact recorded"}</p> : null}</div>
          <div className="customer-sheet-head-actions">
            {customer ? <span className={customer.active ? "customer-status active" : "customer-status"}>{customer.active ? "Active" : "Inactive"}</span> : null}
            <button type="button" className="customer-sheet-close" aria-label="Close customer" onClick={onClose}>×</button>
          </div>
        </header>

        <div className="customer-sheet-scroll">
          <form className="customer-sheet-section" onSubmit={(event) => void saveProfile(event)}>
            <div className="customer-section-heading"><div><strong>Profile</strong><span>Identity and contact details used for future transactions</span></div></div>
            <div className="customer-field-grid">
              <label>Name<input ref={firstInputRef} required disabled={!canEditProfile} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Phone<input disabled={!canEditProfile} value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Optional" /></label>
              <label>Email<input type="email" disabled={!canEditProfile} value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Optional" /></label>
            </div>
            {canEditProfile ? <div className="customer-section-actions"><Button type="submit" disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : mode === "create" ? "Save customer" : "Save profile"}</Button></div> : null}
          </form>

          {mode === "create" && canSetCredit ? <section className="customer-sheet-section">
            <div className="customer-section-heading"><div><strong>Credit &amp; terms</strong><span>Optional pay-later settings for this new customer</span></div></div>
            <div className="customer-field-grid">
              <label>Credit limit ({currencyCode === "GHS" ? "₵" : currencyCode})<input inputMode="decimal" value={draft.creditLimit} onChange={(event) => setDraft((current) => ({ ...current, creditLimit: event.target.value }))} placeholder="Blank disables Pay later" /></label>
              <label>Pay-later terms (days)<input inputMode="numeric" min="0" max="3650" value={draft.creditTermsDays} onChange={(event) => setDraft((current) => ({ ...current, creditTermsDays: event.target.value.replace(/\D/g, "") }))} /></label>
            </div>
            <p className="customer-lifecycle-note">These terms will apply to future pay-later sales after the customer is created.</p>
          </section> : null}

          {customer ? <>
            <section className="customer-sheet-section">
              <div className="customer-section-heading"><div><strong>Account position</strong><span>Live receivable context; posted history is never rewritten</span></div></div>
              <div className="customer-account-metrics">
                <div><span>Balance owed</span><strong>{formatCustomerMoney(customer.balanceMinor, currencyCode)}</strong></div>
                <div><span>Credit limit</span><strong>{customer.creditLimitMinor === null ? "Off" : formatCustomerMoney(customer.creditLimitMinor, currencyCode)}</strong></div>
                <div><span>Available credit</span><strong>{customer.availableCreditMinor === null ? "—" : formatCustomerMoney(customer.availableCreditMinor, currencyCode)}</strong></div>
                <div><span>Terms</span><strong>Net {customer.creditTermsDays} day{customer.creditTermsDays === 1 ? "" : "s"}</strong></div>
              </div>
            </section>

            {canControlCredit ? <section className="customer-sheet-section">
              <div className="customer-section-heading"><div><strong>Credit &amp; terms</strong><span>Server-validated controls for future account activity</span></div></div>
              <div className="customer-field-grid">
                <label>Credit limit ({currencyCode === "GHS" ? "₵" : currencyCode})<input inputMode="decimal" value={draft.creditLimit} onChange={(event) => setDraft((current) => ({ ...current, creditLimit: event.target.value }))} placeholder="Blank disables Pay later" /></label>
                <label>Pay-later terms (days)<input inputMode="numeric" min="0" max="3650" value={draft.creditTermsDays} onChange={(event) => setDraft((current) => ({ ...current, creditTermsDays: event.target.value.replace(/\D/g, "") }))} /></label>
              </div>
              <div className="customer-section-actions split"><Button type="button" variant="secondary" disabled={busy} onClick={() => void saveCredit()}>Update credit settings</Button><MasterDataActions entityLabel="customer" active={customer.active} canChangeStatus busy={busy} onToggleStatus={toggleActive} /></div>
            </section> : null}

            <section className="customer-sheet-section customer-payment-section">
              <div className="customer-section-heading"><div><strong>Receive payment</strong><span>Payments reduce the customer balance without rewriting sales history</span></div></div>
              {!customer.active ? <p className="customer-lifecycle-note">Payments are paused while this customer is inactive. Reactivate the customer before recording new account activity.</p> : canReceivePayment ? <div className="customer-payment-grid">
                <label>Amount<input inputMode="decimal" value={payment} onChange={(event) => setPayment(event.target.value)} placeholder="0.00" /></label>
                <label>Method<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}><option value="CASH">Cash</option><option value="MOMO">MoMo</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label>
                <label>Reference<input value={providerReference} onChange={(event) => setProviderReference(event.target.value)} placeholder="Optional" /></label>
                <Button type="button" disabled={busy || customerMoneyToMinor(payment, currencyCode) <= 0} onClick={() => void recordPayment()}>{busy ? "Saving…" : "Receive payment"}</Button>
              </div> : <p className="customer-lifecycle-note">Your role can view this account history but cannot record customer payments.</p>}
            </section>

            <CustomerFinancialHistory detail={detail!} currencyCode={currencyCode} />
          </> : null}
          {message ? <div className="customer-sheet-message" role="status">{message}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function CustomerFinancialHistory({ detail, currencyCode }: { detail: CustomerDetail; currencyCode: string }) {
  const open = detail.obligations.filter((item) => item.openMinor > 0);
  return <>
    <section className="customer-sheet-section customer-history-section">
      <div className="customer-section-heading"><div><strong>Open credit obligations</strong><span>Due dates are fixed when each pay-later sale posts</span></div></div>
      {open.length === 0 ? <div className="customer-empty">No open credit obligations.</div> : <div className="customer-ledger-list">{open.map((item) => {
        const overdue = Date.parse(item.dueAt) < Date.now();
        return <div className="customer-ledger-row" key={item.id}><div><strong>{overdue ? "Overdue" : "Due"} {formatCustomerDate(item.dueAt)}</strong><span>Original {formatCustomerMoney(item.originalMinor, currencyCode)} · sale {item.saleId.slice(0, 8)}</span></div><strong className={overdue ? "debit" : ""}>{formatCustomerMoney(item.openMinor, currencyCode)}</strong></div>;
      })}</div>}
    </section>
    <section className="customer-sheet-section customer-history-section">
      <div className="customer-section-heading"><div><strong>Account ledger</strong><span>Positive increases debt · negative reduces it</span></div></div>
      {detail.ledger.length === 0 ? <div className="customer-empty">No account entries yet.</div> : <div className="customer-ledger-list">{detail.ledger.map((entry) => <div className="customer-ledger-row" key={entry.id}><div><strong>{ledgerLabel(entry.entryType)}</strong><span>{formatCustomerDate(entry.occurredAt)} · {entry.actorName ?? "Staff"}</span></div><strong className={entry.balanceDeltaMinor > 0 ? "debit" : "credit"}>{entry.balanceDeltaMinor > 0 ? "+" : "−"}{formatCustomerMoney(Math.abs(entry.balanceDeltaMinor), entry.currencyCode)}</strong></div>)}</div>}
    </section>
  </>;
}

function ledgerLabel(type: LedgerEntry["entryType"]): string {
  if (type === "CREDIT_SALE") return "Pay-later sale";
  if (type === "PAYMENT") return "Customer payment";
  if (type === "CREDIT_REFUND") return "Refund / account credit";
  return "Account adjustment";
}
