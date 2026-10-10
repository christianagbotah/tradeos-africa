"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatMoney as formatTradeMoney, parseMoneyInput } from "@tradeos/contracts";
import { clientApi, messageFrom } from "../lib/client-api";
import { ResponsiveTable } from "./ui/responsive-table";
import { Button } from "./ui/button";
import { MoneyInput } from "./ui/money-input";
import { MobileRecordCard } from "./ui/mobile-record-card";
import { StatePanel } from "./ui/state-panel";
import { StatusBadge } from "./ui/status-badge";
import {
  enqueueMutation,
  flushPendingMutations,
  getFailedMutations,
  getOrCreateClientId,
  getPendingMutations,
  mutationAppliedEvent,
  queueChangedEvent,
} from "../lib/offline-sync";

type Counted = { method: string; countedMinor: number };
type Balance = {
  method: string;
  openingCountedMinor: number;
  movementMinor: number;
  expectedClosingMinor: number;
  closingCountedMinor: number | null;
  varianceMinor: number | null;
};
type Interval = {
  id: string;
  businessDate?: string;
  staffId?: string;
  openedAt: string;
  closedAt?: string | null;
  status: string;
  balances: Balance[];
};
type Snapshot = {
  operatingDay: Interval | null;
  shift: Interval | null;
  openShiftCount: number;
  days: Interval[];
  shifts: Interval[];
};
type PendingOperation = {
  businessId: string;
  branchId?: string;
  mutationType: string;
  occurredAt: string;
  payload: unknown;
};

const methods = ["CASH", "MOMO", "CARD", "BANK", "OTHER"] as const;
const dayRoles = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const shiftRoles = [...dayRoles, "CASHIER"];
const operations = new Set([
  "OPERATING_DAY_OPEN_CREATE",
  "OPERATING_DAY_CLOSE_CREATE",
  "SHIFT_OPEN_CREATE",
  "SHIFT_CLOSE_CREATE",
]);
const refreshMutations = new Set([
  ...operations,
  "SALE_CREATE",
  "CUSTOMER_PAYMENT_CREATE",
  "PURCHASE_RECEIVE_CREATE",
  "SUPPLIER_PAYMENT_CREATE",
  "RETURN_CREATE",
  "REFUND_CREATE",
  "PURCHASE_RETURN_CREATE",
  "EXPENSE_CREATE",
  "CASHBOOK_ADJUSTMENT_CREATE",
]);
const emptySnapshot = (): Snapshot => ({ operatingDay: null, shift: null, openShiftCount: 0, days: [], shifts: [] });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function formatMoney(value: number | bigint, currencyCode: string) {
  const minor = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(minor) ? formatTradeMoney(minor, currencyCode) : `${currencyCode} —`;
}

function parseCount(value: string, currencyCode: string) {
  const minor = parseMoneyInput(value, currencyCode);
  if (minor === null || minor < 0) throw new Error("Enter a non-negative balance using the valid decimal precision for this currency.");
  return minor;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asCounts(value: unknown): Counted[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Counted => {
    const row = asRecord(entry);
    return Boolean(row && typeof row.method === "string" && Number.isSafeInteger(row.countedMinor));
  });
}

function openingBalances(input: Counted[] | undefined): Balance[] {
  const counts = new Map((input ?? []).map((balance) => [balance.method, balance.countedMinor]));
  return methods.map((method) => {
    const opening = counts.get(method) ?? 0;
    return {
      method,
      openingCountedMinor: opening,
      movementMinor: 0,
      expectedClosingMinor: opening,
      closingCountedMinor: null,
      varianceMinor: null,
    };
  });
}

function closedInterval(interval: Interval, counts: Counted[], closedAt: string): Interval {
  const byMethod = new Map(counts.map((balance) => [balance.method, balance.countedMinor]));
  return {
    ...interval,
    status: "CLOSED",
    closedAt,
    balances: interval.balances.map((balance) => {
      const counted = byMethod.get(balance.method);
      if (counted === undefined) return balance;
      return { ...balance, closingCountedMinor: counted, varianceMinor: counted - balance.expectedClosingMinor };
    }),
  };
}

function upsert(items: Interval[], interval: Interval) {
  return [interval, ...items.filter((item) => item.id !== interval.id)];
}

function findInterval(snapshot: Snapshot, id: string, shift: boolean): Interval | null {
  const current = shift ? snapshot.shift : snapshot.operatingDay;
  if (current?.id === id) return current;
  return (shift ? snapshot.shifts : snapshot.days).find((item) => item.id === id) ?? null;
}

