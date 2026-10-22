"use client";

import { useMemo, useState } from "react";
import type { BusinessAutomationPolicy, BusinessAutomationRun } from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { useWorkspace } from "../workspace/use-workspace";
import {
  canControlBusinessAutomationPolicy,
  canManageBusinessAutomations,
  mutateBusinessAutomationPolicy,
  relevantBusinessAutomationPolicies,
  runBusinessAutomationNow,
} from "./business-automations";

interface AutomationPoliciesResponse {
  policies: BusinessAutomationPolicy[];
}

interface RunFeedback {
  policyId: string;
  run: BusinessAutomationRun;
}

export function BusinessAutomationsPanel() {
  const { session, role, queue } = useWorkspace();
  const allowed = canManageBusinessAutomations(role);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunFeedback | null>(null);

  const policiesPath = allowed && session && queue.online
    ? `/v1/intelligence/automations?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const policiesQuery = useApiFetch<AutomationPoliciesResponse>(policiesPath);
  const policies = useMemo(
    () => session
      ? relevantBusinessAutomationPolicies(policiesQuery.data?.policies ?? [], session.branchId)
      : [],
    [policiesQuery.data, session],
  );

  if (!allowed || !session) return null;

  const togglePolicy = async (policy: BusinessAutomationPolicy) => {
    if (!queue.online || busyKey) return;
    const key = `${policy.id}:toggle`;
    setBusyKey(key);
    setMutationError(null);
    setLastRun(null);
    try {
      const updated = await mutateBusinessAutomationPolicy(
        (input, init) => getOfflineQueue().authenticatedFetch(input, init),
        { policy, businessId: session.businessId, enabled: !policy.enabled },
      );
      policiesQuery.setData({
        policies: (policiesQuery.data?.policies ?? []).map((candidate) => candidate.id === updated.id ? updated : candidate),
      });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Automation policy could not be updated.");
      policiesQuery.refetch();
    } finally {
      setBusyKey(null);
    }
  };

  const runNow = async (policy: BusinessAutomationPolicy) => {
    if (!queue.online || busyKey || !policy.enabled) return;
    const key = `${policy.id}:run`;
    setBusyKey(key);
    setMutationError(null);
    setLastRun(null);
    try {
      const correlationId = `manual:${policy.id}:${Date.now()}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const run = await runBusinessAutomationNow(
        (input, init) => getOfflineQueue().authenticatedFetch(input, init),
        {
          policy,
          businessId: session.businessId,
          branchId: session.branchId,
          correlationId,
        },
      );
      setLastRun({ policyId: policy.id, run });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Automation could not be run.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="tos-ai-automations" aria-labelledby="tradeos-ai-automations-title">
      <div className="tos-ai-automations__head">
        <div>
          <span className="tos-ai-eyebrow">AI workflow control</span>
          <h2 id="tradeos-ai-automations-title">AI Automations</h2>
          <p>Review and control safe workflow automations for this business. These automations create internal work items only; they do not move money, issue refunds, or change stock directly.</p>
        </div>
        <span className="tos-ai-count">{policies.length}</span>
      </div>

      {!queue.online ? (
        <div className="tos-ai-automation-offline" role="status">
          Reconnect to review or change automation policies. Offline sales and sync workflows remain available separately.
        </div>
      ) : policiesQuery.loading ? (
        <StatePanel inline bare variant="loading" title="Loading automations" text="Reading the latest policy controls for this business." />
      ) : policiesQuery.error ? (
        <StatePanel
          inline
          bare
          variant="error"
          title="Automations could not be loaded"
          text={policiesQuery.error}
          actionLabel="Retry"
          onAction={() => policiesQuery.refetch()}
        />
      ) : policies.length === 0 ? (
        <StatePanel
          inline
          bare
          variant="empty"
          title="No automations configured"
          text="There are no approved AI workflow policies for this business or Current branch yet."
        />
      ) : (
        <div className="tos-ai-automation-list">
          {mutationError ? <div className="tos-ai-error" role="alert">{mutationError}</div> : null}
          {policies.map((policy) => {
            const toggleKey = `${policy.id}:toggle`;
            const runKey = `${policy.id}:run`;
            const runFeedback = lastRun?.policyId === policy.id ? lastRun.run : null;
            const canControl = canControlBusinessAutomationPolicy(role, policy);
            return (
              <article className="tos-ai-automation-card" key={policy.id}>
                <div className="tos-ai-automation-card__body">
                  <div className="tos-ai-automation-card__title-row">
                    <div>
                      <h3>{policy.name}</h3>
                      <p>{policy.description ?? "Approved TradeOS workflow automation."}</p>
                    </div>
                    <span className="tos-ai-automation-status">{policy.enabled ? "Enabled" : "Paused"}</span>
                  </div>
                  <div className="tos-ai-automation-meta">
                    <span><strong>Scope:</strong> {policy.branchId === null ? "Business-wide" : "Current branch"}</span>
                    <span><strong>Trigger:</strong> {humanize(policy.triggerType)}</span>
                    <span><strong>Action:</strong> {humanize(policy.actionType)}</span>
                    <span><strong>Version:</strong> {policy.policyVersion}</span>
                    {!canControl ? <span><strong>Access:</strong> Owner/Admin control</span> : null}
                  </div>
                  {runFeedback ? (
                    <div className="tos-ai-automation-feedback" role="status">
                      Last run: {humanize(runFeedback.state)}
                      {runFeedback.errorMessage ? ` · ${runFeedback.errorMessage}` : " · workflow result recorded"}
                    </div>
                  ) : null}
                </div>
                <div className="tos-ai-automation-card__actions">
                  <Button
                    size="sm"
                    variant={policy.enabled ? "outline" : "positive"}
                    loading={busyKey === toggleKey}
                    disabled={!queue.online || Boolean(busyKey) || !canControl}
                    title={canControl ? undefined : "This policy requires Owner or Admin control"}
                    onClick={() => void togglePolicy(policy)}
                  >
                    {policy.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="gold"
                    loading={busyKey === runKey}
                    disabled={!queue.online || Boolean(busyKey) || !policy.enabled || !canControl}
                    title={!canControl
                      ? "This policy requires Owner or Admin control"
                      : policy.enabled ? "Run this approved automation now" : "Enable this automation before running it"}
                    onClick={() => void runNow(policy)}
                  >
                    Run now
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
