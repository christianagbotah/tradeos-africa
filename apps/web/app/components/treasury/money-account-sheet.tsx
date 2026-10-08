"use client";

import React, { type FormEvent, useEffect, useRef, useState } from "react";
import { ClientApiError, clientApi, messageFrom } from "../../lib/client-api";
import { Button } from "../ui/button";
import { MasterDataActions, masterDataLifecycleMessage } from "../business/master-data-actions";
import type { MoneyAccount } from "./types";

const adminRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const methods = ["CASH", "MOMO", "CARD", "BANK", "OTHER"] as const;
const kinds: Record<string, string> = {
  CASH: "CASH_DRAWER",
  MOMO: "MOMO_WALLET",
  CARD: "CARD_CLEARING",
  BANK: "BANK_ACCOUNT",
  OTHER: "OTHER",
};

export type MoneyAccountDraft = {
  accountId: string | null;
  expectedUpdatedAt: string | null;
  branchId: string | null;
  name: string;
  method: string;
  kind: string;
  provider: string;
  referenceLabel: string;
  allowNegative: boolean;
  active: boolean;
  businessWide: boolean;
};

type Props = {
  open: boolean;
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  account: MoneyAccount | null;
  onClose: () => void;
  onSaved: (account: MoneyAccount) => void | Promise<void>;
  onMessage: (message: string) => void;
};

export function moneyAccountDraftFor(account: MoneyAccount | null, branchId: string): MoneyAccountDraft {
  if (!account) {
    return {
      accountId: null,
      expectedUpdatedAt: null,
      branchId,
      name: "",
      method: "CASH",
      kind: "CASH_DRAWER",
      provider: "",
      referenceLabel: "",
      allowNegative: false,
      active: true,
      businessWide: false,
    };
  }
  return {
    accountId: account.id,
    expectedUpdatedAt: account.updatedAt,
    branchId: account.branchId,
    name: account.name,
    method: account.method,
    kind: account.kind,
    provider: account.provider ?? "",
    referenceLabel: account.referenceLabel ?? "",
    allowNegative: account.allowNegative,
    active: account.active,
    businessWide: account.branchId === null,
  };
}

export function moneyAccountMessage(code: string | null | undefined, fallback = "Money-account change could not be saved."): string {
  if (code === "REVISION_REQUIRED") return "Refresh this account before editing so TradeOS can protect newer changes.";
  if (code === "OFFLINE_ACCOUNT_CHANGE") return "Money-account configuration changes require an online connection.";
  return masterDataLifecycleMessage(code, "account", fallback);
}

