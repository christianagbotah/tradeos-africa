"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyAccountSheet, MoneyAccountFormSheet, type MoneyAccount } from "../treasury/money-account-sheet";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconCashbook,
  IconChevronRight,
  IconCreditCard,
  IconPlus,
  IconRefresh,
  IconShield,
  IconSmartphone,
  IconWallet,
} from "../ui/icons";
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

const ACCOUNT_METHOD_GROUPS: ReadonlyArray<{ method: PaymentMethod; label: string; kind: "cash" | "momo" | "bank" | "card" | "other" }> = [
  { method: "CASH", label: "Cash drawers", kind: "cash" },
  { method: "MOMO", label: "Mobile money wallets", kind: "momo" },
  { method: "BANK", label: "Bank accounts", kind: "bank" },
  { method: "CARD", label: "Card clearing", kind: "card" },
  { method: "OTHER", label: "Other accounts", kind: "other" },
];

function methodIconTileClass(method: PaymentMethod): string {
  switch (method) {
    case "CASH": return "tos-account-card__icon tos-account-card__icon--cash";
    case "MOMO": return "tos-account-card__icon tos-account-card__icon--momo";
    case "BANK": return "tos-account-card__icon tos-account-card__icon--bank";
    case "CARD": return "tos-account-card__icon tos-account-card__icon--card";
    default: return "tos-account-card__icon tos-account-card__icon--other";
  }
}

function methodGroupIconTileClass(kind: "cash" | "momo" | "bank" | "card" | "other"): string {
  switch (kind) {
    case "cash": return "tos-account-group__icon tos-account-group__icon--cash";
    case "momo": return "tos-account-group__icon tos-account-group__icon--momo";
    case "bank": return "tos-account-group__icon tos-account-group__icon--bank";
    case "card": return "tos-account-group__icon tos-account-group__icon--card";
    default: return "tos-account-group__icon tos-account-group__icon--other";
  }
}

function methodGroupTotalClass(totalMinor: number): string {
  return totalMinor < 0
    ? "tos-account-group__total tos-account-group__total--negative"
    : "tos-account-group__total";
}

function methodCardClass(method: PaymentMethod): string {
  switch (method) {
    case "CASH": return "tos-account-card tos-account-card--cash";
    case "MOMO": return "tos-account-card tos-account-card--momo";
    case "BANK": return "tos-account-card tos-account-card--bank";
    case "CARD": return "tos-account-card tos-account-card--card";
    default: return "tos-account-card tos-account-card--other";
  }
}

