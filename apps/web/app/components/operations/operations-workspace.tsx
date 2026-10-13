"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconCashbook,
  IconChevronRight,
  IconClock,
  IconCreditCard,
  IconOperations,
  IconRefresh,
  IconShield,
  IconSmartphone,
  IconWallet,
} from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

interface MethodBalance {
  method: string;
  openingCountedMinor: number;
  movementMinor: number;
  expectedClosingMinor: number;
  closingCountedMinor: number | null;
  varianceMinor: number | null;
}

interface OperatingDay {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  balances: ReadonlyArray<MethodBalance>;
}

interface Shift {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
}

interface CurrentOperations {
  operatingDay: OperatingDay | null;
  shift: Shift | null;
  openShiftCount: number;
}

interface OperationsResponse {
  current: CurrentOperations;
}

type OpsAction = "open-day" | "close-day" | "open-shift" | "close-shift";

function methodIconSvg(method: string): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 16, height: 16 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 16, height: 16 }} />;
    case "BANK": return <IconWallet style={{ width: 16, height: 16 }} />;
    case "CARD": return <IconCreditCard style={{ width: 16, height: 16 }} />;
    default: return <IconCashbook style={{ width: 16, height: 16 }} />;
  }
}

function methodLabel(method: string): string {
  switch (method) {
    case "CASH": return "Cash";
    case "MOMO": return "Mobile money";
    case "BANK": return "Bank";
    case "CARD": return "Card";
    default: return method.toLowerCase();
  }
}

function varianceValClass(varianceMinor: number | null): string {
  if (varianceMinor === null) return "tos-ops-method__col-val tos-ops-method__col-val--muted";
  if (varianceMinor === 0) return "tos-ops-method__col-val tos-ops-method__col-val--balanced";
  return "tos-ops-method__col-val tos-ops-method__col-val--variance";
}

function varianceText(varianceMinor: number | null): string {
  if (varianceMinor === null) return "Pending count";
  if (varianceMinor === 0) return "Balanced";
  return varianceMinor < 0 ? "Shortage" : "Surplus";
}

