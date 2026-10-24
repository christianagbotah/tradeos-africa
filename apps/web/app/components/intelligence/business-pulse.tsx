"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BusinessActionItem, BusinessAttentionItem, BusinessPulse } from "@tradeos/contracts";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";

export function BusinessPulsePanel() {
  const { session, queue } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [seenBusy, setSeenBusy] = useState(false);
  const [seenError, setSeenError] = useState<string | null>(null);
  const [awaitingFresh, setAwaitingFresh] = useState(false);
  const contextKey = session ? `${session.businessId}:${session.branchId ?? ""}` : "";
  const contextKeyRef = useRef(contextKey);
  const pulsePath = session && queue.online
    ? `/v1/intelligence/pulse?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=12`
    : null;
  const { data, loading, error, refetch, setData } = useApiFetch<BusinessPulse>(pulsePath);
  const pulseMatchesContext = Boolean(
    session && data && data.businessId === session.businessId && data.branchId === session.branchId,
  );
  const pulse = pulseMatchesContext ? data : null;
  const unseenCount = pulse?.unseenCount ?? 0;

  useEffect(() => {
    contextKeyRef.current = contextKey;
    setOpen(false);
    setAwaitingFresh(false);
    setSeenBusy(false);
    setSeenError(null);
  }, [contextKey]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  async function markSeen(snapshot: BusinessPulse) {
    const requestKey = `${snapshot.businessId}:${snapshot.branchId ?? ""}`;
    if (!session || !queue.online || seenBusy || snapshot.unseenCount < 1 || contextKeyRef.current !== requestKey) return;
    setSeenBusy(true);
    setSeenError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/intelligence/pulse/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: session.businessId, branchId: session.branchId }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const acknowledged = (await response.json()) as { lastSeenAt: string };
      if (contextKeyRef.current === requestKey) {
        setData({ ...snapshot, lastSeenAt: acknowledged.lastSeenAt, unseenCount: 0 });
      }
    } catch (markError) {
      if (contextKeyRef.current === requestKey) {
        setSeenError(markError instanceof Error ? markError.message : "Pulse could not be marked as seen.");
      }
    } finally {
      if (contextKeyRef.current === requestKey) setSeenBusy(false);
    }
  }

  useEffect(() => {
    if (!open || !awaitingFresh || loading) return;
    setAwaitingFresh(false);
  }, [open, awaitingFresh, loading]);

  useEffect(() => {
    if (!open || awaitingFresh || loading || !pulse || pulse.unseenCount < 1) return;
    void markSeen(pulse);
    // A failed seen request should not loop; retry occurs when the live Pulse snapshot changes or the drawer is reopened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, awaitingFresh, loading, pulse]);

  if (!session) return null;

  const openPulse = () => {
    setOpen(true);
    setSeenError(null);
    if (queue.online) {
      setAwaitingFresh(true);
      refetch();
    }
  };

  return (
    <>
      <button
        type="button"
        className="tos-pulse-trigger"
        aria-label={unseenCount > 0 ? `Business Pulse, ${unseenCount} unseen` : "Business Pulse"}
        aria-expanded={open}
        onClick={openPulse}
      >
        <span className="tos-pulse-trigger__dot" aria-hidden="true" />
        <span className="tos-pulse-trigger__label">Pulse</span>
        {unseenCount > 0 ? <span className="tos-pulse-trigger__badge">{unseenCount > 99 ? "99+" : unseenCount}</span> : null}
      </button>

      {open ? (
        <>
          <div className="tos-pulse-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
          <aside className="tos-pulse-drawer" role="dialog" aria-modal="true" aria-label="Business Pulse">
            <div className="tos-pulse-drawer__head">
              <div>
                <span className="tos-ai-eyebrow">TradeOS Intelligence</span>
                <h2>Business Pulse</h2>
                <p>What changed and what needs your attention now.</p>
              </div>
              <button type="button" className="tos-pulse-drawer__close" onClick={() => setOpen(false)} aria-label="Close Business Pulse">×</button>
            </div>

            <div className="tos-pulse-drawer__body">
              {!queue.online ? (
                <div className="tos-pulse-state">
                  <strong>Business Pulse is offline</strong>
                  <p>Fresh Pulse data requires a connection. Your core offline workflows remain available.</p>
                </div>
              ) : loading && !pulse ? (
                <div className="tos-pulse-state" aria-busy="true">
                  <strong>Refreshing Business Pulse…</strong>
                  <p>Checking the latest attention signals and review work.</p>
                </div>
              ) : error && !pulse ? (
                <div className="tos-pulse-state tos-pulse-state--error">
                  <strong>Could not load Business Pulse</strong>
                  <p>{error}</p>
                </div>
              ) : pulse ? (
                <>
                  <div className="tos-pulse-summary">
                    <div><strong>{pulse.attentionItems.length}</strong><span>attention signals</span></div>
                    <div><strong>{pulse.actionItems.length}</strong><span>review tasks</span></div>
                    <div><strong>{pulse.attentionSummary.CRITICAL + pulse.attentionSummary.HIGH}</strong><span>high priority</span></div>
                  </div>

                  {seenError ? <div className="tos-pulse-state tos-pulse-state--error"><p>{seenError}</p></div> : null}

                  <section className="tos-pulse-section">
                    <div className="tos-pulse-section__head"><h3>Needs attention</h3><span>{pulse.attentionItems.length}</span></div>
                    {pulse.attentionItems.length ? (
                      <div className="tos-pulse-list">
                        {pulse.attentionItems.map((item) => (
                          <Link key={item.id} href={pulseAttentionHref(item)} className="tos-pulse-row" onClick={() => setOpen(false)}>
                            <span className="tos-pulse-row__meta"><b data-severity={item.severity}>{item.severity}</b><time>{formatTime(item.lastSeenAt)}</time></span>
                            <strong>{item.title}</strong>
                            <p>{item.summary}</p>
                          </Link>
                        ))}
                      </div>
                    ) : <p className="tos-pulse-empty">No open attention signals for this branch.</p>}
                  </section>

                  <section className="tos-pulse-section">
                    <div className="tos-pulse-section__head"><h3>Review tasks</h3><span>{pulse.actionItems.length}</span></div>
                    {pulse.actionItems.length ? (
                      <div className="tos-pulse-list">
                        {pulse.actionItems.map((item) => (
                          <Link key={item.id} href={pulseActionHref(item)} className="tos-pulse-row" onClick={() => setOpen(false)}>
                            <span className="tos-pulse-row__meta"><b>{item.status === "SNOOZED" ? "SNOOZED" : "OPEN"}</b><time>{item.dueAt ? `Due ${formatTime(item.dueAt)}` : formatTime(item.createdAt)}</time></span>
                            <strong>{item.title}</strong>
                            <p>{item.reason}</p>
                          </Link>
                        ))}
                      </div>
                    ) : <p className="tos-pulse-empty">No active review tasks in your current queue.</p>}
                  </section>
                </>
              ) : null}
            </div>

            <div className="tos-pulse-drawer__foot">
              <span>{seenBusy ? "Marking seen…" : pulse ? `Updated ${formatTime(pulse.generatedAt)}` : "Evidence-backed · read-only"}</span>
              <Link href="/dashboard" onClick={() => setOpen(false)}>Open command center</Link>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}

export function pulseAttentionHref(item: BusinessAttentionItem): string {
  if (/RECEIVABLE|CUSTOMER/.test(item.ruleCode)) return "/customers";
  if (/PAYABLE|SUPPLIER/.test(item.ruleCode)) return "/purchases";
  if (/STOCK|WASTAGE|INVENTORY/.test(item.ruleCode)) return "/inventory";
  if (/CASH/.test(item.ruleCode)) return "/cashbook";
  if (/SALES|MARGIN|DATA/.test(item.ruleCode)) return "/reports";
  return "/dashboard";
}

export function pulseActionHref(item: BusinessActionItem): string {
  if (item.sourceEntityType === "CATALOG_ITEM") return "/inventory";
  if (item.sourceEntityType === "CUSTOMER") return "/customers";
  if (item.sourceEntityType === "SUPPLIER" || item.sourceEntityType === "PURCHASE") return "/purchases";
  if (item.actionType === "CREATE_REORDER_REVIEW") return "/purchases";
  if (item.actionType === "CREATE_RECEIVABLE_FOLLOW_UP") return "/customers";
  if (item.actionType === "CREATE_CASH_REVIEW") return "/cashbook";
  if (item.actionType === "CREATE_PERFORMANCE_REVIEW") return "/reports";
  return "/dashboard";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : value;
}