function methodIconSvg(method: PaymentMethod): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 18, height: 18 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 18, height: 18 }} />;
    case "BANK": return <IconWallet style={{ width: 18, height: 18 }} />;
    case "CARD": return <IconCreditCard style={{ width: 18, height: 18 }} />;
    default: return <IconCashbook style={{ width: 18, height: 18 }} />;
  }
}

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
  const matchedCount = reconciliations.filter((r) => r.status === "MATCHED").length;
  const resolvedCount = reconciliations.filter((r) => r.status === "RESOLVED").length;

  const groupedAccounts = useMemo(() => {
    return ACCOUNT_METHOD_GROUPS.map((g) => ({
      ...g,
      accounts: accounts.filter((a) => a.method === g.method),
      totalMinor: accounts.filter((a) => a.method === g.method).reduce((sum, a) => sum + a.balanceMinor, 0),
    })).filter((g) => g.accounts.length > 0);
  }, [accounts]);

  const activeTabs = useMemo(() => {
    const tabs: ReadonlyArray<{ value: ActionTab; label: string; allowed: boolean }> = [
      { value: "expense", label: "Expense", allowed: canExpense },
      { value: "transfer", label: "Transfer", allowed: canTransfer },
      { value: "reconcile", label: "Reconcile", allowed: canReconcile },
      { value: "adjust", label: "Adjust", allowed: canAdjust },
    ];
    return tabs;
  }, [canExpense, canTransfer, canReconcile, canAdjust]);

  // If the active tab is not allowed (role changed), fall back to the first allowed tab.
  useEffect(() => {
    const active = activeTabs.find((t) => t.value === tab);
    if (!active || !active.allowed) {
      const firstAllowed = activeTabs.find((t) => t.allowed);
      if (firstAllowed) setTab(firstAllowed.value);
    }
  }, [activeTabs, tab]);

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

      {/* Treasury hero — midnight gradient with prominent total balance */}
      <div className="tos-treasury-hero tos-animate-fade-in-up">
        <div className="tos-treasury-hero__head">
          <div className="tos-treasury-hero__head-main">
            <span className="tos-treasury-hero__eyebrow">Treasury position</span>
            <h2 className="tos-treasury-hero__title">Total balance across accounts</h2>
            <p className="tos-treasury-hero__sub">{accounts.length} account(s) · {groupedAccounts.length} method group(s)</p>
          </div>
          <span className={`tos-ops-status-pill ${openVariances.length > 0 ? "tos-ops-status-pill--open" : "tos-ops-status-pill--closed"}`}>
            <span className="tos-ops-status-pill__dot" />{openVariances.length > 0 ? `${openVariances.length} variance` : "Balanced"}
          </span>
        </div>
        <div className="tos-treasury-hero__balance-row">
          <span className="tos-treasury-hero__balance-label">Total balance</span>
          <MoneyValue minor={totalBalanceMinor} currencyCode={currencyCode} className="tos-treasury-hero__balance" />
          <span className="tos-treasury-hero__currency">{currencyCode}</span>
        </div>
        <p className="tos-treasury-hero__hint">
          Balances are server-authoritative — derived from the immutable cashbook ledger of sales, purchases, expenses, transfers, reconciliations and adjustments. The client never computes an authoritative balance.
        </p>
      </div>

      {/* KPI strip — 4-up desktop / 2x2 mobile */}
      <div className="tos-dashboard-stats tos-stagger">
        <ReconStat
          label="Open variances"
          icon={<IconCashbook className="tos-stat__icon-tile-svg" />}
          iconTone={openVariances.length > 0 ? "warning" : "positive"}
          variant="hero"
          value={<span className="tos-stat__value tos-stat__value--hero">{openVariances.length}</span>}
          hint={openVariances.length > 0 ? "Need resolution" : "All clear"}
          hintTone={openVariances.length > 0 ? "warning" : "positive"}
        />
        <ReconStat
          label="Matched"
          icon={<IconShield className="tos-stat__icon-tile-svg" />}
          iconTone="positive"
          value={<span className="tos-stat__value">{matchedCount}</span>}
          hint="Counts balanced"
        />
        <ReconStat
          label="Resolved"
          icon={<IconShield className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{resolvedCount}</span>}
          hint="Adjustments posted"
        />
        <ReconStat
          label="Reconciliations"
          icon={<IconRefresh className="tos-stat__icon-tile-svg" />}
          iconTone="neutral"
          value={<span className="tos-stat__value">{reconciliations.length}</span>}
          hint="Recent records"
        />
      </div>

      <div className="tos-ops-grid">
        {/* Money accounts — hierarchy by method */}
        <section className="tos-section tos-animate-fade-in-up">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Money accounts</h2>
            <span className="tos-section__sub">Tap to view detail · grouped by method</span>
          </div>
          <div className="tos-section__body--padded tos-stack">
            {loading ? (
              <StatePanel inline variant="loading" />
            ) : loadError ? (
              <StatePanel inline variant="error" text={loadError} actionLabel="Retry" onAction={() => refetch()} />
            ) : accounts.length === 0 ? (
              <StatePanel inline variant="empty" title="No money accounts" text="Add a cash drawer, MoMo wallet, or bank account to start tracking balances." actionLabel={canAdjust ? "Add account" : undefined} onAction={canAdjust ? () => setAccountFormOpen(true) : undefined} />
            ) : (
              <div className="tos-stack">
                {groupedAccounts.map((group) => (
                  <div key={group.method} className="tos-account-group">
                    <div className="tos-account-group__head">
                      <span className={methodGroupIconTileClass(group.kind)} aria-hidden="true">
                        {methodIconSvg(group.method)}
                      </span>
                      <div className="tos-account-group__body">
                        <span className="tos-account-group__title">{group.label}</span>
                        <span className="tos-account-group__meta">{group.accounts.length} account(s) · {group.accounts.filter((a) => a.isDefault).length} default</span>
                      </div>
                      <MoneyValue minor={group.totalMinor} currencyCode={currencyCode} className={methodGroupTotalClass(group.totalMinor)} />
                    </div>
                    {/* Mobile: premium account cards with method color stripe */}
                    <ul className="tos-list-cards" aria-label={group.label}>
                      {group.accounts.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            className={`${methodCardClass(a.method)} tos-card-hover tos-animate-fade-in-up`}
                            onClick={() => setAccountSheet(a)}
                            aria-label={`Open ${a.name}`}
                          >
                            <span className={methodIconTileClass(a.method)} aria-hidden="true">
                              {methodIconSvg(a.method)}
                            </span>
                            <span className="tos-account-card__body">
                              <span className="tos-account-card__name">{a.name}</span>
                              <span className="tos-account-card__sub">
                                {a.provider ? `${a.provider}` : a.kind}{a.provider && a.referenceLabel ? " · " : ""}{a.referenceLabel ?? ""}
                              </span>
                              {a.isDefault ? <span className="tos-account-card__default">Default for {a.method.toLowerCase()}</span> : null}
                            </span>
                            <span className="tos-account-card__meta">
                              <MoneyValue
                                minor={a.balanceMinor}
                                currencyCode={a.currencyCode}
                                className={a.balanceMinor < 0 ? "tos-account-card__balance tos-account-card__balance--negative" : "tos-account-card__balance"}
                              />
                              <span className="tos-account-card__currency">{a.currencyCode}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {/* Desktop: clean table */}
                    <div className="tos-table-wrap tos-table-wrap--desktop">
                      <div className="tos-table-scroll">
                        <table className="tos-table">
                          <thead>
                            <tr>
                              <th>Account</th>
                              <th>Provider</th>
                              <th>Reference</th>
                              <th data-align="center">Default</th>
                              <th data-align="right">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.accounts.map((a) => (
                              <tr key={a.id} data-clickable="true" onClick={() => setAccountSheet(a)}>
                                <td>
                                  <div className="tos-table__cell-main">
                                    <span className="tos-table__cell-title">{a.name}</span>
                                    <span className="tos-table__cell-sub">{a.kind}</span>
                                  </div>
                                </td>
                                <td className="tos-table__muted">{a.provider ?? "—"}</td>
                                <td className="tos-table__mono">{a.referenceLabel ?? "—"}</td>
                                <td data-align="center">
                                  {a.isDefault ? (
                                    <span className="tos-badge tos-badge--positive"><span className="tos-badge__dot" />Default</span>
                                  ) : (
                                    <span className="tos-table__muted">—</span>
                                  )}
                                </td>
                                <td data-align="right" className="tos-table__num">
                                  <MoneyValue minor={a.balanceMinor} currencyCode={a.currencyCode} tone={a.balanceMinor < 0 ? "negative" : "default"} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Treasury actions — server-authoritative tabbed forms */}
        <section className="tos-section tos-animate-fade-in-up">
          <div className="tos-section__head">
            <h2 className="tos-section__title">Treasury actions</h2>
            <span className="tos-section__sub">Server-authoritative</span>
          </div>
          <div className="tos-section__body--padded tos-stack">
            <div className="tos-action-tabs" role="tablist" aria-label="Treasury action">
              {activeTabs.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  className="tos-action-tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  disabled={!t.allowed}
                  title={t.allowed ? t.label : "No permission for this action"}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "expense" ? <ExpenseForm accounts={accounts} currencyCode={currencyCode} canWrite={canExpense} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
            {tab === "transfer" ? <TransferForm accounts={accounts} currencyCode={currencyCode} canWrite={canTransfer} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
            {tab === "reconcile" ? <ReconcileForm accounts={accounts} currencyCode={currencyCode} canWrite={canReconcile} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
            {tab === "adjust" ? <AdjustForm accounts={accounts} currencyCode={currencyCode} canWrite={canAdjust} session={session} onDone={() => { bump(); setNonce((n) => n + 1); }} /> : null}
          </div>
        </section>
      </div>

      {/* Recent reconciliations — premium mobile cards + desktop table */}
      <section className="tos-section tos-animate-fade-in-up" style={{ marginTop: "var(--tos-space-5)" }}>
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
            <StatePanel inline variant="empty" title="No reconciliations" text="Run a cash count or statement reconciliation to see it here. The expected balance is computed server-side from the cashbook ledger." />
          ) : (
            <>
              {/* Mobile: premium reconciliation cards with variance state */}
              <ul className="tos-list-cards tos-stagger" aria-label="Recent reconciliations">
                {reconciliations.map((r) => {
                  const cardCls = r.status === "MATCHED"
                    ? "tos-recon-card tos-recon-card--matched"
                    : r.status === "VARIANCE"
                      ? "tos-recon-card tos-recon-card--variance"
                      : "tos-recon-card tos-recon-card--resolved";
                  const diffCls = r.differenceMinor === 0
                    ? "tos-recon-card__row-val tos-recon-card__row-val--positive"
                    : "tos-recon-card__row-val tos-recon-card__row-val--negative";
                  return (
                    <li key={r.id}>
                      <div className={`${cardCls} tos-card-hover tos-animate-fade-in-up`}>
                        <div className="tos-recon-card__head">
                          <div className="tos-recon-card__body">
                            <span className="tos-recon-card__account">{r.accountName}</span>
                            <span className="tos-recon-card__meta">
                              {r.type === "CASH_COUNT" ? "Cash count" : "Statement"} · {new Date(r.periodStart).toLocaleDateString()} → {new Date(r.periodEnd).toLocaleDateString()}
                            </span>
                          </div>
                          <span className={`tos-badge ${r.status === "MATCHED" ? "tos-badge--positive" : r.status === "VARIANCE" ? "tos-badge--danger" : "tos-badge--neutral"}`}>
                            <span className="tos-badge__dot" />{r.status}
                          </span>
                        </div>
                        <div className="tos-recon-card__rows">
                          <div className="tos-recon-card__row">
                            <span className="tos-recon-card__row-label">Expected</span>
                            <MoneyValue minor={r.expectedBalanceMinor} currencyCode={currencyCode} className="tos-recon-card__row-val tos-recon-card__row-val--muted" />
                          </div>
                          <div className="tos-recon-card__row">
                            <span className="tos-recon-card__row-label">Observed</span>
                            <MoneyValue minor={r.observedBalanceMinor} currencyCode={currencyCode} className="tos-recon-card__row-val" />
                          </div>
                          <div className="tos-recon-card__row">
                            <span className="tos-recon-card__row-label">Difference</span>
                            <MoneyValue minor={r.differenceMinor} currencyCode={currencyCode} className={diffCls} />
                          </div>
                        </div>
                        <div className="tos-recon-card__foot">
                          {r.status === "VARIANCE" && canAdjust ? (
                            <ResolveVarianceForm
                              reconciliationId={r.id}
                              differenceMinor={r.differenceMinor}
                              currencyCode={currencyCode}
                              session={session}
                              onResolved={() => { bump(); setNonce((n) => n + 1); }}
                            />
                          ) : r.status === "RESOLVED" ? (
                            <span className="tos-recon-card__resolution">{r.resolutionNote ?? "Resolved"}</span>
                          ) : r.status === "MATCHED" ? (
                            <span className="tos-recon-card__resolution">Counted balance matches ledger — no action needed.</span>
                          ) : (
                            <span className="tos-recon-card__resolution">—</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Desktop: clean table */}
              <div className="tos-table-wrap tos-table-wrap--desktop">
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
                          <td className="tos-table__muted">{r.type === "CASH_COUNT" ? "Cash count" : "Statement"}</td>
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
            </>
          )}
        </div>
      </section>

      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__icon-wrap" aria-hidden="true">
          <IconShield style={{ width: 16, height: 16 }} />
        </span>
        <span className="tos-callout__body">
          Cashbook entries are immutable business evidence.
          <span className="tos-callout__sub"> Expenses, transfers, reconciliations and adjustments all post through the server — the new balances, variance deltas and ledger movements are computed server-side. The client only ever submits the observed count, the signed delta, or the transfer instruction.</span>
        </span>
      </div>

      <MoneyAccountSheet account={accountSheet} onClose={() => setAccountSheet(null)} />
      <MoneyAccountFormSheet open={accountFormOpen} onClose={() => setAccountFormOpen(false)} onCreated={() => { setAccountFormOpen(false); setNonce((n) => n + 1); }} />
    </div>
  );
}

// --- Stat card (reuses tos-stat + tos-stat__icon-tile) ------------------

interface ReconStatProps {
  label: string;
  icon: ReactNode;
  iconTone: "gold" | "positive" | "warning" | "midnight" | "neutral";
  value: ReactNode;
  hint?: string;
  hintTone?: "default" | "warning" | "positive";
  variant?: "default" | "hero";
}

const RECON_STAT_TILE_CLASS: Record<ReconStatProps["iconTone"], string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

function ReconStat({ label, icon, iconTone, value, hint, hintTone = "default", variant = "default" }: ReconStatProps) {
  const cls = variant === "hero"
    ? "tos-stat tos-card-hover tos-animate-fade-in-up tos-stat--hero"
    : "tos-stat tos-card-hover tos-animate-fade-in-up";

  const hintCls = hintTone === "warning"
    ? "tos-stat__hint tos-stat__hint--warning"
    : hintTone === "positive"
      ? "tos-stat__hint tos-stat__hint--positive"
      : "tos-stat__hint";

  return (
    <div className={cls}>
      <div className="tos-stat__head">
        <span className={RECON_STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className={hintCls}>{hint}</span> : null}
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
  const defaultAccount = filteredAccounts.find((a) => a.isDefault);

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
      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__icon-wrap" aria-hidden="true"><IconWallet style={{ width: 16, height: 16 }} /></span>
        <span className="tos-callout__body">
          Expenses reduce the chosen money account balance.
          <span className="tos-callout__sub"> The server validates the account, computes the new balance, and records the cashbook movement. If no account is selected, the server uses the default {method.toLowerCase()} account for this branch.</span>
        </span>
      </div>
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
            <option value="">{defaultAccount ? `Default (${defaultAccount.name})` : "Default for method"}</option>
            {filteredAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? " · default" : ""}</option>)}
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

  const sourceAccount = sameCurrencyPairs.find((a) => a.id === sourceAccountId);
  const destOptions = sameCurrencyPairs.filter((a) => a.id !== sourceAccountId && (!sourceAccount || a.currencyCode === sourceAccount.currencyCode));

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
      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__icon-wrap" aria-hidden="true"><IconWallet style={{ width: 16, height: 16 }} /></span>
        <span className="tos-callout__body">
          Transfers move money between two accounts of the same currency.
          <span className="tos-callout__sub"> The server validates balances, overdraft rules, and currency match. Both the source debit and destination credit are recorded as a single atomic cashbook movement.</span>
        </span>
      </div>
      <div className="tos-transfer-flow">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="tf-src">From account<span className="tos-field__label-required">*</span></label>
          <select id="tf-src" className="tos-select" value={sourceAccountId} onChange={(e) => { setSourceAccountId(e.target.value); setDestinationAccountId(""); }} disabled={!canWrite}>
            <option value="">Select source…</option>
            {sameCurrencyPairs.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}
          </select>
        </div>
        <div className="tos-transfer-flow__arrow" aria-hidden="true">
          <IconChevronRight style={{ width: 18, height: 18 }} />
        </div>
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="tf-dst">To account<span className="tos-field__label-required">*</span></label>
          <select id="tf-dst" className="tos-select" value={destinationAccountId} onChange={(e) => setDestinationAccountId(e.target.value)} disabled={!canWrite || destOptions.length === 0}>
            <option value="">{destOptions.length === 0 ? "Select source first" : "Select destination…"}</option>
            {destOptions.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currencyCode})</option>)}
          </select>
        </div>
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
      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__icon-wrap" aria-hidden="true"><IconShield style={{ width: 16, height: 16 }} /></span>
        <span className="tos-callout__body">
          The expected balance is computed server-side from the cashbook ledger.
          <span className="tos-callout__sub"> The client only sends the observed count. The server derives the variance and posts a MATCHED or VARIANCE record — never trust a client-side variance figure.</span>
        </span>
      </div>
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
      <MoneyInput currencyCode={currencyCode} valueMinor={observedBalanceMinor} onChange={setObservedBalanceMinor} label="Observed balance (counted)" size="lg" required disabled={!canWrite} hint="Enter the physical count from the drawer or the statement balance." />
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
  const defaultAccount = filteredAccounts.find((a) => a.isDefault);

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
      <div className="tos-callout tos-callout--warning">
        <span className="tos-callout__icon-wrap" aria-hidden="true"><IconShield style={{ width: 16, height: 16 }} /></span>
        <span className="tos-callout__body">
          Adjustments are immutable evidence. A non-empty note is required.
          <span className="tos-callout__sub"> Use these for opening balances, owner injections/withdrawals, and authorized corrections. The server validates the sign against the reason and computes the new balance.</span>
        </span>
      </div>
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
          <option value="">{defaultAccount ? `Default (${defaultAccount.name})` : "Default for method"}</option>
          {filteredAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isDefault ? " · default" : ""}</option>)}
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Resolve variance</Button>
    );
  }
  const diffCls = differenceMinor < 0
    ? "tos-variance-banner__amount tos-variance-banner__amount--negative"
    : "tos-variance-banner__amount tos-variance-banner__amount--positive";
  return (
    <div className="tos-stack" style={{ minWidth: 240, flex: "1 1 240px" }}>
      <div className="tos-variance-banner">
        <span className="tos-variance-banner__icon" aria-hidden="true">
          <IconShield style={{ width: 16, height: 16 }} />
        </span>
        <div className="tos-variance-banner__body">
          <span className="tos-variance-banner__label">{differenceMinor < 0 ? "Shortage" : "Surplus"}</span>
          <MoneyValue minor={differenceMinor} currencyCode={currencyCode} className={diffCls} />
          <span className="tos-variance-banner__hint">Resolve posts a server-authoritative adjustment for the difference. A clear explanation is required.</span>
        </div>
      </div>
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
