"use client";

import { useRef, useState } from "react";
import type { BusinessActionItem, BusinessActionListResponse, BusinessActionState } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./business-action-queue.module.css";

const ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
export function BusinessActionQueue() {
  const { session, role, queue } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const allowed = ROLES.has(role);
  const context = session ? `${session.businessId}:${session.branchId}` : "";
  const contextRef = useRef(context);
  contextRef.current = context;

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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
