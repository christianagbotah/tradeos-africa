"use client";

import { useState } from "react";
import Link from "next/link";
import type { BusinessAttentionResponse } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./business-attention-panel.module.css";

const FINANCIAL_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export function BusinessAttentionPanel() {
  const { session, role, queue } = useWorkspace();
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const allowed = FINANCIAL_ROLES.has(role);
  const scope = session && allowed && queue.online
    ? `businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const path = scope ? `/v1/intelligence/attention?${scope}` : null;
  const { data, loading, error, setData, refetch } = useApiFetch<BusinessAttentionResponse>(path);
  if (!allowed || !session) return null;

  const sameScope = !!data && data.businessId === session.businessId && data.branchId === session.branchId;
  const alerts = queue.online && sameScope && !loading && !error ? data.items : null;

  async function checkBusinessAlerts() {
    if (!scope || evaluating || !queue.online) return;
    setEvaluating(true);
    setEvaluationError(null);
    try {
      const res = await getOfflineQueue().authenticatedFetch(
        `/v1/intelligence/attention/evaluate?${scope}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readApiErrorMessage(res));
      const updated = (await res.json()) as BusinessAttentionResponse;
      // A business or branch switch can complete while an old request is in flight.
      // Never render results unless their server scope matches the current workspace.
      setData(updated);
    } catch (err) {
      setEvaluationError(err instanceof Error ? err.message : "Could not check business alerts.");
      refetch();
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="business-alerts-heading">
      <div className={styles.header}>
        <div>
          <h3 id="business-alerts-heading" className={styles.heading}>Business alerts</h3>
          <p className={styles.description}>
            Saved warnings based on recorded financial and customer/supplier payment information.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void checkBusinessAlerts(); }}
          disabled={evaluating || !queue.online}
          className={styles.checkButton}
        >
          {evaluating ? "Checking…" : "Check alerts"}
        </button>
      </div>
      {!queue.online ? (
        <p className={styles.hint} role="status">Reconnect to view or check current alerts. Offline sales are not blocked.</p>
      ) : error ? (
        <p role="alert" className={styles.hint}>Could not load alerts: {error}</p>
      ) : evaluationError ? (
        <p role="alert" className={styles.hint}>Alert check failed: {evaluationError}</p>
      ) : loading ? (
        <p className={styles.hint} role="status">Loading your saved alerts…</p>
      ) : alerts === null ? (
        <p className={styles.hint}>No saved alert information is available.</p>
      ) : alerts.length === 0 ? (
        <p className={styles.hint}>No active saved alerts. Use “Check alerts” to evaluate your latest records.</p>
      ) : (
        <>
          <ul className={styles.list}>
            {alerts.map((item) => (
              <li key={item.id} className={styles.item}>
                <div className={styles.itemHeading}>
                  <span className={styles.severity}>{item.severity}</span>
                  <strong>{item.title}</strong>
                </div>
                <p>{item.summary}</p>
                <small>Last evaluated {new Date(item.lastSeenAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</small>
              </li>
            ))}
          </ul>
          <Link href="/reports" className={styles.link}>Review supporting financial reports</Link>
        </>
      )}
    </section>
  );
}
