"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconClose,
  IconCreditCard,
  IconCashbook,
  IconShield,
  IconSmartphone,
  IconWallet,
} from "../ui/icons";
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
  /** Client-computed via the /v1/money-account-defaults join — the API never sends this. */
  isDefault: boolean;
  currencyCode: string;
  updatedAt: string;
}

interface MoneyAccountSheetProps {
  account: MoneyAccount | null;
  onClose: () => void;
}

function methodIconSvg(method: MoneyAccount["method"]): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 18, height: 18 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 18, height: 18 }} />;
    case "BANK": return <IconWallet style={{ width: 18, height: 18 }} />;
    case "CARD": return <IconCreditCard style={{ width: 18, height: 18 }} />;
    default: return <IconCashbook style={{ width: 18, height: 18 }} />;
  }
}

function methodLabel(method: MoneyAccount["method"]): string {
  switch (method) {
    case "CASH": return "Cash";
    case "MOMO": return "Mobile money";
    case "BANK": return "Bank";
    case "CARD": return "Card";
    default: return "Other";
  }
}

function kindLabel(kind: MoneyAccount["kind"]): string {
  switch (kind) {
    case "CASH_DRAWER": return "Cash drawer";
    case "MOMO_WALLET": return "MoMo wallet";
    case "BANK_ACCOUNT": return "Bank account";
    case "CARD_CLEARING": return "Card clearing";
    default: return "Other";
  }
}

export function MoneyAccountSheet({ account, onClose }: MoneyAccountSheetProps) {
  useEffect(() => {
    if (!account) return;
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => { if (typeof document !== "undefined") document.body.style.overflow = ""; };
  }, [account]);

  if (!account) return null;

  const balanceCls = account.balanceMinor < 0
    ? "tos-account-sheet-hero__balance tos-account-sheet-hero__balance--negative"
    : account.balanceMinor > 0
      ? "tos-account-sheet-hero__balance tos-account-sheet-hero__balance--positive"
      : "tos-account-sheet-hero__balance";

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Money account detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Treasury · {methodLabel(account.method)}</span>
            <h2 className="tos-sheet__title">{account.name}</h2>
            <p className="tos-sheet__sub">{kindLabel(account.kind)}{account.isDefault ? " · Default for this method" : ""}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <div className="tos-sheet__body">
          {/* Account hero — gold-tinted card with prominent balance */}
          <div className="tos-account-sheet-hero tos-animate-fade-in-up">
            <div className="tos-account-sheet-hero__head">
              <div className="tos-account-sheet-hero__head-main">
                <span className="tos-account-sheet-hero__eyebrow">{account.active ? "Active account" : "Inactive account"}</span>
                <h3 className="tos-account-sheet-hero__name">{account.name}</h3>
                <p className="tos-account-sheet-hero__sub">{methodLabel(account.method)} · {kindLabel(account.kind)}</p>
              </div>
              <span className={`tos-badge ${account.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                <span className="tos-badge__dot" />{account.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="tos-account-sheet-hero__balance-row">
              <span className="tos-account-sheet-hero__balance-label">Current balance</span>
              <MoneyValue minor={account.balanceMinor} currencyCode={account.currencyCode} className={balanceCls} />
            </div>
            <p className="tos-account-sheet-hero__hint">
              {account.isDefault
                ? "This is the default account for its payment method on this branch — sales and expenses that select the method without a specific account will post here."
                : "Balances are server-authoritative — derived from the immutable cashbook ledger of sales, purchases, expenses, transfers, reconciliations and adjustments."}
            </p>
          </div>

          {/* Account meta — icon + label + value rows */}
          <div className="tos-section tos-animate-fade-in-up" style={{ marginTop: "var(--tos-space-4)" }}>
            <div className="tos-section__head">
              <h3 className="tos-section__title">Account details</h3>
              <span className="tos-section__sub">Server-authoritative</span>
            </div>
            <div className="tos-section__body">
              <div className="tos-account-meta-row">
                <span className="tos-account-meta-row__icon" aria-hidden="true">
                  {methodIconSvg(account.method)}
                </span>
                <div className="tos-account-meta-row__body">
                  <span className="tos-account-meta-row__label">Payment method</span>
                  <span className="tos-account-meta-row__value">{methodLabel(account.method)}</span>
                </div>
              </div>
              <div className="tos-account-meta-row">
                <span className="tos-account-meta-row__icon" aria-hidden="true">
                  <IconWallet style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-account-meta-row__body">
                  <span className="tos-account-meta-row__label">Provider</span>
                  {account.provider
                    ? <span className="tos-account-meta-row__value">{account.provider}</span>
                    : <span className="tos-account-meta-row__value tos-account-meta-row__value--muted">No provider on file</span>}
                </div>
              </div>
              <div className="tos-account-meta-row">
                <span className="tos-account-meta-row__icon" aria-hidden="true">
                  <IconCashbook style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-account-meta-row__body">
                  <span className="tos-account-meta-row__label">Reference label</span>
                  {account.referenceLabel
                    ? <span className="tos-account-meta-row__value tos-account-meta-row__value--mono">{account.referenceLabel}</span>
                    : <span className="tos-account-meta-row__value tos-account-meta-row__value--muted">No reference on file</span>}
                </div>
              </div>
              <div className="tos-account-meta-row">
                <span className="tos-account-meta-row__icon" aria-hidden="true">
                  <IconShield style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-account-meta-row__body">
                  <span className="tos-account-meta-row__label">Default for method</span>
                  <span className="tos-account-meta-row__value">{account.isDefault ? "Yes — sales and expenses post here by default" : "No"}</span>
                </div>
              </div>
              <div className="tos-account-meta-row">
                <span className="tos-account-meta-row__icon" aria-hidden="true">
                  <IconWallet style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-account-meta-row__body">
                  <span className="tos-account-meta-row__label">Currency</span>
                  <span className="tos-account-meta-row__value">{account.currencyCode}</span>
                </div>
              </div>
            </div>
            <div className="tos-section__foot">
              <span className="tos-callout tos-callout--info" style={{ flex: "1 1 auto" }}>
                <span className="tos-callout__icon-wrap" aria-hidden="true"><IconShield style={{ width: 16, height: 16 }} /></span>
                <span className="tos-callout__body">
                  Balances are computed server-side from the cashbook ledger.
                  <span className="tos-callout__sub"> Use Treasury actions (transfer, adjust, reconcile) on the Cashbook screen to move money in or out of this account. Each movement posts as immutable business evidence.</span>
                </span>
              </span>
            </div>
          </div>
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
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
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
            <p className="tos-sheet__sub">Cash drawers, MoMo wallets, bank accounts and card clearing — one ledger entry per account.</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true"><IconWallet style={{ width: 16, height: 16 }} /></span>
            <span className="tos-callout__body">
              New accounts open with a zero balance.
              <span className="tos-callout__sub"> Use the Adjust action with reason OPENING_BALANCE to set the starting balance after creating the account. The opening balance is recorded as immutable server-authoritative evidence.</span>
            </span>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="ma-name">Account name<span className="tos-field__label-required">*</span></label>
            <input id="ma-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} disabled={!canWrite} placeholder="e.g. Main till, MTN MoMo, Stanbic operating" />
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
            <input id="ma-provider" className="tos-input" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={!canWrite} placeholder="Provider name" />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="ma-ref">Reference label (e.g. account number)</label>
            <input id="ma-ref" className="tos-input" value={referenceLabel} onChange={(e) => setReferenceLabel(e.target.value)} disabled={!canWrite} placeholder="Account number, wallet number, last 4 digits" />
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