export function OperationsWorkspace() {
  const { session, role, bump } = useWorkspace();
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashCounted, setCashCounted] = useState<number | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const path = session
    ? `/v1/operations/current?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const { data, loading, error: loadError, refetch } = useApiFetch<OperationsResponse>(path);

  useEffect(() => {
    if (nonce > 0) refetch();
  }, [nonce, refetch]);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";
  const current = data?.current;
  const operatingDay = current?.operatingDay ?? null;
  const shift = current?.shift ?? null;

  const hasVariance = useMemo(() => {
    if (!operatingDay) return false;
    return operatingDay.balances.some((b) => b.varianceMinor !== null && b.varianceMinor !== 0);
  }, [operatingDay]);

  const totalExpected = useMemo(() => {
    if (!operatingDay) return 0;
    return operatingDay.balances.reduce((sum, b) => sum + b.expectedClosingMinor, 0);
  }, [operatingDay]);

  const totalVariance = useMemo(() => {
    if (!operatingDay) return 0;
    return operatingDay.balances.reduce((sum, b) => sum + (b.varianceMinor ?? 0), 0);
  }, [operatingDay]);

  const handleAction = async (action: OpsAction) => {
    if (!session || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      let mutationType: string;
      let payload: Record<string, unknown> = {};
      if (action === "open-day") {
        mutationType = "OPERATING_DAY_OPEN_CREATE";
        payload = { openingBalances: cashCounted !== null ? [{ method: "CASH", countedMinor: cashCounted }] : [] };
      } else if (action === "close-day") {
        mutationType = "OPERATING_DAY_CLOSE_CREATE";
        payload = { closingBalances: cashCounted !== null ? [{ method: "CASH", countedMinor: cashCounted }] : [] };
      } else if (action === "open-shift") {
        mutationType = "SHIFT_OPEN_CREATE";
      } else {
        mutationType = "SHIFT_CLOSE_CREATE";
      }
      const mutation = queue.build({ businessId: session.businessId, branchId: session.branchId, mutationType, payload });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump(); setCashCounted(null); setConfirmClose(false); setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete operation.");
    } finally { setBusy(false); }
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Money</span>
          <h1 className="tos-page__title">Operations</h1>
          <p className="tos-page__subtitle">Open and close operating days and shifts. Reconcile cash drawers against expected balances.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
        </div>
      </header>

      {loading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : loadError ? (
        <StatePanel variant="error" title="Could not load operations" text={loadError} actionLabel="Retry" onAction={() => refetch()} />
      ) : !current ? (
        <StatePanel variant="empty" icon={<IconOperations className="tos-state__icon" />} title="No operations data" text="Open an operating day to start tracking shifts and reconciliation." />
      ) : (
        <>
          {/* Operations status hero — midnight gradient with status pill */}
          <div className="tos-ops-hero tos-animate-fade-in-up">
            <div className="tos-ops-hero__head">
              <div className="tos-ops-hero__head-main">
                <span className="tos-ops-hero__eyebrow">Operating day</span>
                <h2 className="tos-ops-hero__title">{operatingDay ? `Day ${operatingDay.id.slice(0, 8)}` : "No day open"}</h2>
                <p className="tos-ops-hero__sub">
                  {operatingDay
                    ? operatingDay.status === "OPEN"
                      ? `Opened ${new Date(operatingDay.openedAt).toLocaleString()}`
                      : `Closed ${operatingDay.closedAt ? new Date(operatingDay.closedAt).toLocaleString() : ""}`
                    : "Open an operating day to begin tracking shifts and reconciliation."}
                </p>
              </div>
              <span className={`tos-ops-status-pill ${operatingDay?.status === "OPEN" ? "tos-ops-status-pill--open" : "tos-ops-status-pill--closed"}`}>
                <span className="tos-ops-status-pill__dot" />{operatingDay?.status ?? "CLOSED"}
              </span>
            </div>
            {operatingDay ? (
              <div className="tos-ops-operator">
                <span className="tos-ops-operator__icon" aria-hidden="true">
                  <IconClock style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-ops-operator__body">
                  <span className="tos-ops-operator__label">{operatingDay.status === "OPEN" ? "Opened by operator" : "Closed by operator"}</span>
                  <span className="tos-ops-operator__value">
                    {operatingDay.status === "OPEN"
                      ? new Date(operatingDay.openedAt).toLocaleString()
                      : operatingDay.closedAt
                        ? new Date(operatingDay.closedAt).toLocaleString()
                        : "—"}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="tos-ops-hero__sub" style={{ position: "relative", zIndex: 1 }}>
              Operating days and shifts are evidence-grade. They reconcile against money-account balances and feed the cashbook automatically — every expected balance is computed server-side from the ledger of sales, purchases, expenses, transfers and adjustments during the period.
            </p>
          </div>

          <div className="tos-ops-grid">
            {/* Operating day — expected vs actual per method */}
            <section className="tos-section tos-animate-fade-in-up">
              <div className="tos-section__head">
                <h2 className="tos-section__title">Operating day</h2>
                <span className="tos-section__sub">
                  {operatingDay
                    ? hasVariance
                      ? `${operatingDay.balances.filter((b) => b.varianceMinor !== null && b.varianceMinor !== 0).length} variance(s)`
                      : operatingDay.balances.length > 0 ? "All methods balanced" : "No balances yet"
                    : "Closed"}
                </span>
              </div>
              <div className="tos-section__body--padded tos-stack">
                {operatingDay ? (
                  operatingDay.balances.length > 0 ? (
                    <>
                      {/* Per-method expected vs actual comparison rows */}
                      <div className="tos-section" style={{ boxShadow: "none" }}>
                        <div className="tos-section__body">
                          {operatingDay.balances.map((b) => {
                            const varianceLabel = varianceText(b.varianceMinor);
                            return (
                              <div key={b.method} className="tos-ops-method">
                                <div className="tos-ops-method__head">
                                  <span className="tos-ops-method__icon" aria-hidden="true">
                                    {methodIconSvg(b.method)}
                                  </span>
                                  <span className="tos-ops-method__name">{methodLabel(b.method)}</span>
                                </div>
                                <div className="tos-ops-method__col">
                                  <span className="tos-ops-method__col-label">Expected</span>
                                  <MoneyValue minor={b.expectedClosingMinor} currencyCode={currencyCode} className="tos-ops-method__col-val tos-ops-method__col-val--muted" />
                                </div>
                                <div className="tos-ops-method__col">
                                  <span className="tos-ops-method__col-label">Counted</span>
                                  {b.closingCountedMinor !== null ? (
                                    <MoneyValue minor={b.closingCountedMinor} currencyCode={currencyCode} className="tos-ops-method__col-val" />
                                  ) : (
                                    <span className="tos-ops-method__col-val tos-ops-method__col-val--muted">Pending</span>
                                  )}
                                </div>
                                <div className="tos-ops-method__col">
                                  <span className="tos-ops-method__col-label">Variance</span>
                                  {b.varianceMinor !== null ? (
                                    <MoneyValue minor={b.varianceMinor} currencyCode={currencyCode} className={varianceValClass(b.varianceMinor)} signed />
                                  ) : (
                                    <span className="tos-ops-method__col-val tos-ops-method__col-val--muted">{varianceLabel}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Day summary — opening / movement / expected / variance totals */}
                      <div className="tos-account-group">
                        {operatingDay.balances.map((b) => (
                          <div key={`${b.method}-movement`} className="tos-account-group__head">
                            <span className="tos-account-group__icon tos-account-group__icon--cash" aria-hidden="true">
                              {methodIconSvg(b.method)}
                            </span>
                            <div className="tos-account-group__body">
                              <span className="tos-account-group__title">{methodLabel(b.method)} movement</span>
                              <span className="tos-account-group__meta">
                                Opening <MoneyValue minor={b.openingCountedMinor} currencyCode={currencyCode} tone="muted" /> · {b.movementMinor >= 0 ? "inflow" : "outflow"} <MoneyValue minor={b.movementMinor} currencyCode={currencyCode} tone={b.movementMinor >= 0 ? "positive" : "negative"} />
                              </span>
                            </div>
                            <MoneyValue minor={b.expectedClosingMinor} currencyCode={currencyCode} className="tos-account-group__total" />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="tos-state__text">No balances recorded yet. Open the day with a counted cash balance to begin.</p>
                  )
                ) : (
                  <p className="tos-state__text">No operating day is open. Open one to begin tracking.</p>
                )}

                {/* Counted cash input — used as opening or closing balance for the cash drawer */}
                {canWrite && operatingDay ? (
                  <MoneyInput
                    currencyCode={currencyCode}
                    valueMinor={cashCounted}
                    onChange={setCashCounted}
                    label={operatingDay.status === "OPEN" ? "Counted cash (for closing)" : "Counted cash (for opening)"}
                    hint={operatingDay.status === "OPEN" ? "Enter the physical cash count from the drawer. This will be the closing balance submitted when you close the day." : "Enter the physical cash count from the drawer. This will be the opening balance for the new operating day."}
                  />
                ) : null}

                {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}

                {/* Close-day confirmation flow — shows what will be finalized */}
                {canWrite && operatingDay && operatingDay.status === "OPEN" && confirmClose ? (
                  <div className="tos-ops-confirm tos-animate-fade-in-up">
                    <h3 className="tos-ops-confirm__title">Confirm close day</h3>
                    <p className="tos-ops-confirm__sub">
                      Closing the day finalizes the cash reconciliation. The server will record the closing balance, compute the final variance per method, and post any required cashbook adjustments as immutable evidence.
                    </p>
                    <div className="tos-ops-confirm__rows">
                      <div className="tos-ops-confirm__row">
                        <span className="tos-ops-confirm__row-label">Methods to reconcile</span>
                        <span className="tos-ops-confirm__row-val">{operatingDay.balances.length}</span>
                      </div>
                      <div className="tos-ops-confirm__row">
                        <span className="tos-ops-confirm__row-label">Total expected</span>
                        <MoneyValue minor={totalExpected} currencyCode={currencyCode} className="tos-ops-confirm__row-val" />
                      </div>
                      <div className="tos-ops-confirm__row">
                        <span className="tos-ops-confirm__row-label">Cash counted</span>
                        {cashCounted !== null ? (
                          <MoneyValue minor={cashCounted} currencyCode={currencyCode} className="tos-ops-confirm__row-val" />
                        ) : (
                          <span className="tos-ops-confirm__row-val tos-ops-confirm__row-val--warning">No count entered</span>
                        )}
                      </div>
                      {hasVariance ? (
                        <div className="tos-ops-confirm__row">
                          <span className="tos-ops-confirm__row-label">Open variance</span>
                          <MoneyValue minor={totalVariance} currencyCode={currencyCode} className="tos-ops-confirm__row-val tos-ops-confirm__row-val--danger" signed />
                        </div>
                      ) : null}
                    </div>
                    <div className="tos-row tos-row--between">
                      <Button variant="ghost" onClick={() => setConfirmClose(false)} disabled={busy}>Cancel</Button>
                      <Button variant="danger" onClick={() => handleAction("close-day")} loading={busy}>Close day &amp; finalize</Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="tos-section__foot">
                {canWrite && operatingDay ? (
                  operatingDay.status === "OPEN" ? (
                    confirmClose ? (
                      <span className="tos-section__sub">Review the summary above before finalizing.</span>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirmClose(true)} disabled={busy}>Close operating day</Button>
                    )
                  ) : (
                    <Button variant="gold" onClick={() => handleAction("open-day")} loading={busy}>Open operating day</Button>
                  )
                ) : null}
              </div>
            </section>

            {/* Shift card — secondary status */}
            <section className="tos-ops-shift-card tos-animate-fade-in-up">
              <div className="tos-ops-shift-card__head">
                <h2 className="tos-ops-shift-card__title">Shift</h2>
                <span className={`tos-badge ${shift ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                  <span className="tos-badge__dot" />{shift ? shift.status : "CLOSED"}
                </span>
              </div>
              <div className="tos-ops-shift-card__body">
                {shift ? (
                  <div className="tos-ops-shift-card__row">
                    <span className="tos-ops-shift-card__row-label">Opened</span>
                    <span className="tos-ops-shift-card__row-val">{new Date(shift.openedAt).toLocaleString()}</span>
                  </div>
                ) : (
                  <p className="tos-state__text"><IconClock style={{ width: 16, height: 16, verticalAlign: "middle", marginRight: 6 }} />No shift open. Open one to track cashier sessions.</p>
                )}
                {current ? (
                  <div className="tos-ops-shift-card__row">
                    <span className="tos-ops-shift-card__row-label">Open shifts</span>
                    <span className="tos-ops-shift-card__row-val">{current.openShiftCount}</span>
                  </div>
                ) : null}
              </div>
              {canWrite ? (
                <Button
                  variant={shift ? "danger" : "primary"}
                  block
                  loading={busy}
                  disabled={!operatingDay || operatingDay.status !== "OPEN"}
                  onClick={() => handleAction(shift ? "close-shift" : "open-shift")}
                >
                  {shift ? "Close shift" : "Open shift"}
                </Button>
              ) : null}
              {!operatingDay || operatingDay.status !== "OPEN" ? (
                <p className="tos-callout tos-callout--warning">Open an operating day before opening a shift.</p>
              ) : null}
            </section>
          </div>

          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              Operating days and shifts are evidence-grade.
              <span className="tos-callout__sub"> They reconcile against money-account balances and feed the cashbook automatically. The expected closing balance per method is computed server-side from the cashbook ledger — the client only submits the counted cash total. Variances are surfaced here for visibility, but the authoritative variance figure is the one the server records on close.</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
