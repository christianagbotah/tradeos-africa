"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

export interface MoneyAccount {
  id: string;
  name: string;
  method: "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";
  kind: "CASH_DRAWER" | "MOMO_WALLET" | "BANK_ACCOUNT" | "CARD_CLEARING" | "OTHER";
  provider: string | null;
  referenceLabel: string | null;
  balanceMinor: number;
  active: boolean;
  isDefault: boolean;
  currencyCode: string;
  updatedAt: string;
}

interface MoneyAccountSheetProps {
  account: MoneyAccount | null;
  onClose: () => void;
}

export function MoneyAccountSheet({ account, onClose }: MoneyAccountSheetProps) {
  useEffect(() => {
    if (!account) return;
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => { if (typeof document !== "undefined") document.body.style.overflow = ""; };
  }, [account]);

  if (!account) return null;
  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Money account detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Treasury · {account.method}</span>
            <h2 className="tos-sheet__title">{account.name}</h2>
            <p className="tos-sheet__sub">{account.kind}{account.isDefault ? " · Default" : ""}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <div className="tos-sheet__body">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Provider</dt><dd className="tos-kv__val">{account.provider ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Reference</dt><dd className="tos-kv__val">{account.referenceLabel ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Currency</dt><dd className="tos-kv__val">{account.currencyCode}</dd></div>
            <div><dt className="tos-kv__key">Balance</dt><dd className="tos-kv__val"><MoneyValue minor={account.balanceMinor} currencyCode={account.currencyCode} tone={account.balanceMinor < 0 ? "negative" : "default"} /></dd></div>
            <div><dt className="tos-kv__key">Status</dt><dd className="tos-kv__val">{account.active ? "Active" : "Inactive"}</dd></div>
          </dl>
        </div>
        <div className="tos-sheet__foot"><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </div>
    </>
  );
}

interface MoneyAccountFormSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function MoneyAccountFormSheet({ open, onClose, onCreated }: MoneyAccountFormSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [name, setName] = useState("");
  const [method, setMethod] = useState<MoneyAccount["method"]>("CASH");
  const [kind, setKind] = useState<MoneyAccount["kind"]>("CASH_DRAWER");
  const [provider, setProvider] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(""); setMethod("CASH"); setKind("CASH_DRAWER"); setProvider(""); setReferenceLabel(""); setBusy(false); setError(null); }
  }, [open]);

  if (!open || !session) return null;
  const canWrite = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"].includes(role);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { name: name.trim(), method, kind };
      if (provider.trim()) payload.provider = provider.trim();
      if (referenceLabel.trim()) payload.referenceLabel = referenceLabel.trim();
      const mutation = queue.build({ businessId: session.businessId, mutationType: "MONEY_ACCOUNT_CREATE", payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump(); onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Add money account">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Treasury</span>
            <h2 className="tos-sheet__title">Add money account</h2>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="ma-name">Account name<span className="tos-field__label-required">*</span></label>
            <input id="ma-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} disabled={!canWrite} />
          </div>
          <div className="tos-public__form-row">
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="ma-method">Method</label>
              <select id="ma-method" className="tos-select" value={method} onChange={(e) => setMethod(e.target.value as MoneyAccount["method"])} disabled={!canWrite}>
                <option value="CASH">Cash</option>
                <option value="MOMO">Mobile money</option>
                <option value="CARD">Card</option>
                <option value="BANK">Bank</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="ma-kind">Kind</label>
              <select id="ma-kind" className="tos-select" value={kind} onChange={(e) => setKind(e.target.value as MoneyAccount["kind"])} disabled={!canWrite}>
                <option value="CASH_DRAWER">Cash drawer</option>
                <option value="MOMO_WALLET">MoMo wallet</option>
                <option value="BANK_ACCOUNT">Bank account</option>
                <option value="CARD_CLEARING">Card clearing</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="ma-provider">Provider (e.g. MTN, Stanbic)</label>
            <input id="ma-provider" className="tos-input" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={!canWrite} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="ma-ref">Reference label (e.g. account number)</label>
            <input id="ma-ref" className="tos-input" value={referenceLabel} onChange={(e) => setReferenceLabel(e.target.value)} disabled={!canWrite} />
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || !canWrite}>
            {canWrite ? "Create account" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
