"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ClientApiError, clientApi, messageFrom } from "../lib/client-api";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId, mutationAppliedEvent } from "../lib/offline-sync";
import { Button } from "./ui/button";
import { MoneyAccountSheet, moneyAccountMessage } from "./treasury/money-account-sheet";
import type { MoneyAccount, MoneyAccountDefault, Reconciliation } from "./treasury/types";

export type { MoneyAccount } from "./treasury/types";

const methods = ["CASH", "MOMO", "CARD", "BANK", "OTHER"];
const elevatedRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  onAccounts: (accounts: MoneyAccount[]) => void;
};

type TreasurySnapshot = {
  accounts: MoneyAccount[];
  defaults: MoneyAccountDefault[];
  reconciliations: Reconciliation[];
};

export function Treasury({ businessId, branchId, currencyCode, role, onAccounts }: Props) {
  const elevated = elevatedRoles.has(role);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [defaults, setDefaults] = useState<MoneyAccountDefault[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<MoneyAccount | null | undefined>(undefined);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [observed, setObserved] = useState("");
  const [type, setType] = useState("CASH_COUNT");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const cacheKey = `tradeos.treasury.v2:${businessId}:${branchId}:${role}`;

  useEffect(() => {
    setAccounts([]);
    setDefaults([]);
    setReconciliations([]);
    onAccounts([]);
    let alive = true;

    const update = (data: TreasurySnapshot) => {
      if (!alive) return;
      setAccounts(data.accounts);
      setDefaults(data.defaults);
      setReconciliations(data.reconciliations);
      onAccounts(data.accounts);
    };

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) update(JSON.parse(cached) as TreasurySnapshot);
    } catch { /* Cache is optional. */ }

    const load = async () => {
      try {
        const query = `businessId=${businessId}${role === "CASHIER" ? `&branchId=${branchId}` : ""}`;
        const [accountResult, defaultResult, reconciliationResult] = await Promise.all([
          clientApi<{ accounts: MoneyAccount[] }>(`/api/tradeos/v1/money-accounts?${query}`),
          clientApi<{ defaults: MoneyAccountDefault[] }>(`/api/tradeos/v1/money-account-defaults?businessId=${businessId}&branchId=${branchId}`),
          clientApi<{ reconciliations: Reconciliation[] }>(`/api/tradeos/v1/money-reconciliations?${query}`),
        ]);
        const data: TreasurySnapshot = { ...accountResult, ...defaultResult, ...reconciliationResult };
        update(data);
        if (alive) localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (error) {
        if (alive) setMessage(messageFrom(error));
      }
    };

    if (navigator.onLine) void load();
    const refresh = () => void load();
    window.addEventListener(mutationAppliedEvent, refresh);
    window.addEventListener("online", refresh);
    return () => {
      alive = false;
      window.removeEventListener(mutationAppliedEvent, refresh);
      window.removeEventListener("online", refresh);
    };
  }, [businessId, branchId, role, cacheKey, version, onAccounts]);

  const money = (minor: number) => currencyCode === "GHS" ? `₵${(minor / 100).toFixed(2)}` : `${currencyCode} ${(minor / 100).toFixed(2)}`;
  const minor = (value: string) => {
    if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter an amount with at most two decimal places");
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const result = Number((BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n));
    if (!Number.isSafeInteger(result)) throw new Error("Amount is too large");
    return result;
  };

  const queue = (mutationType: string, payload: unknown) => {
    try {
      enqueueMutation({
        businessId,
        branchId,
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        mutationType,
        occurredAt: new Date().toISOString(),
        payload,
      });
      setMessage("Saved on this device. Treasury updates after sync.");
      void flushPendingMutations().catch((error) => setMessage(messageFrom(error)));
    } catch (error) {
      setMessage(messageFrom(error));
    }
  };

  const handleAccountSaved = (saved: MoneyAccount) => {
    const next = [...accounts.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
    setAccounts(next);
    onAccounts(next);
    setVersion((current) => current + 1);
  };

  const writeDefault = async (method: string, moneyAccountId: string) => {
    const current = defaults.find((item) => item.method === method);
    if (!current) {
      setMessage("This branch does not have a default mapping to update. Refresh Treasury and try again.");
      return;
    }
    if (!navigator.onLine) {
      setMessage(moneyAccountMessage("OFFLINE_ACCOUNT_CHANGE"));
      return;
    }
    try {
      await clientApi("/api/tradeos/v1/money-account-defaults", {
        method: "PUT",
        body: JSON.stringify({ businessId, branchId, method, moneyAccountId, expectedUpdatedAt: current.updatedAt }),
      });
      setVersion((value) => value + 1);
      setMessage(`${method} default account updated.`);
    } catch (error) {
      if (error instanceof ClientApiError) {
        setMessage(error.code === "ACCOUNT_IS_DEFAULT" ? moneyAccountMessage("ACCOUNT_IS_DEFAULT", error.message) : moneyAccountMessage(error.code, error.message));
      } else setMessage(messageFrom(error));
    }
  };

  const eligible = accounts.filter((item) => item.active && (role !== "CASHIER" || (item.branchId === branchId && item.method === "CASH" && item.kind === "CASH_DRAWER")));
  const totalBalance = accounts.reduce((sum, item) => sum + item.balanceMinor, 0);

  return (
    <div className="treasury-section">
      <h3>Treasury</h3>
      <div className="treasury-account-toolbar">
        <div>
          <p>Current account balances cover all posted history. Period cashbook net movement is shown separately above.</p>
          <strong>{role === "CASHIER" ? "Current branch account total" : "Total business balance"}: {money(totalBalance)}</strong>
        </div>
        {elevated ? <Button type="button" onClick={() => setEditor(null)}>Add money account</Button> : null}
      </div>

      <div className="form-row">{methods.map((method) => <p key={method}>{method}: {money(accounts.filter((item) => item.method === method).reduce((sum, item) => sum + item.balanceMinor, 0))}</p>)}</div>

      <div className="treasury-table-scroll">
        <table>
          <thead><tr><th>Account</th><th>Scope</th><th>Method</th><th>Balance</th><th>Status</th>{elevated ? <th>Manage</th> : null}</tr></thead>
          <tbody>{accounts.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.name}</strong>{item.referenceLabel ? <small className="treasury-account-reference">{item.referenceLabel}</small> : null}</td>
              <td>{item.branchId ? item.branchId === branchId ? "Current branch" : "Other branch" : "Business"}</td>
              <td>{item.method}</td>
              <td>{money(item.balanceMinor)}</td>
              <td><span className={item.active ? "treasury-status active" : "treasury-status"}>{item.active ? "Active" : "Inactive"}</span></td>
              {elevated ? <td><Button variant="secondary" size="compact" type="button" onClick={() => setEditor(item)}>Edit</Button></td> : null}
            </tr>
          ))}</tbody>
        </table>
      </div>

      {elevated ? (
        <section className="treasury-defaults">
          <div className="cashbook-section-heading"><div><span>Routing</span><h3>Current branch defaults</h3></div><small>Used when a transaction does not choose an account explicitly.</small></div>
          <div className="treasury-default-grid">
            {methods.map((method) => {
              const current = defaults.find((item) => item.method === method);
              return <label key={method}>{method}<select value={current?.moneyAccountId ?? ""} onChange={(event) => void writeDefault(method, event.target.value)}><option value="">Choose account</option>{accounts.filter((item) => item.active && item.method === method && (item.branchId === null || item.branchId === branchId)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
            })}
          </div>
          <p className="treasury-default-note">Deactivate an account only after replacing every default that points to it. TradeOS will block unsafe deactivation with <strong>ACCOUNT_IS_DEFAULT</strong>.</p>
        </section>
      ) : null}

      {elevated ? (
        <form onSubmit={(event) => { event.preventDefault(); try { queue("MONEY_TRANSFER_CREATE", { sourceAccountId: source, destinationAccountId: destination, amountMinor: minor(amount), note }); } catch (error) { setMessage(messageFrom(error)); } }}>
          <h4>Transfer funds</h4>
          <label>From<select required value={source} onChange={(event) => setSource(event.target.value)}><option value="">Choose source</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.method} · {money(item.balanceMinor)}</option>)}</select></label>
          <label>To<select required value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Choose destination</option>{eligible.filter((item) => item.id !== source).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.method}</option>)}</select></label>
          <label>Amount<input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /></label>
          <label>Note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} /></label>
          <button>Save transfer</button>
        </form>
      ) : null}

      {(elevated || role === "CASHIER") ? (
        <form onSubmit={(event: FormEvent) => {
          event.preventDefault();
          try {
            queue("MONEY_RECONCILIATION_CREATE", {
              moneyAccountId: account,
              type: role === "CASHIER" ? "CASH_COUNT" : type,
              periodStart: new Date(start).toISOString(),
              periodEnd: new Date(end).toISOString(),
              observedBalanceMinor: minor(observed),
              note,
            });
          } catch (error) { setMessage(messageFrom(error)); }
        }}>
          <h4>{role === "CASHIER" ? "Cash drawer count" : "Start reconciliation"}</h4>
          <label>Account<select required value={account} onChange={(event) => setAccount(event.target.value)}><option value="">Choose account</option>{eligible.filter((item) => type !== "CASH_COUNT" || (item.method === "CASH" && item.kind === "CASH_DRAWER")).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {elevated ? <label>Type<select value={type} onChange={(event) => { setType(event.target.value); setAccount(""); }}><option>CASH_COUNT</option><option>STATEMENT</option></select></label> : null}
          <label>Period start<input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>Period end<input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <label>Observed balance<input required value={observed} onChange={(event) => setObserved(event.target.value)} inputMode="decimal" /></label>
          <label>Note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} /></label>
          <p>Variances stay open until explicitly resolved. Resolution posts a correction for the exact difference.</p>
          <button>Save reconciliation</button>
        </form>
      ) : null}

      <h4>Reconciliations</h4>
      <div className="treasury-reconciliation-list">{reconciliations.map((item) => <p key={item.id}>{accounts.find((candidate) => candidate.id === item.moneyAccountId)?.name} · {item.status} · Difference {money(item.differenceMinor)} {elevated && item.status === "VARIANCE" ? <button onClick={() => { const resolutionNote = window.prompt("Required explanation for the correction"); if (resolutionNote?.trim()) queue("MONEY_RECONCILIATION_RESOLVE", { reconciliationId: item.id, note: resolutionNote }); }}>Resolve with correction</button> : null}</p>)}</div>
      {message ? <p className="treasury-message" role="status">{message}</p> : null}

      {editor !== undefined ? (
        <MoneyAccountSheet
          open
          businessId={businessId}
          branchId={branchId}
          currencyCode={currencyCode}
          role={role}
          account={editor}
          onClose={() => setEditor(undefined)}
          onSaved={handleAccountSaved}
          onMessage={setMessage}
        />
      ) : null}
    </div>
  );
}