export function MoneyAccountSheet({ open, businessId, branchId, currencyCode, role, account, onClose, onSaved, onMessage }: Props) {
  const canManage = adminRoles.has(role);
  const [draft, setDraft] = useState<MoneyAccountDraft>(() => moneyAccountDraftFor(account, branchId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previous_active_element = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(moneyAccountDraftFor(account, branchId));
    setMessage(null);
  }, [account, branchId, open]);

  useEffect(() => {
    if (!open) return;
    previous_active_element.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstInputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previous_active_element.current?.focus();
    };
  }, [onClose, open]);

  if (!open || !canManage) return null;

  const fail = (reason: unknown) => {
    const text = reason instanceof ClientApiError ? moneyAccountMessage(reason.code, reason.message) : messageFrom(reason);
    setMessage(text);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || busy) return;
    if (!navigator.onLine) {
      setMessage(moneyAccountMessage("OFFLINE_ACCOUNT_CHANGE"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = account
        ? await clientApi<{ account: MoneyAccount }>(`/api/tradeos/v1/money-accounts/${account.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              businessId,
              expectedUpdatedAt: draft.expectedUpdatedAt,
              name: draft.name.trim(),
              provider: draft.provider.trim() || null,
              referenceLabel: draft.referenceLabel.trim() || null,
              allowNegative: draft.allowNegative,
            }),
          })
        : await clientApi<{ account: MoneyAccount }>("/api/tradeos/v1/money-accounts", {
            method: "POST",
            body: JSON.stringify({
              businessId,
              branchId: draft.businessWide ? null : branchId,
              name: draft.name.trim(),
              method: draft.method,
              kind: draft.kind,
              currencyCode,
              provider: draft.provider.trim() || null,
              referenceLabel: draft.referenceLabel.trim() || null,
              allowNegative: draft.allowNegative,
            }),
          });
      await onSaved(result.account);
      onMessage(account ? "Money account updated." : "Money account created.");
      onClose();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!account || busy) return;
    if (!navigator.onLine) {
      setMessage(moneyAccountMessage("OFFLINE_ACCOUNT_CHANGE"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await clientApi<{ account: MoneyAccount }>(`/api/tradeos/v1/money-accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, active: !draft.active }),
      });
      await onSaved(result.account);
      onMessage(draft.active ? "Money account deactivated." : "Money account reactivated.");
      onClose();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="money-account-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="money-account-sheet" role="dialog" aria-modal="true" aria-labelledby="money-account-sheet-title">
        <header className="money-account-sheet-header">
          <div><span>Treasury configuration</span><h2 id="money-account-sheet-title">{account ? `Edit ${account.name}` : "Add money account"}</h2></div>
          <button type="button" className="money-account-sheet-close" aria-label="Close money account" onClick={onClose}>×</button>
        </header>

        <form className="money-account-sheet-body" onSubmit={(event) => void save(event)}>
          <section>
            <div className="money-account-section-heading"><strong>Account details</strong><span>Forward-looking treasury configuration</span></div>
            <div className="money-account-field-grid">
              <label>Name<input ref={firstInputRef} required maxLength={160} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Provider<input maxLength={300} placeholder="Optional" value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value }))} /></label>
              <label>Reference label<input maxLength={300} placeholder="Till number, wallet label, bank reference…" value={draft.referenceLabel} onChange={(event) => setDraft((current) => ({ ...current, referenceLabel: event.target.value }))} /></label>
            </div>
          </section>

          {!account ? (
            <section>
              <div className="money-account-section-heading"><strong>Method &amp; scope</strong><span>Method and account kind are fixed after creation</span></div>
              <div className="money-account-field-grid">
                <label>Payment method<select value={draft.method} onChange={(event) => setDraft((current) => ({ ...current, method: event.target.value, kind: kinds[event.target.value] ?? "OTHER" }))}>{methods.map((method) => <option key={method}>{method}</option>)}</select></label>
                <label className="money-account-check"><input type="checkbox" checked={draft.businessWide} onChange={(event) => setDraft((current) => ({ ...current, businessWide: event.target.checked }))} /> Business-wide account</label>
              </div>
            </section>
          ) : (
            <section>
              <div className="money-account-section-heading"><strong>Account identity</strong><span>Protected after creation</span></div>
              <div className="money-account-identity"><span>{account.method}</span><span>{account.kind.replaceAll("_", " ")}</span><span>{account.branchId ? "Branch account" : "Business-wide"}</span></div>
            </section>
          )}

          <section>
            <div className="money-account-section-heading"><strong>Balance policy</strong><span>Does not rewrite posted money history</span></div>
            <label className="money-account-check"><input type="checkbox" checked={draft.allowNegative} onChange={(event) => setDraft((current) => ({ ...current, allowNegative: event.target.checked }))} /> Allow negative transfer-source balance</label>
            {account ? <p className="money-account-balance-note">Current posted balance: <strong>{currencyCode} {(account.balanceMinor / 100).toFixed(2)}</strong></p> : null}
          </section>

          {account ? (
            <section>
              <div className="money-account-section-heading"><strong>Status</strong><span>Historical cashbook entries remain intact</span></div>
              <p className="money-account-status-copy">{draft.active ? "This account can receive new postings." : "This account is inactive for new postings but remains in treasury history."}</p>
              <MasterDataActions entityLabel="account" active={draft.active} canChangeStatus busy={busy} lifecycleVerb="deactivate" onToggleStatus={toggleStatus} />
            </section>
          ) : null}

          {message ? <div className="money-account-sheet-message" role="status">{message}</div> : null}
          <footer className="money-account-sheet-footer">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : account ? "Save changes" : "Create account"}</Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