function applyPendingOperations(base: Snapshot, pending: PendingOperation[], staffId: string | null): Snapshot {
  let next: Snapshot = { ...base, days: [...base.days], shifts: [...base.shifts] };

  for (const mutation of pending) {
    const payload = asRecord(mutation.payload);
    if (!payload) continue;

    if (mutation.mutationType === "OPERATING_DAY_OPEN_CREATE") {
      const dayId = typeof payload.dayId === "string" ? payload.dayId : null;
      if (!dayId) continue;
      const existing = findInterval(next, dayId, false);
      const interval = existing ?? {
        id: dayId,
        businessDate: String(payload.businessDate ?? ""),
        openedAt: mutation.occurredAt,
        closedAt: null,
        status: "OPEN",
        balances: openingBalances(asCounts(payload.openingBalances)),
      };
      next.days = upsert(next.days, interval);
      if (interval.status === "OPEN") next.operatingDay = interval;
      continue;
    }

    if (mutation.mutationType === "SHIFT_OPEN_CREATE") {
      const shiftId = typeof payload.shiftId === "string" ? payload.shiftId : null;
      if (!shiftId) continue;
      const existing = findInterval(next, shiftId, true);
      const interval = existing ?? {
        id: shiftId,
        ...(staffId ? { staffId } : {}),
        openedAt: mutation.occurredAt,
        closedAt: null,
        status: "OPEN",
        balances: openingBalances(asCounts(payload.openingBalances)),
      };
      const wasKnownOpen = Boolean(existing?.status === "OPEN");
      next.shifts = upsert(next.shifts, interval);
      if (interval.status === "OPEN") {
        next.shift = interval;
        if (!wasKnownOpen) next.openShiftCount += 1;
      }
      continue;
    }

    if (mutation.mutationType === "SHIFT_CLOSE_CREATE") {
      const shiftId = typeof payload.shiftId === "string" ? payload.shiftId : null;
      if (!shiftId) continue;
      const existing = findInterval(next, shiftId, true);
      if (!existing || existing.status === "CLOSED") continue;
      const interval = closedInterval(existing, asCounts(payload.closingBalances), mutation.occurredAt);
      next.shifts = upsert(next.shifts, interval);
      if (next.shift?.id === shiftId) {
        next.shift = null;
        next.openShiftCount = Math.max(0, next.openShiftCount - 1);
      }
      continue;
    }

    if (mutation.mutationType === "OPERATING_DAY_CLOSE_CREATE") {
      const dayId = typeof payload.dayId === "string" ? payload.dayId : null;
      if (!dayId) continue;
      const existing = findInterval(next, dayId, false);
      if (!existing || existing.status === "CLOSED") continue;
      const interval = closedInterval(existing, asCounts(payload.closingBalances), mutation.occurredAt);
      next.days = upsert(next.days, interval);
      if (next.operatingDay?.id === dayId) next.operatingDay = null;
    }
  }

  return next;
}

