"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildSupplierUpdatePayload,
  buildSupplierPaymentPayload,
  SUPPLIER_UPDATE_TYPE,
  SUPPLIER_PAYMENT_CREATE_TYPE,
  SUPPLIER_WRITE_ROLES,
  SUPPLIER_PAYMENT_ROLES,
  roleCan,
  type PaymentMethod,
  type WorkspaceRole,
} from "../../../lib/mutation-builders";

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTermsDays: number | null;
  active: boolean;
  balanceMinor: number;
  updatedAt: string;
}

interface SupplierSheetProps {
  supplier: Supplier | null;
  onClose: () => void;
  /** Called after a SUPPLIER_UPDATE or SUPPLIER_PAYMENT_CREATE enqueues successfully. */
  onMutated?: () => void;
}

const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

export function SupplierSheet({ supplier, onClose, onMutated }: SupplierSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    setEditOpen(false);
    setPaymentOpen(false);
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => { if (typeof document !== "undefined") document.body.style.overflow = ""; };
  }, [supplier]);

  if (!supplier) return null;

  const canWrite = roleCan(role as WorkspaceRole, SUPPLIER_WRITE_ROLES);
  const canPay = roleCan(role as WorkspaceRole, SUPPLIER_PAYMENT_ROLES);
  const currencyCode = session?.currencyCode ?? "GHS";

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Supplier detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Supplier</span>
            <h2 className="tos-sheet__title">{supplier.name}</h2>
            <p className="tos-sheet__sub">{supplier.active ? "Active" : "Inactive"}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <div className="tos-sheet__body">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Phone</dt><dd className="tos-kv__val">{supplier.phone ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Email</dt><dd className="tos-kv__val">{supplier.email ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Address</dt><dd className="tos-kv__val">{supplier.address ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Payment terms</dt><dd className="tos-kv__val">{supplier.paymentTermsDays !== null ? `${supplier.paymentTermsDays} days` : "—"}</dd></div>
            <div><dt className="tos-kv__key">Balance owed</dt><dd className="tos-kv__val">{supplier.balanceMinor > 0 ? <MoneyValue minor={supplier.balanceMinor} currencyCode={currencyCode} tone="negative" /> : <span className="tos-money-value tos-money-value--muted">—</span>}</dd></div>
          </dl>

          {editOpen && session ? (
            <SupplierEditForm
              supplier={supplier}
              onCancel={() => setEditOpen(false)}
              onSubmit={async (payload) => {
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  mutationType: SUPPLIER_UPDATE_TYPE,
                  payload,
                });
                await queue.enqueue(mutation);
                await queue.flush({
                  activeBusinessId: session.businessId,
                  online: typeof navigator !== "undefined" ? navigator.onLine : true,
                });
                bump();
                onMutated?.();
                setEditOpen(false);
              }}
            />
          ) : null}

          {paymentOpen && session ? (
            <SupplierPaymentForm
              supplier={supplier}
              currencyCode={currencyCode}
              onCancel={() => setPaymentOpen(false)}
              onSubmit={async (payload) => {
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  branchId: session.branchId,
                  mutationType: SUPPLIER_PAYMENT_CREATE_TYPE,
                  payload,
                });
                await queue.enqueue(mutation);
                await queue.flush({
                  activeBusinessId: session.businessId,
                  online: typeof navigator !== "undefined" ? navigator.onLine : true,
                });
                bump();
                onMutated?.();
                setPaymentOpen(false);
              }}
            />
          ) : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {canWrite ? (
            <Button variant="outline" onClick={() => { setEditOpen((v) => !v); setPaymentOpen(false); }} disabled={editOpen}>
              {editOpen ? "Editing…" : "Edit"}
            </Button>
          ) : null}
          {canPay ? (
            <Button variant="gold" onClick={() => { setPaymentOpen((v) => !v); setEditOpen(false); }} disabled={paymentOpen || supplier.balanceMinor <= 0}>
              {paymentOpen ? "Recording…" : "Record payment"}
            </Button>
          ) : null}
          {!canWrite && !canPay ? <span className="tos-section__sub">View-only role.</span> : null}
        </div>
      </div>
    </>
  );
}

