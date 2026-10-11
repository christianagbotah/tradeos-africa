"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import type { Customer } from "../workspace/workspace-provider";
import { getOfflineQueue } from "../../../lib/offline-sync";

interface CustomerSheetProps {
  customer: Customer | null;
  onClose: () => void;
}

export function CustomerSheet({ customer, onClose }: CustomerSheetProps) {
  useEffect(() => {
    if (!customer) return;
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => {
      if (typeof document !== "undefined") document.body.style.overflow = "";
    };
  }, [customer]);

  if (!customer) return null;
  const currency = "GHS"; // customer balance currency not in the read model; use a stable default

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Customer detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Customer</span>
            <h2 className="tos-sheet__title">{customer.name}</h2>
            <p className="tos-sheet__sub">{customer.active ? "Active" : "Inactive"}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close customer detail">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="tos-sheet__body">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Phone</dt><dd className="tos-kv__val">{customer.phone ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Email</dt><dd className="tos-kv__val">{customer.email ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Credit limit</dt><dd className="tos-kv__val">{customer.creditLimitMinor !== null ? <MoneyValue minor={customer.creditLimitMinor} currencyCode={currency} tone="muted" /> : "—"}</dd></div>
            <div><dt className="tos-kv__key">Credit terms</dt><dd className="tos-kv__val">{customer.creditTermsDays !== null ? `${customer.creditTermsDays} days` : "—"}</dd></div>
            <div><dt className="tos-kv__key">Outstanding balance</dt><dd className="tos-kv__val"><MoneyValue minor={customer.balanceMinor} currencyCode={currency} tone={customer.balanceMinor > 0 ? "negative" : "positive"} /></dd></div>
            <div><dt className="tos-kv__key">Updated</dt><dd className="tos-kv__val">{new Date(customer.updatedAt).toLocaleString()}</dd></div>
          </dl>
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </>
  );
}

interface CustomerFormSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CustomerFormSheet({ open, onClose, onCreated }: CustomerFormSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(""); setPhone(""); setEmail(""); setBusy(false); setError(null);
    }
  }, [open]);

  if (!open || !session) return null;

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "SALES", "STAFF"].includes(role);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { name: name.trim() };
      if (phone.trim()) payload.phone = phone.trim();
      if (email.trim()) payload.email = email.trim();
      const mutation = queue.build({
        businessId: session.businessId,
        mutationType: "CUSTOMER_CREATE",
        payload,
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create customer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Add customer">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Master data</span>
            <h2 className="tos-sheet__title">Add customer</h2>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cust-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="cust-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cust-phone">Phone</label>
            <input id="cust-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cust-email">Email</label>
            <input id="cust-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || !canWrite}>
            {canWrite ? "Create customer" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}

