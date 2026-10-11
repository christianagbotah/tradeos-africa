"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconClock, IconOperations, IconRefresh } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";

interface CurrentOperations {
  operatingDay: { id: string; status: "OPEN" | "CLOSED"; openedAt: string; closedAt: string | null; balances: ReadonlyArray<{ method: string; openingCountedMinor: number; movementMinor: number; expectedClosingMinor: number; closingCountedMinor: number | null; varianceMinor: number | null }> } | null;
  shift: { id: string; status: "OPEN" | "CLOSED"; openedAt: string } | null;
  openShiftCount: number;
}

interface OperationsResponse {
  current: CurrentOperations;
}

export function OperationsWorkspace() {
  const { session, role, bump } = useWorkspace();
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashCounted, setCashCounted] = useState<number | null>(null);

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

  const handleAction = async (action: "open-day" | "close-day" | "open-shift" | "close-shift") => {
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
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump(); setCashCounted(null); setNonce((n) => n + 1);
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
          <div className="tos-grid-two">
            <div className="tos-section">
              <div className="tos-section__head">
                <h2 className="tos-section__title">Operating day</h2>
                <span className={`tos-badge ${current.operatingDay ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                  <span className="tos-badge__dot" />{current.operatingDay ? current.operatingDay.status : "CLOSED"}
                </span>
              </div>
              <div className="tos-section__body--padded tos-stack">
                {current.operatingDay ? (
                  <dl className="tos-kv">
                    <div><dt className="tos-kv__key">Opened</dt><dd className="tos-kv__val">{new Date(current.operatingDay.openedAt).toLocaleString()}</dd></div>
                    {current.operatingDay.closedAt ? <div><dt className="tos-kv__key">Closed</dt><dd className="tos-kv__val">{new Date(current.operatingDay.closedAt).toLocaleString()}</dd></div> : null}
                  </dl>
                ) : (
                  <p className="tos-state__text">No operating day is open. Open one to begin tracking.</p>
                )}
                {current.operatingDay?.balances.map((b, i) => (
                  <dl className="tos-kv" key={i}>
                    <div><dt className="tos-kv__key">{b.method} opening</dt><dd className="tos-kv__val"><MoneyValue minor={b.openingCountedMinor} currencyCode={currencyCode} tone="muted" /></dd></div>
                    <div><dt className="tos-kv__key">{b.method} movement</dt><dd className="tos-kv__val"><MoneyValue minor={b.movementMinor} currencyCode={currencyCode} /></dd></div>
                    <div><dt className="tos-kv__key">{b.method} expected</dt><dd className="tos-kv__val"><MoneyValue minor={b.expectedClosingMinor} currencyCode={currencyCode} /></dd></div>
                    {b.closingCountedMinor !== null ? (
                      <div><dt className="tos-kv__key">{b.method} counted</dt><dd className="tos-kv__val"><MoneyValue minor={b.closingCountedMinor} currencyCode={currencyCode} /></dd></div>
                    ) : null}
                    {b.varianceMinor !== null ? (
                      <div><dt className="tos-kv__key">{b.method} variance</dt><dd className="tos-kv__val"><MoneyValue minor={b.varianceMinor} currencyCode={currencyCode} tone={b.varianceMinor === 0 ? "positive" : "negative"} /></dd></div>
                    ) : null}
                  </dl>
                ))}
                {canWrite ? (
                  <MoneyInput currencyCode={currencyCode} valueMinor={cashCounted} onChange={setCashCounted} label="Counted cash (for open/close)" hint="Used as the opening or closing balance for the cash drawer." />
                ) : null}
                {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
                {canWrite ? (
                  <Button
                    variant={current.operatingDay ? "danger" : "gold"}
                    block
                    loading={busy}
                    onClick={() => handleAction(current.operatingDay ? "close-day" : "open-day")}
                  >
                    {current.operatingDay ? "Close operating day" : "Open operating day"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="tos-section">
              <div className="tos-section__head">
                <h2 className="tos-section__title">Shift</h2>
                <span className={`tos-badge ${current.shift ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                  <span className="tos-badge__dot" />{current.shift ? current.shift.status : "CLOSED"}
                </span>
              </div>
              <div className="tos-section__body--padded tos-stack">
                {current.shift ? (
                  <dl className="tos-kv">
                    <div><dt className="tos-kv__key">Opened</dt><dd className="tos-kv__val">{new Date(current.shift.openedAt).toLocaleString()}</dd></div>
                  </dl>
                ) : (
                  <p className="tos-state__text"><IconClock style={{ width: 16, height: 16, verticalAlign: "middle", marginRight: 6 }} />No shift open. Open one to track cashier sessions.</p>
                )}
                {canWrite ? (
                  <Button
                    variant={current.shift ? "danger" : "primary"}
                    block
                    loading={busy}
                    disabled={!current.operatingDay}
                    onClick={() => handleAction(current.shift ? "close-shift" : "open-shift")}
                  >
                    {current.shift ? "Close shift" : "Open shift"}
                  </Button>
                ) : null}
                {!current.operatingDay ? <p className="tos-callout tos-callout--warning">Open an operating day before opening a shift.</p> : null}
              </div>
            </div>
          </div>
          <div className="tos-callout">
            Operating days and shifts are evidence-grade. They reconcile against money-account balances and feed the cashbook automatically.
          </div>
        </>
      )}
    </div>
  );
}
