"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyAccountSheet, MoneyAccountFormSheet, type MoneyAccount } from "../treasury/money-account-sheet";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconCashbook, IconPlus, IconRefresh, IconWallet } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildMoneyTransferPayload,
  buildMoneyReconciliationPayload,
  buildMoneyReconciliationResolvePayload,
  buildCashbookAdjustmentPayload,
  MONEY_TRANSFER_CREATE_TYPE,
  MONEY_RECONCILIATION_CREATE_TYPE,
  MONEY_RECONCILIATION_RESOLVE_TYPE,
  CASHBOOK_ADJUSTMENT_CREATE_TYPE,
  CASHBOOK_ADJUSTMENT_ROLES,
  TREASURY_RECONCILE_ROLES,
  TREASURY_TRANSFER_ROLES,
  EXPENSE_ROLES,
  roleCan,
  type CashbookAdjustmentReason,
  type PaymentMethod,
  type ReconciliationType,
  type WorkspaceRole,
} from "../../../lib/mutation-builders";

interface MoneyAccountsResponse { accounts: MoneyAccount[]; totalBalanceMinor: number }

interface Reconciliation {
  id: string;
  branchId: string;
  moneyAccountId: string;
  accountName: string;
  type: string;
  periodStart: string;
  periodEnd: string;
  expectedBalanceMinor: number;
  observedBalanceMinor: number;
  differenceMinor: number;
  status: string;
  note: string | null;
  occurredAt: string;
  resolutionAdjustmentId: string | null;
  resolutionNote: string | null;
}

interface ReconciliationsResponse { reconciliations: Reconciliation[] }

const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank" },
  { value: "OTHER", label: "Other" },
];

const ADJUSTMENT_REASONS: ReadonlyArray<{ value: CashbookAdjustmentReason; label: string }> = [
  { value: "OPENING_BALANCE", label: "Opening balance" },
  { value: "CORRECTION", label: "Correction" },
  { value: "OWNER_INJECTION", label: "Owner injection" },
  { value: "OWNER_WITHDRAWAL", label: "Owner withdrawal" },
];

type ActionTab = "expense" | "transfer" | "reconcile" | "adjust";

