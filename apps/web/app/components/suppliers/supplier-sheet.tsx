"use client";

import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { formatMoney, parseMoneyInput } from "@tradeos/contracts";
import { ClientApiError, clientApi, messageFrom } from "../../lib/client-api";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import { MasterDataActions, masterDataLifecycleMessage } from "../business/master-data-actions";
import { supplierCapabilities, type Supplier, type SupplierDetail } from "./supplier-types";

export type SupplierSheetMode = "create" | "edit" | "view";
export type SupplierDraft = {
  supplierId: string | null;
  expectedUpdatedAt: string | null;
  name: string;
  phone: string;
  email: string;
  address: string;
  paymentTermsDays: string;
};

type Props = {
  mode: SupplierSheetMode;
  supplier: Supplier | null;
  detail: SupplierDetail | null;
  open: boolean;
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

export function supplierDraftFor(mode: SupplierSheetMode, supplier: Supplier | null): SupplierDraft {
  if (!supplier || mode === "create") {
    return {
      supplierId: null,
      expectedUpdatedAt: null,
      name: "",
      phone: "",
      email: "",
      address: "",
      paymentTermsDays: "0",
    };
  }
  return {
    supplierId: supplier.id,
    expectedUpdatedAt: supplier.updatedAt,
    name: supplier.name,
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    paymentTermsDays: String(supplier.paymentTermsDays),
  };
}

export function supplierSheetMessage(code: string | null | undefined, fallback = "Supplier change could not be saved."): string {
  if (code === "OFFLINE_STATUS_CHANGE") return "Archive and reactivate actions require an online connection so TradeOS can verify the latest supplier status.";
  if (code === "SUPPLIER_TERMS_FORBIDDEN") return "Your role cannot change supplier payment terms.";
  return masterDataLifecycleMessage(code, "supplier", fallback);
}

export function SupplierSheet({ mode, supplier, detail, open, businessId, branchId, currencyCode, role, onClose, onChanged }: Props) {
  const capabilities = supplierCapabilities(role);
  const readOnly = mode === "view" || !capabilities.canEdit;
  const [draft, setDraft] = useState<SupplierDraft>(() => supplierDraftFor(mode, supplier));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [payment, setPayment] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("BANK");
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(supplierDraftFor(mode, supplier));
    setMessage(null);
    setPayment("");
  }, [mode, open, supplier]);

  useEffect(() => {
    if (!open) return;
    previousActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const current = detail?.supplier ?? supplier;
  const title = mode === "create" ? "Add supplier" : current?.name ?? "Supplier";
  const openObligations = detail?.obligations.filter((item) => item.openMinor > 0) ?? [];

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || busy || !draft.name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const profile = {
        name: draft.name.trim(),
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        address: draft.address.trim() || null,
      };
      if (!navigator.onLine) {
        if (mode === "create") {
          enqueueMutation({
            clientId: getOrCreateClientId(),
            clientMutationId: crypto.randomUUID(),
            businessId,
            mutationType: "SUPPLIER_CREATE",
            occurredAt: new Date().toISOString(),
            payload: profile,
          });
        } else if (current && draft.expectedUpdatedAt) {
          enqueueMutation({
            clientId: getOrCreateClientId(),
            clientMutationId: crypto.randomUUID(),
            businessId,
            mutationType: "SUPPLIER_UPDATE",
            occurredAt: new Date().toISOString(),
            payload: { supplierId: current.id, expectedUpdatedAt: draft.expectedUpdatedAt, ...profile },
          });
        }
        setMessage(capabilities.canManageTerms && Number(draft.paymentTermsDays || 0) !== (current?.paymentTermsDays ?? 0)
          ? "Supplier profile saved offline · pending sync. Payment terms were not queued and must be confirmed online."
          : "Supplier profile saved offline · pending sync.");
        return;
      }
      const payload = {
        businessId,
        ...profile,
        ...(capabilities.canManageTerms ? { paymentTermsDays: Number(draft.paymentTermsDays || 0) } : {}),
      };
      if (mode === "create") {
        await clientApi("/api/tradeos/v1/suppliers", { method: "POST", body: JSON.stringify(payload) });
      } else if (current && draft.expectedUpdatedAt) {
        await clientApi(`/api/tradeos/v1/suppliers/${current.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, expectedUpdatedAt: draft.expectedUpdatedAt }),
        });
      }
      await onChanged();
      onClose();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(supplierSheetMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!current || !capabilities.canChangeStatus || busy || !draft.expectedUpdatedAt) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!navigator.onLine) {
        setMessage(supplierSheetMessage("OFFLINE_STATUS_CHANGE"));
        return;
      }
      await clientApi(`/api/tradeos/v1/suppliers/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, active: !current.active }),
      });
      await onChanged();
      onClose();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(supplierSheetMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  const paySupplier = async (event: FormEvent) => {
    event.preventDefault();
    if (!current || !capabilities.canPay || busy) return;
    const amountMinor = parseMoneyInput(payment, currencyCode) ?? -1;
    if (amountMinor <= 0 || amountMinor > current.balanceMinor) {
      setMessage("Enter a payment within the supplier payable balance.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        businessId,
        branchId,
        mutationType: "SUPPLIER_PAYMENT_CREATE",
        occurredAt: new Date().toISOString(),
        payload: { supplierId: current.id, amountMinor, method: paymentMethod },
      });
      setPayment("");
      if (!navigator.onLine) {
        setMessage("Supplier payment saved offline. It will post when this device reconnects.");
        return;
      }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) {
        setMessage("Supplier payment needs review before it can post.");
        return;
      }
      if (summary.received > 0 || summary.applied === 0) {
        setMessage("Supplier payment is saved locally and still pending synchronization.");
        return;
      }
      await onChanged();
      onClose();
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="supplier-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="supplier-sheet" role="dialog" aria-modal="true" aria-labelledby="supplier-sheet-title">
        <header className="supplier-sheet-header">
          <div>
            <span>Supplier management</span>
            <h2 id="supplier-sheet-title">{title}</h2>
            {current ? <small className={current.active ? "supplier-status supplier-status--active" : "supplier-status"}>{current.active ? "Active" : "Inactive"}</small> : null}
          </div>
          <button className="supplier-sheet-close" type="button" aria-label="Close supplier" onClick={onClose}>×</button>
        </header>

        <div className="supplier-sheet-scroll">
          <form className="supplier-sheet-section" onSubmit={(event) => void saveDetails(event)}>
            <div className="supplier-section-heading">
              <div><strong>Details</strong><span>Identity and contact information used for future purchases</span></div>
            </div>
            <div className="supplier-field-grid">
              <label>Name<input ref={firstInputRef} required disabled={readOnly} value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /></label>
              <label>Phone<input disabled={readOnly} value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} placeholder="Optional" /></label>
              <label>Email<input type="email" disabled={readOnly} value={draft.email} onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))} placeholder="Optional" /></label>
              <label>Address<input disabled={readOnly} value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} placeholder="Optional" /></label>
            </div>

            {capabilities.canManageTerms ? (
              <div className="supplier-subsection">
                <div className="supplier-section-heading"><div><strong>Payment terms</strong><span>Applied only to new supplier-credit purchases</span></div></div>
                <label className="supplier-terms-field">Net days<input inputMode="numeric" min="0" max="3650" disabled={readOnly} value={draft.paymentTermsDays} onChange={(event) => setDraft((value) => ({ ...value, paymentTermsDays: event.target.value.replace(/\D/g, "") }))} /></label>
              </div>
            ) : null}

            {!readOnly ? <div className="supplier-section-actions"><Button type="submit" disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : mode === "create" ? "Save supplier" : "Save changes"}</Button></div> : null}
          </form>

          {current ? (
            <section className="supplier-sheet-section">
              <div className="supplier-section-heading"><div><strong>Payables &amp; history</strong><span>Historical purchases and settlement remain available even when a supplier is inactive</span></div></div>
              <div className="supplier-metrics">
                <div><span>Current payable</span><strong>{formatMoney(Math.max(0, current.balanceMinor), currencyCode)}</strong></div>
                <div><span>Open payables</span><strong>{openObligations.length}</strong></div>
                <div><span>Terms</span><strong>Net {current.paymentTermsDays} day{current.paymentTermsDays === 1 ? "" : "s"}</strong></div>
              </div>

              <div className="supplier-history-block">
                <div className="supplier-history-heading"><strong>Open payables</strong><span>Due dates stay tied to each posted purchase</span></div>
                {openObligations.length === 0 ? <p className="supplier-empty">No open supplier-credit obligations.</p> : openObligations.map((item) => (
                  <div className="supplier-history-row" key={item.id}>
                    <div><strong>{Date.parse(item.dueAt) < Date.now() ? "Overdue" : "Due"} {formatDate(item.dueAt)}</strong><span>Purchase {item.purchaseId.slice(0, 8)} · original {formatMoney(item.originalMinor, currencyCode)}</span></div>
                    <strong>{formatMoney(item.openMinor, currencyCode)}</strong>
                  </div>
                ))}
              </div>

              <div className="supplier-history-block">
                <div className="supplier-history-heading"><strong>Payable ledger</strong><span>Posted history is never rewritten by profile changes</span></div>
                {!detail || detail.ledger.length === 0 ? <p className="supplier-empty">No payable ledger entries yet.</p> : detail.ledger.map((entry) => (
                  <div className="supplier-history-row" key={entry.id}>
                    <div><strong>{entry.sourceType.replaceAll("_", " ")}</strong><span>{formatDate(entry.occurredAt)} · {entry.method.replaceAll("_", " ")}</span></div>
                    <strong>{entry.balanceDeltaMinor > 0 ? "+" : "−"}{formatMoney(Math.abs(entry.balanceDeltaMinor), entry.currencyCode)}</strong>
                  </div>
                ))}
              </div>

              {capabilities.canPay && current.balanceMinor > 0 ? (
                <form className="supplier-payment" onSubmit={(event) => void paySupplier(event)}>
                  <div><strong>Pay supplier</strong><span>Settles existing payable history; inactive status does not block settlement.</span></div>
                  <label>Amount<input inputMode="decimal" value={payment} onChange={(event) => setPayment(event.target.value)} placeholder="0.00" /></label>
                  <label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{["CASH", "MOMO", "CARD", "BANK", "OTHER"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                  <Button type="submit" disabled={busy || (parseMoneyInput(payment, currencyCode) ?? -1) <= 0}>Pay supplier</Button>
                </form>
              ) : null}
            </section>
          ) : null}

          {current && capabilities.canChangeStatus ? (
            <section className="supplier-sheet-section supplier-status-section">
              <div className="supplier-section-heading"><div><strong>Status</strong><span>{current.active ? "Archive to prevent new purchase receiving while preserving history." : "Reactivate to make this supplier available for new receiving again."}</span></div></div>
              <MasterDataActions entityLabel="supplier" active={current.active} canChangeStatus={capabilities.canChangeStatus} busy={busy} onToggleStatus={toggleStatus} />
            </section>
          ) : null}

          {message ? <div className="supplier-sheet-message" role="status">{message}</div> : null}
        </div>
      </div>
    </div>
  );
}


function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
