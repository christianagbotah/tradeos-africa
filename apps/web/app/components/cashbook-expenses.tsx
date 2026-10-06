"use client";

import { useEffect, useState, type FormEvent } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId, mutationAppliedEvent, queueChangedEvent, getPendingMutations, getFailedMutations } from "../lib/offline-sync";

type Category = { id: string; name: string; active: boolean };
type Entry = { id: string; amountDeltaMinor: number; method: string; entryType: string; occurredAt: string };
type Expense = { id: string; amountMinor: number; categoryName: string; description: string | null; payee: string | null; method: string };
type Summary = { inflowMinor: number; outflowMinor: number; netMinor: number; byMethod: Record<string,{inflowMinor:number;outflowMinor:number;netMinor:number}> };
type Snapshot = { categories: Category[]; entries: Entry[]; expenses: Expense[]; totals: { method: string; balanceMinor: number; inflowMinor: number; outflowMinor: number }[]; summary: Summary };
const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const moneyMutations = new Set(["SALE_CREATE","CUSTOMER_PAYMENT_CREATE","PURCHASE_RECEIVE_CREATE","SUPPLIER_PAYMENT_CREATE","RETURN_CREATE","REFUND_CREATE","PURCHASE_RETURN_CREATE","EXPENSE_CREATE","CASHBOOK_ADJUSTMENT_CREATE"]);
const methods = ["CASH", "MOMO", "CARD", "BANK", "OTHER"];
const expenseRoles = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
const adjustmentRoles = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const readRoles = [...expenseRoles, "VIEWER"];