export function CashbookExpenses() {
  const { session, role, bump } = useWorkspace();
  const [accountSheet, setAccountSheet] = useState<MoneyAccount | null>(null);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<ActionTab>("expense");

  const accountsPath = session ? `/v1/treasury/accounts?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}` : null;
  const reconciliationsPath = session ? `/v1/money-reconciliations?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=20` : null;
  const { data, loading, error: loadError, refetch } = useApiFetch<MoneyAccountsResponse>(accountsPath);
  const { data: recData, loading: recLoading, error: recError, refetch: refetchRec } = useApiFetch<ReconciliationsResponse>(reconciliationsPath);

  useEffect(() => {
    if (nonce > 0) {
      refetch();
      refetchRec();
    }
  }, [nonce, refetch, refetchRec]);

  const canAdjust = roleCan(role as WorkspaceRole, CASHBOOK_ADJUSTMENT_ROLES);
  const canReconcile = roleCan(role as WorkspaceRole, TREASURY_RECONCILE_ROLES);
  const canTransfer = roleCan(role as WorkspaceRole, TREASURY_TRANSFER_ROLES);
  const canExpense = roleCan(role as WorkspaceRole, EXPENSE_ROLES);
  const canWrite = canAdjust || canReconcile || canTransfer || canExpense;

  const currencyCode = session?.currencyCode ?? "GHS";
  const accounts = data?.accounts ?? [];
  const totalBalanceMinor = data?.totalBalanceMinor ?? accounts.reduce((sum, a) => sum + a.balanceMinor, 0);
  const reconciliations = recData?.reconciliations ?? [];
  const openVariances = reconciliations.filter((r) => r.status === "VARIANCE");

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Money</span>
          <h1 className="tos-page__title">Cashbook &amp; treasury</h1>
          <p className="tos-page__subtitle">Record expenses, transfer between accounts, reconcile cash counts and adjust balances. Every movement is server-authoritative evidence.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
          {canAdjust ? (
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
          <span className="tos-stat__label"><IconCashbook className="tos-stat__icon" /> Open variances</span>
          <span className="tos-stat__value">{openVariances.length}</span>
          <span className="tos-stat__hint">{reconciliations.length} reconciliation(s) recent</span>
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
              <StatePanel inline variant="empty" title="No money accounts" text="Add a cash drawer, MoMo wallet, or bank account to start tracking balances." actionLabel={canAdjust ? "Add account" : undefined} onAction={canAdjust ? () => setAccountFormOpen(true) : undefined} />
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
          <div className="tos-section__head">
            <h2 className="tos-section__title">Treasury actions</h2>
            <span className="tos-section__sub">Server-authoritative</span>
          </div>
          <div className="tos-section__body--padded tos-stack">
            <div className="tos-tabs">
              <button type="button" className="tos-tabs__tab" aria-selected={tab === "expense"} onClick={() => setTab("expense")} disabled={!canExpense}>Expense</button>
              <button type="button" className="tos-tabs__tab" aria-selected={tab === "transfer"} onClick={() => setTab("transfer")} disabled={!canTransfer}>Transfer</button>
              <button type="button" className="tos-tabs__tab" aria-selected={tab === "reconcile"} onClick={() => setTab("reconcile")} disabled={!canReconcile}>Reconcile</button>
              <button type="button" className="tos-tabs__tab" aria-selected={tab === "adjust"} onClick={() => setTab("adjust")} disabled={!canAdjust}>Adjust</button>
            </div>

            {tab === "expense" ? <ExpenseForm accounts={accounts} currencyCode={currencyCode} canWrite={canExpense} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
            {tab === "transfer" ? <TransferForm accounts={accounts} currencyCode={currencyCode} canWrite={canTransfer} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
            {tab === "reconcile" ? <ReconcileForm accounts={accounts} currencyCode={currencyCode} canWrite={canReconcile} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
            {tab === "adjust" ? <AdjustForm accounts={accounts} currencyCode={currencyCode} canWrite={canAdjust} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
          </div>
        </div>
      </div>

      <section className="tos-section" style={{ marginTop: "var(--tos-space-5)" }}>
        <div className="tos-section__head">
          <h2 className="tos-section__title">Recent reconciliations</h2>
          <span className="tos-section__sub">{reconciliations.length} record(s) · {openVariances.length} need resolution</span>
        </div>
        <div className="tos-section__body">
          {recLoading ? (
            <StatePanel inline variant="loading" />
          ) : recError ? (
            <StatePanel inline variant="error" text={recError} actionLabel="Retry" onAction={() => refetchRec()} />
          ) : reconciliations.length === 0 ? (
            <StatePanel inline variant="empty" title="No reconciliations" text="Run a cash count or statement reconciliation to see it here." />
          ) : (
            <div className="tos-table-wrap">
              <div className="tos-table-scroll">
                <table className="tos-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th>Period</th>
                      <th data-align="right">Expected</th>
                      <th data-align="right">Observed</th>
                      <th data-align="right">Difference</th>
                      <th data-align="center">Status</th>
                      <th>Resolve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliations.map((r) => (
                      <tr key={r.id}>
                        <td><div className="tos-table__cell-main"><span className="tos-table__cell-title">{r.accountName}</span></div></td>
                        <td className="tos-table__muted">{r.type}</td>
                        <td className="tos-table__muted">{new Date(r.periodStart).toLocaleDateString()} → {new Date(r.periodEnd).toLocaleDateString()}</td>
                        <td data-align="right" className="tos-table__num"><MoneyValue minor={r.expectedBalanceMinor} currencyCode={currencyCode} tone="muted" /></td>
                        <td data-align="right" className="tos-table__num"><MoneyValue minor={r.observedBalanceMinor} currencyCode={currencyCode} /></td>
                        <td data-align="right" className="tos-table__num"><MoneyValue minor={r.differenceMinor} currencyCode={currencyCode} tone={r.differenceMinor === 0 ? "muted" : "negative"} /></td>
                        <td data-align="center">
                          <span className={`tos-badge ${r.status === "MATCHED" ? "tos-badge--positive" : r.status === "VARIANCE" ? "tos-badge--danger" : "tos-badge--neutral"}`}><span className="tos-badge__dot" />{r.status}</span>
                        </td>
                        <td>
                          {r.status === "VARIANCE" && canAdjust ? (
                            <ResolveVarianceForm
                              reconciliationId={r.id}
                              differenceMinor={r.differenceMinor}
                              currencyCode={currencyCode}
                              session={session}
                              onResolved={() => { bump(); setNonce((n) => n + 1); }}
                            />
                          ) : r.status === "RESOLVED" ? (
                            <span className="tos-table__muted">{r.resolutionNote ?? "Resolved"}</span>
                          ) : (
                            <span className="tos-table__muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <MoneyAccountSheet account={accountSheet} onClose={() => setAccountSheet(null)} />
      <MoneyAccountFormSheet open={accountFormOpen} onClose={() => setAccountFormOpen(false)} onCreated={() => { setAccountFormOpen(false); setNonce((n) => n + 1); }} />
    </div>
  );
}

// --- EXPENSE_CREATE form (existing workflow, kept here for the tab) ------

interface ActionFormProps {
  accounts: readonly MoneyAccount[];
  currencyCode: string;
  canWrite: boolean;
  session: { businessId: string; branchId: string } | null;
  onDone: () => void;
}

function ExpenseForm({ accounts, currencyCode, canWrite, session, onDone }: ActionFormProps) {
  const [amount, setAmount] = useState<number | null>(null);
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [moneyAccountId, setMoneyAccountId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredAccounts = useMemo(() => accounts.filter((a) => a.method === method && a.active), [accounts, method]);

  if (!session) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || amount === null || amount <= 0 || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { method, amountMinor: amount, note: note.trim() || null };
      if (category.trim()) payload.category = category.trim();
      if (moneyAccountId) payload.moneyAccountId = moneyAccountId;
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType: "EXPENSE_CREATE", payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      setAmount(null); setCategory(""); setNote("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record expense.");
    } finally { setBusy(false); }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit}>
      <div className="tos-callout tos-callout--info">Expenses reduce the chosen money account balance. The server validates the account and computes the new balance.</div>
      <MoneyInput currencyCode={currencyCode} valueMinor={amount} onChange={setAmount} label="Amount" size="lg" required disabled={!canWrite} />
      <div className="tos-public__form-row">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="cb-method">Paid from method</label>
          <select id="cb-method" className="tos-select" value={method} onChange={(e) => { setMethod(e.target.value as PaymentMethod); setMoneyAccountId(""); }} disabled={!canWrite}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="cb-account">Account (optional)</label>
          <select id="cb-account" className="tos-select" value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)} disabled={!canWrite}>
            <option value="">Default for method</option>
            {filteredAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cb-cat">Category</label>
        <input id="cb-cat" className="tos-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Transport, Rent, Airtime" disabled={!canWrite} />
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
  );
}

// --- MONEY_TRANSFER_CREATE form -----------------------------------------

function TransferForm({ accounts, currencyCode, canWrite, session, onDone }: ActionFormProps) {
  const [sourceAccountId, setSourceAccountId] = useState<string>("");
  const [destinationAccountId, setDestinationAccountId] = useState<string>("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const sameCurrencyPairs = useMemo(() => {
    return accounts.filter((a) => a.active);
  }, [accounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !sourceAccountId || !destinationAccountId || sourceAccountId === destinationAccountId || amountMinor === null || amountMinor <= 0 || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload = buildMoneyTransferPayload({
        sourceAccountId,
        destinationAccountId,
        amountMinor,
        note: note.trim() || null,
      });
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType: MONEY_TRANSFER_CREATE_TYPE, payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      setAmountMinor(null); setNote(""); setSourceAccountId(""); setDestinationAccountId("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enqueue transfer.");
    } finally { setBusy(false); }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit}>
      <div className="tos-callout tos-callout--info">Transfers move money between two accounts of the same currency. The server validates balances and overdraft rules.</div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="tf-src">From account<span className="tos-field__label-required">*</span></label>
        <select id="tf-src" className="tos-select" value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)} disabled={!canWrite}>
          <option value="">Select source…</option>
          {sameCurrencyPairs.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}
        </select>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="tf-dst">To account<span className="tos-field__label-required">*</span></label>
        <select id="tf-dst" className="tos-select" value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} disabled={!canWrite}>
          <option value="">Select destination…</option>
          {sameCurrencyPairs.filter((a) => a.id !== sourceAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}
        </select>
      </div>
      <MoneyInput currencyCode={currencyCode} valueMinor={amountMinor} onChange={setAmountMinor} label="Amount" size="lg" required disabled={!canWrite} />
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="tf-note">Note (optional)</label>
        <input id="tf-note" className="tos-input" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <Button type="submit" variant="primary" block loading={busy} disabled={!canWrite || !sourceAccountId || !destinationAccountId || sourceAccountId === destinationAccountId || amountMinor === null || amountMinor <= 0}>
        {canWrite ? "Queue transfer" : "No permission"}
      </Button>
    </form>
  );
}

// --- MONEY_RECONCILIATION_CREATE form -----------------------------------

function ReconcileForm({ accounts, currencyCode, canWrite, session, onDone }: ActionFormProps) {
  const [moneyAccountId, setMoneyAccountId] = useState<string>("");
  const [type, setType] = useState<ReconciliationType>("CASH_COUNT");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [observedBalanceMinor, setObservedBalanceMinor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const cashDrawers = accounts.filter((a) => a.method === "CASH" && a.kind === "CASH_DRAWER" && a.active);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !moneyAccountId || !periodStart || !periodEnd || observedBalanceMinor === null || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload = buildMoneyReconciliationPayload({
        moneyAccountId,
        type,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
        observedBalanceMinor,
        note: note.trim() || null,
      });
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType: MONEY_RECONCILIATION_CREATE_TYPE, payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      setMoneyAccountId(""); setPeriodStart(""); setPeriodEnd(""); setObservedBalanceMinor(null); setNote("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enqueue reconciliation.");
    } finally { setBusy(false); }
  };

  const accountOptions = type === "CASH_COUNT" ? cashDrawers : accounts.filter((a) => a.active);

  return (
    <form className="tos-stack" onSubmit={handleSubmit}>
      <div className="tos-callout tos-callout--info">The expected balance is computed server-side from the cashbook ledger. The client only sends the observed count.</div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="rc-type">Type</label>
        <select id="rc-type" className="tos-select" value={type} onChange={(e) => { setType(e.target.value as ReconciliationType); setMoneyAccountId(""); }} disabled={!canWrite}>
          <option value="CASH_COUNT">Cash count (cash drawer)</option>
          <option value="STATEMENT">Statement reconciliation</option>
        </select>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="rc-account">Account<span className="tos-field__label-required">*</span></label>
        <select id="rc-account" className="tos-select" value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)} disabled={!canWrite || accountOptions.length === 0}>
          <option value="">{accountOptions.length === 0 ? "No eligible accounts" : "Select account…"}</option>
          {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}
        </select>
      </div>
      <div className="tos-public__form-row">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="rc-start">Period start<span className="tos-field__label-required">*</span></label>
          <input id="rc-start" type="datetime-local" className="tos-input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="rc-end">Period end<span className="tos-field__label-required">*</span></label>
          <input id="rc-end" type="datetime-local" className="tos-input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={!canWrite} />
        </div>
      </div>
      <MoneyInput currencyCode={currencyCode} valueMinor={observedBalanceMinor} onChange={setObservedBalanceMinor} label="Observed balance" size="lg" required disabled={!canWrite} />
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="rc-note">Note (optional)</label>
        <textarea id="rc-note" className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <Button type="submit" variant="primary" block loading={busy} disabled={!canWrite || !moneyAccountId || !periodStart || !periodEnd || observedBalanceMinor === null}>
        {canWrite ? "Run reconciliation" : "No permission"}
      </Button>
    </form>
  );
}

// --- CASHBOOK_ADJUSTMENT_CREATE form ------------------------------------

function AdjustForm({ accounts, currencyCode, canWrite, session, onDone }: ActionFormProps) {
  const [moneyAccountId, setMoneyAccountId] = useState<string>("");
  const [amountDeltaMinor, setAmountDeltaMinor] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reason, setReason] = useState<CashbookAdjustmentReason>("CORRECTION");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const filteredAccounts = useMemo(() => accounts.filter((a) => a.method === method && a.active), [accounts, method]);

  // For OPENING_BALANCE / OWNER_INJECTION the delta must be positive; for OWNER_WITHDRAWAL negative; CORRECTION any non-zero.
  const signHint = reason === "OPENING_BALANCE" || reason === "OWNER_INJECTION"
    ? "Enter a positive amount — the server rejects negative opening/injection."
    : reason === "OWNER_WITHDRAWAL"
      ? "Enter a positive amount — the server stores it as a negative delta."
      : "CORRECTION accepts any non-zero amount (use a negative sign to debit).";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || amountDeltaMinor === null || amountDeltaMinor === 0 || !note.trim() || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      // For OWNER_WITHDRAWAL the user enters a positive number; send as negative.
      const delta = reason === "OWNER_WITHDRAWAL" ? -Math.abs(amountDeltaMinor) : amountDeltaMinor;
      const payload = buildCashbookAdjustmentPayload({
        amountDeltaMinor: delta,
        method,
        reason,
        note: note.trim(),
        moneyAccountId: moneyAccountId || null,
      });
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType: CASHBOOK_ADJUSTMENT_CREATE_TYPE, payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      setMoneyAccountId(""); setAmountDeltaMinor(null); setNote("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enqueue adjustment.");
    } finally { setBusy(false); }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit}>
      <div className="tos-callout tos-callout--warning">Adjustments are immutable evidence. A non-empty note is required.</div>
      <div className="tos-public__form-row">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="ad-reason">Reason<span className="tos-field__label-required">*</span></label>
          <select id="ad-reason" className="tos-select" value={reason} onChange={(e) => setReason(e.target.value as CashbookAdjustmentReason)} disabled={!canWrite}>
            {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="ad-method">Method<span className="tos-field__label-required">*</span></label>
          <select id="ad-method" className="tos-select" value={method} onChange={(e) => { setMethod(e.target.value as PaymentMethod); setMoneyAccountId(""); }} disabled={!canWrite}>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="ad-account">Account (optional)</label>
        <select id="ad-account" className="tos-select" value={moneyAccountId} onChange={(e) => setMoneyAccountId(e.target.value)} disabled={!canWrite}>
          <option value="">Default for method</option>
          {filteredAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <MoneyInput currencyCode={currencyCode} valueMinor={amountDeltaMinor} onChange={setAmountDeltaMinor} label="Amount (signed)" size="lg" required disabled={!canWrite} hint={signHint} />
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="ad-note">Note<span className="tos-field__label-required">*</span></label>
        <textarea id="ad-note" className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} required />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <Button type="submit" variant="primary" block loading={busy} disabled={!canWrite || amountDeltaMinor === null || amountDeltaMinor === 0 || !note.trim()}>
        {canWrite ? "Queue adjustment" : "No permission"}
      </Button>
    </form>
  );
}

