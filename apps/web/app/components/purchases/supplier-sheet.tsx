"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

// Placeholder import — will fix below

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
}

export function SupplierSheet({ supplier, onClose }: SupplierSheetProps) {
  useEffect(() => {
    if (!supplier) return;
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => { if (typeof document !== "undefined") document.body.style.overflow = ""; };
  }, [supplier]);

  if (!supplier) return null;
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
            <div><dt className="tos-kv__key">Balance owed</dt><dd className="tos-kv__val">{supplier.balanceMinor > 0 ? supplier.balanceMinor : "—"}</dd></div>
          </dl>
        </div>
        <div className="tos-sheet__foot"><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
    </>
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
  const canWrite = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "INVENTORY"].includes(role);

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
