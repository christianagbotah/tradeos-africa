"use client";

import { useEffect, useRef, useState } from "react";
import type {
  MerchantAlertThreshold, MerchantAutomationRun, MerchantAutomationView,
} from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./business-automation-panel.module.css";

type Draft = { enabled: boolean; minSeverity: MerchantAlertThreshold; expectedVersion: number | null };

export function BusinessAutomationPanel() {
  const { session, role, queue } = useWorkspace();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const isOwner = role === "OWNER";
  const context = session ? session.businessId + ":" + session.branchId : "";
  const contextRef = useRef(context);
  contextRef.current = context;
  const params = session && isOwner && queue.online
    ? "businessId=" + encodeURIComponent(session.businessId) +
      "&branchId=" + encodeURIComponent(session.branchId)
    : null;
  const { data, loading, error, setData, refetch } = useApiFetch<MerchantAutomationView>(
    params ? "/v1/intelligence/automation?" + params : null,
  );
  const inScope = !!data && !!session && data.businessId === session.businessId && data.branchId === session.branchId;
  const view = queue.online && inScope && !error && !loading ? data : null;

  useEffect(() => {
    if (!view) {
      setDraft(null);
      return;
    }
    setDraft({
      enabled: view.policy?.enabled ?? false,
      minSeverity: view.policy?.minSeverity ?? "HIGH",
      expectedVersion: view.policy?.policyVersion ?? null,
    });
  }, [view?.policy?.policyVersion, view?.policy?.enabled, view?.policy?.minSeverity, context, Boolean(view)]);

  if (!session || !isOwner) return null;

  async function request(
    path: string, method: "POST" | "PUT",
    body: Record<string, unknown> | undefined,
    pendingLabel: string,
    successLabel: (result: MerchantAutomationView & { proposedCount?: number }) => string,
  ) {
    if (busy || !params || !queue.online) return;
    const before = context;
    setBusy(pendingLabel);
    setErrorText(null);
    setNotice(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        path + "?" + params,
        {
          method,
          ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
        },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as MerchantAutomationView & { proposedCount?: number };
      if (contextRef.current === before && result.businessId === session?.businessId &&
          result.branchId === session?.branchId) {
        setData(result);
        setNotice(successLabel(result));
        refetch();
      }
    } catch (err) {
      if (contextRef.current === before) {
        setErrorText(err instanceof Error ? err.message : "Automation request failed.");
        refetch();
      }
    } finally {
      setBusy(null);
    }
  }

  async function decide(run: MerchantAutomationRun, decision: "APPROVE" | "REJECT") {
    if (busy || !params || !queue.online) return;
    const before = context;
    setBusy(run.id);
    setErrorText(null);
    setNotice(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        "/v1/intelligence/automation/runs/" + encodeURIComponent(run.id) +
          "/decision?" + params,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }) },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      if (contextRef.current === before) {
        setNotice(decision === "APPROVE"
          ? "Approved. The follow-up task is available in the task queue."
          : "Proposal rejected and recorded.");
        refetch();
      }
    } catch (err) {
      if (contextRef.current === before) {
        setErrorText(err instanceof Error ? err.message : "Could not process this proposal.");
        refetch();
      }
    } finally {
      setBusy(null);
    }
  }

  const canSave = !!draft && !busy && !!view && queue.online &&
    (draft.enabled !== (view.policy?.enabled ?? false) ||
     draft.minSeverity !== (view.policy?.minSeverity ?? "HIGH") ||
     !view.policy);
  return (
    <section className={styles.panel} aria-labelledby="merchant-automation-title">
      <div className={styles.headingRow}>
        <div>
          <h3 id="merchant-automation-title" className={styles.title}>Approval-controlled automation</h3>
          <p className={styles.subtitle}>
            Let TradeOS prepare follow-up tasks from business alerts. You choose which tasks to approve.
            No payments, refunds or inventory transactions are performed.
          </p>
        </div>
        <span className={styles.mode}>Owner approval required</span>
      </div>
      {!queue.online ? (
        <p className={styles.notice} role="status">Automation settings are only available online. Sales can continue offline.</p>
      ) : loading || !view || !draft ? (
        <p className={styles.notice} role="status">
          {error ? "Could not load automation settings: " + error : "Loading approval settings…"}
        </p>
      ) : (
        <>
          <div className={styles.settings}>
            <label className={styles.toggle}>
              <input type="checkbox" checked={draft.enabled} disabled={!!busy}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
              <span>Prepare tasks automatically from qualifying alerts</span>
            </label>
            <label className={styles.threshold}>
              Minimum alert severity
              <select value={draft.minSeverity} disabled={!!busy}
                onChange={(event) => setDraft({
                  ...draft, minSeverity: event.target.value as MerchantAlertThreshold,
                })}>
                <option value="MEDIUM">Medium and above</option>
                <option value="HIGH">High and critical</option>
                <option value="CRITICAL">Critical only</option>
              </select>
            </label>
            <div className={styles.buttons}>
              <button className={styles.primary} type="button" disabled={!canSave}
                onClick={() => { void request("/v1/intelligence/automation/config", "PUT", draft, "settings",
                  () => "Your approval policy was saved. Previous pending proposals were invalidated."); }}>
                {busy === "settings" ? "Saving…" : "Save policy"}
              </button>
              <button className={styles.secondary} type="button" disabled={!!busy || !view.policy?.enabled}
                onClick={() => { void request("/v1/intelligence/automation/propose", "POST",
                  undefined, "check", (result) => (result.proposedCount ?? 0) +
                    " new proposal(s) prepared for your approval."); }}>
                {busy === "check" ? "Checking…" : "Check proposals"}
              </button>
            </div>
          </div>
          {errorText ? <p className={styles.error} role="alert">{errorText}</p> : null}
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          <div className={styles.queueHeading}>
            <h4>Awaiting your approval</h4>
            <span>{view.pending.length} pending</span>
          </div>
          {view.pending.length ? (
            <ul className={styles.proposals}>
              {view.pending.map((run) => (
                <li key={run.id} className={styles.proposal}>
                  <div className={styles.proposalBody}>
                    <strong>{run.title}</strong>
                    <p>{run.summary}</p>
                    <small>{run.severity} alert · Proposed {new Date(run.createdAt).toLocaleString("en-GH",
                      { dateStyle: "medium", timeStyle: "short" })}</small>
                  </div>
                  <div className={styles.buttons}>
                    <button type="button" className={styles.primary} disabled={!!busy}
                      onClick={() => { void decide(run, "APPROVE"); }}>
                      {busy === run.id ? "Working…" : "Approve task"}
                    </button>
                    <button type="button" className={styles.secondary} disabled={!!busy}
                      onClick={() => { void decide(run, "REJECT"); }}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.notice}>
              {view.policy?.enabled
                ? "There are no pending approvals. TradeOS will prepare proposals when qualifying alerts are evaluated."
                : "Automation is disabled. Enable and save the policy to start proposing tasks."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