// --- MONEY_RECONCILIATION_RESOLVE form ----------------------------------

interface ResolveVarianceFormProps {
  reconciliationId: string;
  differenceMinor: number;
  currencyCode: string;
  session: { businessId: string; branchId: string } | null;
  onResolved: () => void;
}

function ResolveVarianceForm({ reconciliationId, differenceMinor, currencyCode, session, onResolved }: ResolveVarianceFormProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const handleSubmit = async () => {
    if (!note.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload = buildMoneyReconciliationResolvePayload({
        reconciliationId,
        note: note.trim(),
      });
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType: MONEY_RECONCILIATION_RESOLVE_TYPE, payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      setNote(""); setOpen(false);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enqueue resolution.");
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Resolve</Button>
    );
  }
  return (
    <div className="tos-stack" style={{ minWidth: 240 }}>
      <div className="tos-section__sub">Difference: <MoneyValue minor={differenceMinor} currencyCode={currencyCode} tone="negative" /></div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor={`rv-note-${reconciliationId}`}>Explanation<span className="tos-field__label-required">*</span></label>
        <textarea id={`rv-note-${reconciliationId}`} className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="e.g. cash shortage during shift" />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row">
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setNote(""); }} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={handleSubmit} loading={busy} disabled={!note.trim()}>Resolve variance</Button>
      </div>
    </div>
  );
}
