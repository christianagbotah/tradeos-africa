"use client";

import { useEffect, useRef, useState } from "react";
import type { BusinessActionItem, BusinessActionListResponse, BusinessActionState, BusinessActionHistoryResponse, BusinessActionExplanation } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { BusinessAutomationPanel } from "./business-automation-panel";
import styles from "./business-action-queue.module.css";

const ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
export function BusinessActionQueue() {
  const { session, role, queue, account } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [history, setHistory] = useState<BusinessActionHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{scope:string; data:BusinessActionExplanation} | null>(null);
  const [explanationLoading, setExplanationLoading] = useState<string | null>(null);
  const explanationSequence = useRef(0);
  const allowed = ROLES.has(role);
  const context = session ? `${session.businessId}:${session.branchId}` : "";
  const contextRef = useRef(context);
  contextRef.current = context;
  const explanationScope = session && account && allowed && queue.online ? account.id + ":" + context + ":" + role : "";
  const explanationScopeRef = useRef(explanationScope);
  explanationScopeRef.current = explanationScope;
  useEffect(() => {
    ++explanationSequence.current;
    setExplanation(null);
    setExplanationLoading(null);
    return () => { ++explanationSequence.current; };
  }, [explanationScope]);

  const params = session && allowed && queue.online
    ? `businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const path = params ? `/v1/intelligence/actions?${params}` : null;
  const { data, loading, error, setData, refetch } = useApiFetch<BusinessActionListResponse>(path);

  if (!allowed || !session) return null;
  const items = queue.online && data && !error && !loading &&
    data.businessId === session.businessId && data.branchId === session.branchId
    ? data.items : null;

  async function generateTasks() {
    if (busy || !params || !queue.online) return;
    const priorContext = context;
    setBusy("generate");
    setMessage(null);
    setActionError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        `/v1/intelligence/actions/generate?${params}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as BusinessActionListResponse;
      if (contextRef.current === priorContext) {
        setData(result);
        setMessage(result.createdCount
          ? `${result.createdCount} new follow-up task(s) created from active alerts.`
          : "No new follow-up tasks. Existing alerts already have tasks or are informational.");
      }
    } catch (err) {
      if (contextRef.current === priorContext) {
        setActionError(err instanceof Error ? err.message : "Could not generate tasks.");
        refetch();
      }
    } finally {
      setBusy(null);
    }
  }

  async function changeState(item: BusinessActionItem, next: BusinessActionState) {
    if (busy || !params || !queue.online) return;
    const priorContext = context;
    setBusy(item.id);
    setMessage(null);
    setActionError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        `/v1/intelligence/actions/${encodeURIComponent(item.id)}?${params}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: next, expectedState: item.state }),
        },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      if (contextRef.current === priorContext) {
        setMessage("Task status updated and recorded in the audit history.");
        refetch();
      }
    } catch (err) {
      if (contextRef.current === priorContext) {
        setActionError(err instanceof Error ? err.message : "Could not update task.");
        refetch();
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleHistory(actionId: string) {
    if (history?.actionId === actionId) {
      setHistory(null);
      return;
    }
    if (!params || !queue.online) return;
    const priorContext = context;
    setHistory(null);
    setHistoryLoading(actionId);
    setActionError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        `/v1/intelligence/actions/${encodeURIComponent(actionId)}/history?${params}`,
        { method: "GET" },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as BusinessActionHistoryResponse;
      if (contextRef.current === priorContext &&
          result.businessId === session?.businessId && result.branchId === session?.branchId &&
          result.actionId === actionId) {
        setHistory(result);
      }
    } catch (err) {
      if (contextRef.current === priorContext) {
        setActionError(err instanceof Error ? err.message : "Could not load task history.");
      }
    } finally {
      setHistoryLoading(null);
    }
  }

  async function toggleExplanation(actionId: string) {
    if (!params || !explanationScope || explanationLoading) return;
    if (explanation?.scope === explanationScope && explanation.data.actionId === actionId) {
      setExplanation(null);
      return;
    }
    const requestedScope = explanationScope;
    const sequence = ++explanationSequence.current;
    setExplanation(null);
    setExplanationLoading(actionId);
    setActionError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        `/v1/intelligence/actions/${encodeURIComponent(actionId)}/explanation?${params}`,
        { method: "GET", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as BusinessActionExplanation;
      if (sequence === explanationSequence.current && explanationScopeRef.current === requestedScope &&
          result.businessId === session?.businessId && result.branchId === session?.branchId &&
          result.actionId === actionId) setExplanation({scope:requestedScope,data:result});
    } catch (err) {
      if (sequence === explanationSequence.current && explanationScopeRef.current === requestedScope)
        setActionError(err instanceof Error ? err.message : "Could not verify task origin.");
    } finally {
      if (sequence === explanationSequence.current) setExplanationLoading(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="merchant-follow-up-title">
      <div className={styles.header}>
        <div>
          <h3 className={styles.heading} id="merchant-follow-up-title">Owner follow-up tasks</h3>
          <p className={styles.description}>
            Convert current financial alerts into actionable tasks. No payments or stock changes are made.
          </p>
        </div>
        <button className={styles.primary} type="button" disabled={busy !== null || !queue.online}
          onClick={() => { void generateTasks(); }}>
          {busy === "generate" ? "Preparing…" : "Create tasks from alerts"}
        </button>
      </div>
      {!queue.online ? (
        <p className={styles.notice} role="status">Task management requires a connection. You can continue using the POS offline.</p>
      ) : error || actionError ? (
        <div className={styles.notice} role="alert">{actionError ?? error} <button className={styles.retry}
          type="button" onClick={refetch}>Refresh</button></div>
      ) : loading ? (
        <p className={styles.notice} role="status">Loading your follow-up tasks…</p>
      ) : items === null ? (
        <p className={styles.notice}>Task information is unavailable for the selected business.</p>
      ) : (
        <>
          {message ? <p className={styles.confirmation} role="status">{message}</p> : null}
          {items.length === 0 ? (
            <p className={styles.notice}>No follow-up tasks yet. Check your business alerts, then create tasks from them.</p>
          ) : (
            <ul className={styles.tasks}>
              {items.map((task) => (
                <li className={styles.task} key={task.id}>
                  <div className={styles.taskBody}>
                    <div className={styles.taskHeader}>
                      <span className={styles.state}>{task.state.replace("_", " ")}</span>
                      <strong>{task.title}</strong>
                    </div>
                    <p>{task.reason}</p>
                    <small>Updated {new Date(task.updatedAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</small>
                  </div>
                  <div className={styles.controls}>
                    {task.state === "OPEN" || task.state === "SNOOZED" ? (
                      <button className={styles.taskButton} type="button" disabled={busy !== null}
                        onClick={() => { void changeState(task, "DONE"); }}>Mark done</button>
                    ) : null}
                    {task.state === "OPEN" ? (
                      <button className={styles.taskButton} type="button" disabled={busy !== null}
                        onClick={() => { void changeState(task, "SNOOZED"); }}>Snooze</button>
                    ) : null}
                    {task.state === "DONE" || task.state === "SNOOZED" || task.state === "CANCELED" ? (
                      <button className={styles.taskButton} type="button" disabled={busy !== null}
                        onClick={() => { void changeState(task, "OPEN"); }}>Reopen</button>
                    ) : null}
                    <button className={styles.taskButton} type="button"
                      disabled={explanationLoading !== null || !explanationScope}
                      aria-expanded={explanation?.scope === explanationScope && explanation.data.actionId === task.id}
                      onClick={() => { void toggleExplanation(task.id); }}>
                      {explanationLoading === task.id ? "Loading…" : explanation?.scope === explanationScope && explanation.data.actionId === task.id ? "Hide explanation" : "Why this task?"}
                    </button>
                    <button className={styles.taskButton} type="button"
                      disabled={historyLoading !== null || !queue.online}
                      aria-expanded={history?.actionId === task.id}
                      onClick={() => { void toggleHistory(task.id); }}>
                      {historyLoading === task.id ? "Loading…" : history?.actionId === task.id ? "Hide history" : "History"}
                    </button>
                  </div>
                  {explanation?.scope === explanationScope && explanation.data.actionId === task.id ? (
                    <div className={styles.history}>
                      <h4>Why this task?</h4>
                      <p>{explanation.data.origin === "APPROVED_AUTOMATION"
                        ? "Created by an owner-approved automation from a business alert."
                        : explanation.data.origin === "ALERT"
                          ? "Created from a business alert."
                          : "The original source could not be verified."}</p>
                      <p><strong>Recorded reason:</strong> {explanation.data.recordedReason}</p>
                      {explanation.data.sourceAlert ? <p><strong>Current alert status:</strong> {explanation.data.sourceAlert.state.toLowerCase()} · {explanation.data.sourceAlert.severity.toLowerCase()} priority · last observed {new Date(explanation.data.sourceAlert.lastSeenAt).toLocaleString("en-GH")}</p> : null}
                      {explanation.data.approval ? <p>Approval recorded {new Date(explanation.data.approval.approvedAt).toLocaleString("en-GH")} · policy version {explanation.data.approval.policyVersion}</p> : null}
                      <p>For review only. This task does not post payments or stock changes.</p>
                    </div>
                  ) : null}
                  {history?.actionId === task.id ? (
                    <div className={styles.history}>
                      <h4>Task history</h4>
                      {history.events.length ? (
                        <ul>
                          {history.events.map((event) => (
                            <li key={event.id}>
                              <strong>{event.actorDisplayName}</strong>{" · "}
                              {event.eventType === "CREATED"
                                ? "created this task"
                                : `changed ${event.fromState} to ${event.toState}`}
                              {" · "}
                              {new Date(event.occurredAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}
                            </li>
                          ))}
                        </ul>
                      ) : <p>No recorded status changes.</p>}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <BusinessAutomationPanel />
    </section>
  );
}
