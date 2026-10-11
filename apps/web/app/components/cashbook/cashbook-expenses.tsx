"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyAccountSheet, MoneyAccountFormSheet, type MoneyAccount } from "../treasury/money-account-sheet";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconCashbook, IconPlus, IconRefresh, IconWallet } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

interface MoneyAccountsResponse { accounts: MoneyAccount[] }

export function CashbookExpenses() {
  const { session, role, bump } = useWorkspace();
  const [formOpen, setFormOpen] = useState(false);
  const [accountSheet, setAccountSheet] = useState<MoneyAccount | null>(null);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Expense form state
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<"CASH" | "MOMO" | "CARD" | "BANK" | "OTHER">("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = session ? `/v1/treasury/accounts?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}` : null;
  const { data, loading, error: loadError, refetch } = useApiFetch<MoneyAccountsResponse>(path);

  useEffect(() => {
    if (nonce > 0) refetch();
  }, [nonce, refetch]);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";
  const accounts = data?.accounts ?? [];
  const totalBalanceMinor = accounts.reduce((sum, a) => sum + a.balanceMinor, 0);

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || amount === null || amount <= 0 || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { method, amountMinor: amount, note: note.trim() || null };
      if (category.trim()) payload.category = category.trim();
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType: "EXPENSE_CREATE", payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump();
      setAmount(null); setCategory(""); setNote("");
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record expense.");
    } finally { setBusy(false); }
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Money</span>
          <h1 className="tos-page__title">Cashbook &amp; treasury</h1>
          <p className="tos-page__subtitle">Record expenses and reconcile money accounts. Every movement is server-authoritative evidence.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
          {canWrite ? (
            <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setAccountFormOpen(true)}>Add account</Button>
          ) : null}
        </div>
      </header>

      <div className="tos-grid-stats">
        <div className="tos-stat">
          <span className="tos-stat__label"><IconWallet className="tos-stat__icon" /> Total balance</span>
          <span className="tos-stat__value"><MoneyValue minor={totalBalanceMinor} currencyCode={currencyCode} size="lg" /></span>
          <span className="tos-stat__hint">{accounts.length} account(s)</span>
        </div>
        <div className="tos-stat">
          <span className="tos-stat__label"><IconCashbook className="tos-stat__icon" /> Accounts</span>
          <span className="tos-stat__value">{accounts.length}</span>
          <span className="tos-stat__hint">Across all payment methods</span>
        </div>
      </div>

      <div className="tos-grid-two">
        <div className="tos-section">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Money accounts</h2>
            <span className="tos-section__sub">Tap to view detail</span>
          </div>
          <div className="tos-section__body">
            {loading ? (
              <StatePanel inline variant="loading" />
            ) : loadError ? (
              <StatePanel inline variant="error" text={loadError} actionLabel="Retry" onAction={() => refetch()} />
            ) : accounts.length === 0 ? (
              <StatePanel inline variant="empty" title="No money accounts" text="Add a cash drawer, MoMo wallet, or bank account to start tracking balances." actionLabel={canWrite ? "Add account" : undefined} onAction={canWrite ? () => setAccountFormOpen(true) : undefined} />
            ) : (
              <ul className="tos-list" style={{ borderRadius: 0, border: "none", boxShadow: "none" }}>
                {accounts.map((a) => (
                  <li key={a.id} className="tos-list__row" style={{ borderBottom: "1px solid var(--tos-border)" }}>
                    <button type="button" className="tos-list__row" style={{ width: "100%", background: "transparent", padding: 0, border: "none" }} onClick={() => setAccountSheet(a)}>
                      <div className="tos-list__row-main">
                        <span className="tos-list__row-title">{a.name}</span>
                        <span className="tos-list__row-sub">{a.method}{a.provider ? ` · ${a.provider}` : ""}{a.isDefault ? " · Default" : ""}</span>
                      </div>
                      <div className="tos-list__row-meta">
                        <span className="tos-list__row-amount"><MoneyValue minor={a.balanceMinor} currencyCode={a.currencyCode} tone={a.balanceMinor < 0 ? "negative" : "default"} /></span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="tos-section">
          <div className="tos-section__head"><h2 className="tos-section__title">Record expense</h2></div>
          <form className="tos-section__body--padded tos-stack" onSubmit={handleRecordExpense}>
            <MoneyInput currencyCode={currencyCode} valueMinor={amount} onChange={setAmount} label="Amount" size="lg" required disabled={!canWrite} />
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cb-cat">Category</label>
              <input id="cb-cat" className="tos-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Transport, Rent, Airtime" disabled={!canWrite} />
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cb-method">Paid from</label>
              <select id="cb-method" className="tos-select" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} disabled={!canWrite}>
                <option value="CASH">Cash</option>
                <option value="MOMO">Mobile money</option>
                <option value="CARD">Card</option>
                <option value="BANK">Bank</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cb-note">Note</label>
              <textarea id="cb-note" className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} />
            </div>
            {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
            <Button type="submit" variant="primary" block loading={busy} disabled={!canWrite || amount === null || amount <= 0}>
              {canWrite ? "Record expense" : "No permission"}
            </Button>
          </form>
        </div>
      </div>

      <MoneyAccountSheet account={accountSheet} onClose={() => setAccountSheet(null)} />
      <MoneyAccountFormSheet open={accountFormOpen} onClose={() => setAccountFormOpen(false)} onCreated={() => { setAccountFormOpen(false); setNonce((n) => n + 1); }} />
    </div>
  );
}