function CountForm({
  type,
  target,
  expected,
  currencyCode,
  onSave,
  disabled = false,
}: {
  type: string;
  target?: string;
  expected?: Balance[];
  currencyCode: string;
  onSave: (type: string, payload: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const close = type.includes("CLOSE");
  const day = type.startsWith("OPERATING_DAY");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const title = `${close ? "Close" : "Open"} ${day ? "business day" : "shift"}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const balances = methods.map((method) => ({ method, countedMinor: parseCount(counts[method] ?? (close ? "" : "0"), currencyCode) }));
      onSave(type, {
        ...(day && !close ? { businessDate: date } : {}),
        ...(close ? (day ? { dayId: target } : { shiftId: target }) : {}),
        note,
        [close ? "closingBalances" : "openingBalances"]: balances,
      });
      setError("");
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };

  return (
    <form className="operations-count-form" onSubmit={submit}>
      <div className="operations-form-heading"><div><span>{day ? "Business day" : "Staff shift"}</span><h3>{title}</h3></div><StatusBadge tone={close ? "warning" : "info"}>{close ? "Closing count" : "Opening count"}</StatusBadge></div>
      {day && !close ? <label>Business date<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label> : null}
      <p className="operations-form-help">{close ? "Count the physical or provider closing balance for all five methods. Variance preview uses the latest synced/cached movements." : "Opening custody snapshots. These balances do not create cashbook movements."}</p>
      <div className="operations-count-grid">
        {methods.map((method) => {
          let preview: string | null = null;
          try {
            const balance = expected?.find((item) => item.method === method);
            if (close && balance && counts[method]) preview = formatMoney(BigInt(parseCount(counts[method]!, currencyCode)) - BigInt(balance.expectedClosingMinor), currencyCode);
          } catch { preview = null; }
          return <label key={method}>{method}
            <MoneyInput currencyCode={currencyCode} required={close} placeholder={close ? "Counted closing" : "0.00"} value={counts[method] ?? ""} onChange={(event) => setCounts({ ...counts, [method]: event.target.value })} />
            {preview !== null ? <small>Preview variance: {preview}</small> : null}
          </label>;
        })}
      </div>
      <label>Note<input maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional handover or reconciliation note" /></label>
      <div className="operations-form-actions"><Button type="submit" disabled={disabled}>{title}</Button></div>
      {error ? <StatePanel state="error" title="Check the counted balances" description={error} /> : null}
    </form>
  );
}

export function OperationsReconciliation({
  businessId,
  branchId,
  currencyCode,
  role,
  staffId,
}: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  staffId: string | null;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState(0);
  const [pendingTypes, setPendingTypes] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<string[]>([]);
  const canDay = dayRoles.includes(role);
  const canShift = shiftRoles.includes(role) && Boolean(staffId);
  const canRead = canShift || role === "VIEWER" || canDay;
  const cacheKey = `tradeos.operations.v1:${businessId}:${branchId}:${role}:${staffId ?? "none"}`;

  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    const matches = (mutation: { businessId: string; branchId?: string; mutationType: string }) => mutation.businessId === businessId && mutation.branchId === branchId && operations.has(mutation.mutationType);
    const pendingForView = () => getPendingMutations().filter(matches) as PendingOperation[];
    const refreshQueue = () => {
      const pending = pendingForView();
      setQueued(pending.length);
      setPendingTypes(new Set(pending.map((mutation) => mutation.mutationType)));
      setFailed(getFailedMutations().filter((entry) => matches(entry.mutation)).map((entry) => entry.result.errorMessage ?? "Mutation rejected"));
      return pending;
    };

    const pending = refreshQueue();
    let cached = emptySnapshot();
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw) as Snapshot;
    } catch {
      cached = emptySnapshot();
    }
    const restored = applyPendingOperations(cached, pending, staffId);
    setSnapshot(restored);
    try { localStorage.setItem(cacheKey, JSON.stringify(restored)); } catch { /* cache is optional */ }

    const load = async () => {
      const currentPending = refreshQueue();
      if (!navigator.onLine) {
        setSnapshot((current) => applyPendingOperations(current, currentPending, staffId));
        return;
      }
      try {
        const query = new URLSearchParams({ businessId, branchId });
        const [current, days, shifts] = await Promise.all([
          clientApi<Pick<Snapshot, "operatingDay" | "shift" | "openShiftCount">>(`/api/tradeos/v1/operations/current?${query}`),
          clientApi<{ days: Interval[] }>(`/api/tradeos/v1/operations/days?${query}`),
          canDay ? clientApi<{ shifts: Interval[] }>(`/api/tradeos/v1/operations/shifts?${query}`) : Promise.resolve({ shifts: [] }),
        ]);
        if (!alive) return;
        const latestPending = refreshQueue();
        const serverSnapshot: Snapshot = { ...current, ...days, ...shifts };
        const next = applyPendingOperations(serverSnapshot, latestPending, staffId);
        setSnapshot(next);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* cache is optional */ }
      } catch (caught) {
        if (alive) setMessage(messageFrom(caught));
      }
    };

    const applied = (event: Event) => {
      const detail = (event as CustomEvent<{ businessId: string; branchId?: string; mutationType: string }>).detail;
      if (event.type === "online" || (detail?.businessId === businessId && detail.branchId === branchId && refreshMutations.has(detail.mutationType))) void load();
    };
    const queueChanged = () => {
      const latestPending = refreshQueue();
      if (navigator.onLine) void load();
      else setSnapshot((current) => applyPendingOperations(current, latestPending, staffId));
    };

    void load();
    window.addEventListener(mutationAppliedEvent, applied);
    window.addEventListener("online", applied);
    window.addEventListener(queueChangedEvent, queueChanged);
    return () => {
      alive = false;
      window.removeEventListener(mutationAppliedEvent, applied);
      window.removeEventListener("online", applied);
      window.removeEventListener(queueChangedEvent, queueChanged);
    };
  }, [businessId, branchId, cacheKey, canRead, canDay, staffId]);

  if (!canRead) return null;

  const money = (value: number) => formatMoney(value, currencyCode);
  const save = (mutationType: string, payload: Record<string, unknown>) => {
    const occurredAt = new Date().toISOString();
    let wire = { ...payload };
    if (mutationType === "OPERATING_DAY_OPEN_CREATE") {
      wire = { ...wire, dayId: crypto.randomUUID() };
    } else if (mutationType === "SHIFT_OPEN_CREATE") {
      if (!snapshot.operatingDay) {
        setMessage("Open a business day first.");
        return;
      }
      wire = { ...wire, dayId: snapshot.operatingDay.id, shiftId: crypto.randomUUID() };
    }

    const optimistic = applyPendingOperations(snapshot, [{ businessId, branchId, mutationType, occurredAt, payload: wire }], staffId);
    setSnapshot(optimistic);
    try { localStorage.setItem(cacheKey, JSON.stringify(optimistic)); } catch { /* cache is optional */ }

    enqueueMutation({
      clientId: getOrCreateClientId(),
      clientMutationId: crypto.randomUUID(),
      businessId,
      branchId,
      mutationType,
      occurredAt,
      payload: wire,
    });
    setMessage(navigator.onLine ? "Saved on this device; syncing now." : "Saved offline on this device. You can continue the day/shift close workflow before reconnecting.");
    void flushPendingMutations().catch((caught) => setMessage(`Saved on this device. ${messageFrom(caught)}`));
  };

  const balances = (interval: Interval) => (
    <>
      <ResponsiveTable className="operations-balance--desktop">
        <table><thead><tr><th>Method</th><th>Opening counted</th><th>Movement</th><th>Expected current</th></tr></thead><tbody>{interval.balances.map((balance) => <tr key={balance.method}><td>{balance.method}</td><td>{money(balance.openingCountedMinor)}</td><td>{money(balance.movementMinor)}</td><td>{money(balance.expectedClosingMinor)}</td></tr>)}</tbody></table>
      </ResponsiveTable>
      <div className="operations-balance--mobile">{interval.balances.map((balance) => <MobileRecordCard key={balance.method} title={balance.method} meta={`Opening ${money(balance.openingCountedMinor)} · movement ${money(balance.movementMinor)}`} status={<StatusBadge tone="info">Expected</StatusBadge>}><p><strong>{money(balance.expectedClosingMinor)}</strong> current expected balance</p></MobileRecordCard>)}</div>
    </>
  );

  const recent = (items: Interval[], shift: boolean) => {
    if (items.length === 0) return <StatePanel state="empty" title={shift ? "No shift history yet" : "No operating-day history yet"} description={shift ? "Closed and active staff shifts will appear here." : "Opened and closed business days will appear here."} />;
    return <>
      <ResponsiveTable className="operations-history--desktop">
        <table><thead><tr><th>{shift ? "Shift opened" : "Business date"}</th><th>Status</th><th>Total variance</th>{methods.map((method) => <th key={method}>{method} variance</th>)}</tr></thead><tbody>{items.map((interval) => { const closed = interval.balances.every((balance) => balance.varianceMinor !== null); const total = interval.balances.reduce((sum, balance) => sum + BigInt(balance.varianceMinor ?? 0), 0n); return <tr key={interval.id}><td>{shift ? new Date(interval.openedAt).toLocaleString() : interval.businessDate}</td><td>{interval.status}</td><td>{closed ? formatMoney(total, currencyCode) : "—"}</td>{methods.map((method) => { const variance = interval.balances.find((balance) => balance.method === method)?.varianceMinor; return <td key={method}>{variance == null ? "—" : money(variance)}</td>; })}</tr>; })}</tbody></table>
      </ResponsiveTable>
      <div className="operations-history--mobile">{items.map((interval) => {
        const closed = interval.balances.every((balance) => balance.varianceMinor !== null);
        const total = interval.balances.reduce((sum, balance) => sum + BigInt(balance.varianceMinor ?? 0), 0n);
        return <MobileRecordCard key={interval.id} title={shift ? new Date(interval.openedAt).toLocaleString() : interval.businessDate ?? "Business day"} meta={`${methods.map((method) => { const variance = interval.balances.find((balance) => balance.method === method)?.varianceMinor; return `${method} ${variance == null ? "—" : money(variance)}`; }).join(" · ")}`} status={<StatusBadge tone={interval.status === "OPEN" ? "warning" : "positive"}>{interval.status}</StatusBadge>}><p><strong>{closed ? formatMoney(total, currencyCode) : "—"}</strong> total variance</p></MobileRecordCard>;
      })}</div>
    </>;
  };

  const dayCloseQueued = pendingTypes.has("OPERATING_DAY_CLOSE_CREATE");
  const shiftCloseQueued = pendingTypes.has("SHIFT_CLOSE_CREATE");
  const messageState = /rejected|failed|error|could not/i.test(message) ? "error" : /offline|saved on this device/i.test(message) ? "offline" : "success";

  return (
    <section className="operations-workspace" id="operations">
      <header className="operations-header">
        <div><span className="operations-kicker">Branch operations</span><h2>Day & shifts</h2><p>Expected closing = opening counted balance + attributed real-money cashbook movements. Variance = counted closing − expected. Opening balances are custody snapshots, never income.</p></div>
        <StatusBadge tone={queued > 0 ? "warning" : "positive"}>{queued > 0 ? `${queued} pending sync` : "Fully synced"}</StatusBadge>
      </header>

      <section className="operations-current-card">
        {!snapshot.operatingDay ? (
          dayCloseQueued ? <StatePanel state="offline" title="Business-day close queued" description="The close is saved on this device and will synchronize when connectivity returns." /> : canDay ? <CountForm key="day-open" type="OPERATING_DAY_OPEN_CREATE" currencyCode={currencyCode} onSave={save} disabled={pendingTypes.has("OPERATING_DAY_OPEN_CREATE")} /> : <StatePanel state="empty" title="No business day is open" description="A manager or authorized finance user must open the business day before staff can open shifts." />
        ) : (
          <>
            <div className="operations-section-heading"><div><span>Current business day</span><h3>{snapshot.operatingDay.businessDate}</h3></div><StatusBadge tone="positive">Open</StatusBadge></div>
            {balances(snapshot.operatingDay)}
            <div className="operations-open-shifts"><span>Open staff shifts</span><strong>{snapshot.openShiftCount}</strong></div>
            {snapshot.shift ? (
              <section className="operations-shift-card"><div className="operations-section-heading"><div><span>Current staff shift</span><h3>Your shift</h3></div><StatusBadge tone="warning">In progress</StatusBadge></div>{balances(snapshot.shift)}{canShift ? <CountForm key={snapshot.shift.id} type="SHIFT_CLOSE_CREATE" target={snapshot.shift.id} expected={snapshot.shift.balances} currencyCode={currencyCode} onSave={save} disabled={shiftCloseQueued} /> : null}</section>
            ) : shiftCloseQueued ? <StatePanel state="offline" title="Shift close queued" description="Your counted close is saved locally and waiting to synchronize." /> : canShift ? <CountForm key="shift-open" type="SHIFT_OPEN_CREATE" currencyCode={currencyCode} onSave={save} disabled={pendingTypes.has("SHIFT_OPEN_CREATE")} /> : null}
            {canDay ? <CountForm key={snapshot.operatingDay.id} type="OPERATING_DAY_CLOSE_CREATE" target={snapshot.operatingDay.id} expected={snapshot.operatingDay.balances} currencyCode={currencyCode} onSave={save} disabled={snapshot.openShiftCount > 0 || dayCloseQueued} /> : null}
          </>
        )}
      </section>

      {message ? <StatePanel state={messageState} title={messageState === "error" ? "Operations needs attention" : messageState === "offline" ? "Saved for synchronization" : "Operations updated"} description={message} /> : null}
      {failed.length > 0 ? <StatePanel state="error" title="Operations sync needs review" description={failed.map((failure) => `Sync rejected: ${failure}`).join(" · ")} /> : null}

      <section className="operations-history-card"><div className="operations-section-heading"><div><span>Operating evidence</span><h3>Recent days</h3></div></div>{recent(snapshot.days, false)}</section>
      {canDay ? <section className="operations-history-card"><div className="operations-section-heading"><div><span>Staff activity</span><h3>Recent shifts</h3></div></div>{recent(snapshot.shifts, true)}</section> : null}
    </section>
  );
}