// --- SUPPLIER_UPDATE form ------------------------------------------------

interface SupplierEditFormProps {
  supplier: Supplier;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function SupplierEditForm({ supplier, onCancel, onSubmit }: SupplierEditFormProps) {
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [email, setEmail] = useState(supplier.email ?? "");
  const [address, setAddress] = useState(supplier.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildSupplierUpdatePayload({
        supplierId: supplier.id,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        expectedUpdatedAt: supplier.updatedAt,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update supplier.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit} style={{ marginTop: "var(--tos-space-3)" }}>
      <div className="tos-callout tos-callout--info">
        Payment terms and active status can only be changed via an online server check. They are not part of this offline-queued update.
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-edit-name">Name<span className="tos-field__label-required">*</span></label>
        <input id="sup-edit-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={180} />
      </div>
      <div className="tos-public__form-row">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="sup-edit-phone">Phone</label>
          <input id="sup-edit-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="sup-edit-email">Email</label>
          <input id="sup-edit-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-edit-addr">Address</label>
        <textarea id="sup-edit-addr" className="tos-textarea" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row tos-row--between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Save changes</Button>
      </div>
    </form>
  );
}

// --- SUPPLIER_PAYMENT_CREATE form ---------------------------------------

interface SupplierPaymentFormProps {
  supplier: Supplier;
  currencyCode: string;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function SupplierPaymentForm({ supplier, currencyCode, onCancel, onSubmit }: SupplierPaymentFormProps) {
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [providerReference, setProviderReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountMinor === null || amountMinor <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildSupplierPaymentPayload({
        supplierId: supplier.id,
        amountMinor,
        method,
        providerReference: providerReference.trim() || null,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit} style={{ marginTop: "var(--tos-space-3)" }}>
      <div className="tos-callout tos-callout--info">
        The server validates the payment does not exceed the supplier's outstanding payable. The new balance is computed server-side.
      </div>
      <MoneyInput currencyCode={currencyCode} valueMinor={amountMinor} onChange={setAmountMinor} label="Amount paid" size="lg" required />
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-pay-method">Method</label>
        <select id="sup-pay-method" className="tos-select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-pay-ref">Provider reference (optional)</label>
        <input id="sup-pay-ref" className="tos-input" value={providerReference} onChange={(e) => setProviderReference(e.target.value)} placeholder="e.g. cheque number, MoMo ref" />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row tos-row--between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={amountMinor === null || amountMinor <= 0}>Record payment</Button>
      </div>
    </form>
  );
}

interface SupplierFormSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function SupplierFormSheet({ open, onClose, onCreated }: SupplierFormSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(""); setPhone(""); setEmail(""); setAddress(""); setTerms(""); setBusy(false); setError(null); }
  }, [open]);

  if (!open || !session) return null;
  const canWrite = roleCan(role as WorkspaceRole, SUPPLIER_WRITE_ROLES);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { name: name.trim() };
      if (phone.trim()) payload.phone = phone.trim();
      if (email.trim()) payload.email = email.trim();
      if (address.trim()) payload.address = address.trim();
      if (terms.trim()) payload.paymentTermsDays = Number(terms);
      const mutation = queue.build({ businessId: session.businessId, mutationType: "SUPPLIER_CREATE", payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump(); onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create supplier.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Add supplier">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Master data</span>
            <h2 className="tos-sheet__title">Add supplier</h2>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="sup-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="sup-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} disabled={!canWrite} />
          </div>
          <div className="tos-public__form-row">
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="sup-phone">Phone</label>
              <input id="sup-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canWrite} />
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="sup-email">Email</label>
              <input id="sup-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canWrite} />
            </div>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="sup-addr">Address</label>
            <textarea id="sup-addr" className="tos-textarea" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canWrite} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="sup-terms">Payment terms (days)</label>
            <input id="sup-terms" type="number" min={0} className="tos-input" value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!canWrite} />
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || !canWrite}>
            {canWrite ? "Create supplier" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
