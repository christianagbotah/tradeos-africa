"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Treasury, type MoneyAccount } from "./treasury";
import { CashbookSummary } from "./cashbook/cashbook-summary";
import { CashbookEntryForm } from "./cashbook/cashbook-entry-form";
import { ExpenseCategoryCard } from "./cashbook/expense-category-card";
import { CashbookHistory } from "./cashbook/cashbook-history";
import type { CashbookCategory, CashbookEntry, CashbookExpense, CashbookTotal } from "./cashbook/types";
import { clientApi, messageFrom } from "../lib/client-api";
import {
  enqueueMutation,
  flushPendingMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  queueChangedEvent,
  getPendingMutations,
  getFailedMutations,
} from "../lib/offline-sync";

type Summary = {
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  byMethod: Record<string, { inflowMinor: number; outflowMinor: number; netMinor: number }>;
};
type Snapshot = {
  categories: CashbookCategory[];
  entries: CashbookEntry[];
  expenses: CashbookExpense[];
  totals: CashbookTotal[];
  summary: Summary;
};

const emptySummary: Summary = { inflowMinor: 0, outflowMinor: 0, netMinor: 0, byMethod: {} };
const methods = ["CASH", "MOMO", "CARD", "BANK", "OTHER"];
const moneyMutations = new Set(["SALE_CREATE", "CUSTOMER_PAYMENT_CREATE", "PURCHASE_RECEIVE_CREATE", "SUPPLIER_PAYMENT_CREATE", "RETURN_CREATE", "REFUND_CREATE", "PURCHASE_RETURN_CREATE", "EXPENSE_CREATE", "CASHBOOK_ADJUSTMENT_CREATE", "MONEY_TRANSFER_CREATE", "MONEY_RECONCILIATION_CREATE", "MONEY_RECONCILIATION_RESOLVE"]);
const expenseRoles = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
const adjustmentRoles = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const readRoles = [...expenseRoles, "VIEWER"];

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CashbookExpenses({ businessId, branchId, currencyCode, role }: { businessId: string; branchId: string; currencyCode: string; role: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ categories: [], entries: [], expenses: [], totals: [], summary: emptySummary });
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [moneyAccountId, setMoneyAccountId] = useState("");
  const [mode, setMode] = useState("EXPENSE_CREATE");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reason, setReason] = useState("CORRECTION");
  const [note, setNote] = useState("");
  const [payee, setPayee] = useState("");
  const [provider, setProvider] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const cacheKey = `tradeos.cashbook.v1:${businessId}:${branchId}:${filter}:${from}:${to}`;
  const canRead = readRoles.includes(role);
  const canAdjust = adjustmentRoles.includes(role);
  const canCreateExpense = expenseRoles.includes(role);

  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    setSnapshot({ categories: [], entries: [], expenses: [], totals: [], summary: emptySummary });
    setCategoryId("");
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) setSnapshot(JSON.parse(cached) as Snapshot);
    } catch { /* Ignore unavailable cache. */ }

    const refreshQueue = () => {
      const matches = (mutation: { businessId: string; branchId?: string; mutationType: string }) => mutation.businessId === businessId
        && mutation.branchId === branchId
        && ["EXPENSE_CREATE", "CASHBOOK_ADJUSTMENT_CREATE", "MONEY_TRANSFER_CREATE", "MONEY_RECONCILIATION_CREATE", "MONEY_RECONCILIATION_RESOLVE"].includes(mutation.mutationType);
      setQueued(getPendingMutations().filter(matches).length);
      setFailed(getFailedMutations().filter((entry) => matches(entry.mutation)).map((entry) => entry.result.errorMessage ?? "Entry rejected"));
    };

    const load = async () => {
      refreshQueue();
      if (!navigator.onLine) return;
      const query = new URLSearchParams({
        businessId,
        branchId,
        ...(filter ? { method: filter } : {}),
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
      });
      try {
        const [cashbook, categories, expenses] = await Promise.all([
          clientApi<Pick<Snapshot, "entries" | "totals" | "summary">>(`/api/tradeos/v1/cashbook?${query}`),
          clientApi<{ categories: CashbookCategory[] }>(`/api/tradeos/v1/expense-categories?businessId=${businessId}`),
          clientApi<{ expenses: CashbookExpense[] }>(`/api/tradeos/v1/expenses?${query}`),
        ]);
        if (!alive) return;
        const next: Snapshot = { ...cashbook, ...categories, ...expenses };
        setSnapshot(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* Reads remain usable without cache storage. */ }
      } catch (error) {
        if (alive) setMessage(messageFrom(error));
      }
    };

    void load();
    const applied = (event: Event) => {
      const detail = (event as CustomEvent<{ businessId: string; branchId?: string; mutationType: string }>).detail;
      if (event.type === "online" || (detail?.businessId === businessId && detail.branchId === branchId && moneyMutations.has(detail.mutationType))) void load();
    };
    window.addEventListener(mutationAppliedEvent, applied);
    window.addEventListener("online", applied);
    window.addEventListener(queueChangedEvent, refreshQueue);
    return () => {
      alive = false;
      window.removeEventListener(mutationAppliedEvent, applied);
      window.removeEventListener("online", applied);
      window.removeEventListener(queueChangedEvent, refreshQueue);
    };
  }, [businessId, branchId, cacheKey, filter, from, to, canRead]);

  if (!canRead) return null;
  const money = (minor: number) => currencyCode === "GHS" ? `₵${(minor / 100).toFixed(2)}` : `${currencyCode} ${(minor / 100).toFixed(2)}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Enter an amount with at most two decimal places.");
      const negative = amount.startsWith("-");
      const [whole, fraction = ""] = amount.replace(/^-/, "").split(".");
      const parsedMinor = Number((BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n));
      if (!Number.isSafeInteger(parsedMinor) || parsedMinor === 0 || (mode === "EXPENSE_CREATE" && parsedMinor < 0)) throw new Error("Enter a valid non-zero amount.");
      const adjustmentMinor = reason === "OWNER_WITHDRAWAL" ? -Math.abs(parsedMinor)
        : ["OPENING_BALANCE", "OWNER_INJECTION"].includes(reason) ? Math.abs(parsedMinor)
          : parsedMinor;
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        businessId,
        branchId,
        mutationType: mode,
        occurredAt: new Date().toISOString(),
        payload: {
          method,
          currencyCode,
          ...(moneyAccountId ? { moneyAccountId } : {}),
          ...(mode === "EXPENSE_CREATE"
            ? { categoryId, amountMinor: parsedMinor, description: note, payee, provider, providerReference }
            : { amountDeltaMinor: adjustmentMinor, reason, note }),
        },
      });
      setAmount("");
      setNote("");
      setPayee("");
      setProvider("");
      setProviderReference("");
      setMessage("Saved on this device. Pending entries appear in the cashbook after sync succeeds.");
      void flushPendingMutations().catch((error) => setMessage(`Saved on this device. ${messageFrom(error)}`));
    } catch (error) {
      setMessage(messageFrom(error));
    }
  };



  return (
    <section className="cashbook-page" id="cashbook">
      <header className="cashbook-page-header">
        <div><p className="eyebrow">Money movements</p><h2>Cashbook & expenses</h2><p>Track real cash movement by branch. Credit is excluded until money actually moves, and cached records remain available offline.</p></div>
        <span className={queued > 0 ? "cashbook-sync-badge pending" : "cashbook-sync-badge"}>{queued > 0 ? `${queued} pending sync` : "Fully synced"}</span>
      </header>

      <CashbookSummary
        filter={filter}
        from={from}
        to={to}
        methods={methods}
        queued={queued}
        summary={snapshot.summary}
        totals={snapshot.totals}
        money={money}
        onFilterChange={setFilter}
        onFromChange={setFrom}
        onToChange={setTo}
        onToday={() => { const value = today(); setFrom(value); setTo(value); }}
      />

      <div className="cashbook-primary-grid">
        {canCreateExpense ? <CashbookEntryForm
          currencyCode={currencyCode}
          mode={mode}
          canAdjust={canAdjust}
          amount={amount}
          method={method}
          moneyAccountId={moneyAccountId}
          accounts={accounts}
          branchId={branchId}
          categories={snapshot.categories}
          categoryId={categoryId}
          payee={payee}
          provider={provider}
          providerReference={providerReference}
          reason={reason}
          note={note}
          methods={methods}
          onModeChange={setMode}
          onAmountChange={setAmount}
          onMethodChange={(value) => { setMethod(value); setMoneyAccountId(""); }}
          onMoneyAccountChange={setMoneyAccountId}
          onCategoryChange={setCategoryId}
          onPayeeChange={setPayee}
          onProviderChange={setProvider}
          onProviderReferenceChange={setProviderReference}
          onReasonChange={setReason}
          onNoteChange={setNote}
          onSubmit={submit}
        /> : null}
        {canAdjust ? <ExpenseCategoryCard
          businessId={businessId}
          role={role}
          categories={snapshot.categories}
          onChanged={(category) => {
            setSnapshot((current) => ({ ...current, categories: [...current.categories.filter((item) => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name)) }));
            if (category.active && !categoryId) setCategoryId(category.id);
            if (!category.active && categoryId === category.id) setCategoryId("");
          }}
          onMessage={setMessage}
        /> : null}
      </div>

      {message ? <div className="cashbook-status-message" role="status">{message}</div> : null}
      {failed.length > 0 ? <div className="cashbook-sync-errors" role="alert">{failed.map((error, index) => <p className="form-error" key={`${error}-${index}`}>Sync rejected: {error}</p>)}</div> : null}

      <section className="cashbook-card cashbook-treasury-card">
        <div className="cashbook-section-heading"><div><span>Accounts & reconciliation</span><h3>Treasury</h3></div></div>
        <Treasury businessId={businessId} branchId={branchId} currencyCode={currencyCode} role={role} onAccounts={setAccounts} />
      </section>

      <CashbookHistory entries={snapshot.entries} expenses={snapshot.expenses} money={money} />
    </section>
  );
}