export function CashbookExpenses({ businessId, branchId, currencyCode, role }: { businessId: string; branchId: string; currencyCode: string; role: string }) {
  const emptySummary: Summary = {inflowMinor:0,outflowMinor:0,netMinor:0,byMethod:{}};
  const [snapshot, setSnapshot] = useState<Snapshot>({ categories: [], entries: [], expenses: [], totals: [], summary: emptySummary });
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
  const [categoryName, setCategoryName] = useState("");
  const [busy, setBusy] = useState(false);
  const cacheKey = `tradeos.cashbook.v1:${businessId}:${branchId}:${filter}:${from}:${to}`;
  const canRead = readRoles.includes(role);
  const canAdjust = adjustmentRoles.includes(role);
  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    setSnapshot({ categories: [], entries: [], expenses: [], totals: [], summary: emptySummary });
    setCategoryId("");
    try { const cached = localStorage.getItem(cacheKey); if (cached) setSnapshot(JSON.parse(cached)); } catch { /* Ignore unavailable cache. */ }
    const refreshQueue = () => {
      const matches = (m: { businessId: string; branchId?: string; mutationType: string }) => m.businessId === businessId && m.branchId === branchId && ["EXPENSE_CREATE", "CASHBOOK_ADJUSTMENT_CREATE"].includes(m.mutationType);
      setQueued(getPendingMutations().filter(matches).length);
      setFailed(getFailedMutations().filter(f => matches(f.mutation)).map(f => f.result.errorMessage ?? "Entry rejected"));
    };
    const load = async () => {
      refreshQueue();
      if (!navigator.onLine) return;
      const query = new URLSearchParams({ businessId, branchId, ...(filter ? { method: filter } : {}), ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}), ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}) });
      try {
        const [cashbook, categories, expenses] = await Promise.all([
          clientApi<Pick<Snapshot, "entries" | "totals" | "summary">>(`/api/tradeos/v1/cashbook?${query}`),
          clientApi<{ categories: Category[] }>(`/api/tradeos/v1/expense-categories?businessId=${businessId}`),
          clientApi<{ expenses: Expense[] }>(`/api/tradeos/v1/expenses?${query}`),
        ]);
        if (!alive) return;
        const next = { ...cashbook, ...categories, ...expenses };
        setSnapshot(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* Reads remain usable without cache storage. */ }
      } catch (error) { if (alive) setMessage(messageFrom(error)); }
    };
    void load();
    const applied = (event: Event) => { const detail=(event as CustomEvent<{businessId:string;branchId?:string;mutationType:string}>).detail; if(event.type === "online" || (detail?.businessId === businessId && detail.branchId === branchId && moneyMutations.has(detail.mutationType))) void load(); };
    window.addEventListener(mutationAppliedEvent, applied);
    window.addEventListener("online", applied);
    window.addEventListener(queueChangedEvent, refreshQueue);
    return () => { alive = false; window.removeEventListener(mutationAppliedEvent, applied); window.removeEventListener("online", applied); window.removeEventListener(queueChangedEvent, refreshQueue); };
  }, [businessId, branchId, cacheKey, filter, from, to, canRead]);
  if (!canRead) return null;
  const money = (minor: number) => currencyCode === "GHS" ? `₵${(minor / 100).toFixed(2)}` : `${currencyCode} ${(minor / 100).toFixed(2)}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Enter an amount with at most two decimal places.");
      const negative=amount.startsWith("-"); const [whole,fraction=""]=amount.replace(/^-/ ,"").split(".");
      const parsedMinor=Number((BigInt(whole!)*100n+BigInt(fraction.padEnd(2,"0")))*(negative?-1n:1n));
      if (!Number.isSafeInteger(parsedMinor) || parsedMinor === 0 || (mode === "EXPENSE_CREATE" && parsedMinor < 0)) throw new Error("Enter a valid non-zero amount.");
      const adjustmentMinor = reason === "OWNER_WITHDRAWAL" ? -Math.abs(parsedMinor)
        : ["OPENING_BALANCE","OWNER_INJECTION"].includes(reason) ? Math.abs(parsedMinor)
        : parsedMinor;
      enqueueMutation({ clientId: getOrCreateClientId(), clientMutationId: crypto.randomUUID(), businessId, branchId, mutationType: mode, occurredAt: new Date().toISOString(), payload: { method, currencyCode, ...(mode === "EXPENSE_CREATE" ? { categoryId, amountMinor: parsedMinor, description: note, payee, provider, providerReference } : { amountDeltaMinor: adjustmentMinor, reason, note }) } });
      setAmount(""); setNote(""); setPayee(""); setProvider(""); setProviderReference("");
      setMessage("Saved on this device. Pending entries appear in the cashbook after sync succeeds.");
      void flushPendingMutations().catch(error => setMessage(`Saved on this device. ${messageFrom(error)}`));
    } catch (error) { setMessage(messageFrom(error)); }
  };
  const createCategory = async () => {
    setBusy(true);
    try {
      const result = await clientApi<{ category: Category }>("/api/tradeos/v1/expense-categories", { method: "POST", body: JSON.stringify({ businessId, name: categoryName }) });
      setSnapshot(current => ({ ...current, categories: [...current.categories.filter(c => c.id !== result.category.id), result.category] }));
      setCategoryId(result.category.id); setCategoryName("");
    } catch (error) { setMessage(messageFrom(error)); } finally { setBusy(false); }
  };
  return <section className="panel" id="cashbook">
    <div className="panel-heading"><div><p className="eyebrow">Money movements</p><h2>Cashbook & expenses</h2></div><span>{queued} pending</span></div>
    <div className="form-row"><label>Method<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All methods</option>{methods.map(m => <option key={m}>{m}</option>)}</select></label><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
    <button type="button" onClick={() => {setFrom(today());setTo(today());}}>Today</button>
    <p>Inflow: <strong>{money(snapshot.summary.inflowMinor)}</strong> · Outflow: <strong>{money(snapshot.summary.outflowMinor)}</strong> · Net movement: <strong>{money(snapshot.summary.netMinor)}</strong></p>
    <p>Money movement in the selected period; credit is excluded. Cached records remain available offline.</p>
    <div className="form-row">{snapshot.totals.map(t => <div key={t.method}><strong>{t.method} net movement: {money(t.balanceMinor)}</strong><p>In {money(t.inflowMinor)} · Out {money(t.outflowMinor)}</p></div>)}</div>
    {expenseRoles.includes(role) && <form onSubmit={submit}>
      <div className="form-row"><label>Entry<select value={mode} onChange={e => setMode(e.target.value)}><option value="EXPENSE_CREATE">Expense</option>{canAdjust && <option value="CASHBOOK_ADJUSTMENT_CREATE">Balance adjustment</option>}</select></label><label>Amount ({currencyCode})<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label><label>Payment method<select value={method} onChange={e => setMethod(e.target.value)}>{methods.map(m => <option key={m}>{m}</option>)}</select></label></div>
      {mode === "EXPENSE_CREATE" ? <><div className="form-row"><label>Category<select required value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Select category</option>{snapshot.categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Payee<input value={payee} onChange={e => setPayee(e.target.value)} maxLength={1000} /></label></div><div className="form-row"><label>Provider<input value={provider} onChange={e => setProvider(e.target.value)} maxLength={1000} /></label><label>Provider reference<input value={providerReference} onChange={e => setProviderReference(e.target.value)} maxLength={1000} /></label></div></> : <><label>Reason<select value={reason} onChange={e => setReason(e.target.value)}>{["CORRECTION", "OPENING_BALANCE", "OWNER_INJECTION", "OWNER_WITHDRAWAL"].map(r => <option key={r}>{r}</option>)}</select></label><p>Enter the amount normally. TradeOS automatically treats withdrawals as money out; corrections may be positive or negative.</p></>}
      <label>{mode === "EXPENSE_CREATE" ? "Description" : "Required explanation"}<input required={mode !== "EXPENSE_CREATE" || !payee.trim()} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} /></label>
      <button className="primary-button" type="submit">Save entry</button>
    </form>}
    {canAdjust && <div className="form-row"><label>New expense category (online)<input value={categoryName} onChange={e => setCategoryName(e.target.value)} maxLength={160} /></label><button type="button" disabled={busy || !categoryName.trim()} onClick={() => void createCategory()}>Add category</button></div>}
    {message && <p role="status">{message}</p>}{failed.map((error, i) => <p className="form-error" key={i}>Sync rejected: {error}</p>)}
    <h3>Recent movements</h3><table><thead><tr><th>Date</th><th>Movement</th><th>Method</th><th>Amount</th></tr></thead><tbody>{snapshot.entries.map(e => <tr key={e.id}><td>{new Date(e.occurredAt).toLocaleString()}</td><td>{e.entryType.replaceAll("_", " ")}</td><td>{e.method}</td><td>{money(e.amountDeltaMinor)}</td></tr>)}</tbody></table>
    <h3>Recent expenses</h3>{snapshot.expenses.map(e => <p key={e.id}>{e.categoryName} · {e.description || e.payee} · {e.method} · {money(e.amountMinor)}</p>)}
  </section>;
}
