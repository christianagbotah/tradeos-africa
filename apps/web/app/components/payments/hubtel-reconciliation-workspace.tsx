"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./hubtel-reconciliation-workspace.module.css";

type State = "PREPARED" | "READY" | "PENDING_VERIFICATION" |
  "RECONCILED" | "REVIEW_REQUIRED";
interface Item {
  attemptId: string;
  saleId: string;
  branchId: string;
  state: State;
  saleStatus: string;
  paymentStatus: string;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  statusCheckAttempts: number;
  lastStatusResult: string | null;
  lastErrorCode: string | null;
  reviewRequestedAt: string | null;
}
type Report = {
  attempts: Item[];
  summary: { awaiting: number; reviewRequired: number; reconciled: number };
};
type Readiness = { enabled: boolean; notice: string };
function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra",
  }).format(new Date(value));
}
function stateName(state: State): string {
  if (state === "REVIEW_REQUIRED") return "Review required";
  if (state === "RECONCILED") return "Payment confirmed";
  if (state === "PREPARED") return "Checkout preparation";
  if (state === "PENDING_VERIFICATION") return "Waiting for status";
  return "Checkout initiated";
}
export function HubtelReconciliationWorkspace() {
  const { session, role, queue } = useWorkspace();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRead = ["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role);
  const canVerify = ["OWNER","ADMIN","MANAGER"].includes(role);
  const base = session && canRead ?
    `businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
      : null;
  const {
    data, error: loadError, loading, refetch,
  } = useApiFetch<Report>(base ? `/v1/payments/hubtel/reconciliation?${base}` : null);
  const { data: readiness } = useApiFetch<Readiness>(
    session && canRead ?
      `/v1/payments/hubtel/readiness?businessId=${encodeURIComponent(session.businessId)}` : null,
  );

  async function verify(item: Item) {
    if (!session || !canVerify || !readiness?.enabled || !queue.online || busyId) return;
    setBusyId(item.attemptId);
    setMessage(null);setError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        `/v1/sales/${encodeURIComponent(item.saleId)}/hubtel/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: session.businessId }),
        },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as { result: { state: string } };
      setMessage(result.result.state === "PAID" ?
        "Hubtel independently confirmed payment. The sale is now settled." :
        result.result.state === "UNPAID" ?
        "Hubtel reports unpaid. The sale and stock remain on hold until safe resolution." :
        "A refunded payment needs manual accounting review. No new receipt was posted.");
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify with Hubtel");
    } finally {
      setBusyId(null);
    }
  }

  if (!canRead) {
    return <div className={styles.workspace}>
      <h1>MoMo reconciliation</h1>
      <p>Only business owners, administrators, managers and accountants can review payment status.</p>
    </div>;
  }

  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>TradeOS Africa · Payment controls</p>
        <h1>Hubtel payment reconciliation</h1>
        <p>Monitor pending collections, provider status checks and cases needing review.</p>
      </div>
      <div className={styles.actions}>
        <Link href="/operations" className={styles.secondary}>Operations</Link>
        <button type="button" onClick={refetch} className={styles.secondary}>Refresh</button>
      </div>
    </header>

    <div className={styles.notice}>
      <strong>{readiness?.enabled ? "Merchant payments configured" : "Live merchant collection is not enabled"}</strong>
      <p>TradeOS records payment only after independently confirming it with Hubtel.
        Missing status or an “Unpaid” result never automatically returns stock or generates a receipt.</p>
    </div>
    <div className={styles.stats}>
      <div><span>Awaiting checks</span><strong>{data?.summary.awaiting ?? "—"}</strong></div>
      <div><span>Needs review</span><strong>{data?.summary.reviewRequired ?? "—"}</strong></div>
      <div><span>Confirmed</span><strong>{data?.summary.reconciled ?? "—"}</strong></div>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {loadError ? <p role="alert" className={styles.error}>{loadError}</p> : null}
    {message ? <p role="status" className={styles.success}>{message}</p> : null}
    {loading ? <p>Loading transaction status…</p> :
      data?.attempts.length === 0 ? <div className={styles.empty}>
        No Hubtel sales collections for this branch yet. Existing cash, bank and other
        transactions are managed in Sales and Cashbook.
      </div> :
      <section className={styles.list} aria-label="Hubtel payment attempts">
        {data?.attempts.map(item => <article key={item.attemptId} className={styles.item}>
          <div className={styles.itemHeader}>
            <div><strong>Sale {item.saleId.slice(0,8).toUpperCase()}</strong>
              <span className={styles.itemDate}>Created {date(item.createdAt)}</span></div>
            <span className={item.state === "REVIEW_REQUIRED" ? styles.warning : styles.state}>
              {stateName(item.state)}</span>
          </div>
          <p className={styles.money}>{formatMoney(item.amountMinor,item.currencyCode)}</p>
          <div className={styles.details}>
            <div><span>Sale / payment</span><strong>{item.saleStatus} / {item.paymentStatus}</strong></div>
            <div><span>Status checks</span><strong>{item.statusCheckAttempts}</strong></div>
            <div><span>Last checked</span><strong>{date(item.lastCheckedAt)}</strong></div>
            <div><span>Next automatic check</span><strong>{date(item.nextCheckAt)}</strong></div>
          </div>
          {item.lastErrorCode ? <p className={styles.failure}>
            Provider check: <strong>{item.lastErrorCode.replaceAll("_"," ")}</strong></p> : null}
          {item.state==="REVIEW_REQUIRED"?<p className={styles.review}>
            Do not release goods, reverse inventory or treat this as an unpaid cancellation
            without confirming the final settlement status with Hubtel.</p>:null}
          <div className={styles.actions}>
            <Link href="/sales" className={styles.secondary}>Sales register</Link>
            {canVerify&&item.state!=="RECONCILED" ? <button
              type="button" className={styles.primary}
              disabled={!readiness?.enabled || !queue.online || busyId!==null}
              onClick={()=>void verify(item)}>
              {busyId===item.attemptId ? "Checking…" : "Verify with Hubtel"}</button> : null}
          </div>
        </article>)}
      </section>}
    <footer className={styles.footer}>
      <p>Live status verification uses merchant-specific server credentials. No provider
        credentials, merchant account numbers or payment callbacks are shown here.</p>
      <p>For unresolved transactions, contact your Hubtel merchant support or TradeOS
        administrator with the sale reference before adjusting inventory.</p>
    </footer>
  </main>;
}
