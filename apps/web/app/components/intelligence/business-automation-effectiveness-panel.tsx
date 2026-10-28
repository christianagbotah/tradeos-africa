"use client";

import type { BusinessAutomationEffectiveness } from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { useWorkspace } from "../workspace/use-workspace";
import { canManageBusinessAutomations } from "./business-automations";
import { automationEffectivenessPolicyState } from "./business-automation-effectiveness";

interface BusinessAutomationEffectivenessPanelProps {
  reviewablePolicyIds?: ReadonlySet<string>;
  onReviewPolicy?: (policyId: string) => void;
}

export function BusinessAutomationEffectivenessPanel({ reviewablePolicyIds, onReviewPolicy }: BusinessAutomationEffectivenessPanelProps) {
  const { session, role, queue } = useWorkspace();
  const allowed = canManageBusinessAutomations(role);
  const path = allowed && session && queue.online
    ? `/v1/intelligence/automation-effectiveness?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const effectiveness = useApiFetch<BusinessAutomationEffectiveness>(path);

  if (!allowed || !session) return null;

  if (!queue.online) {
    return (
      <section className="tos-ai-effectiveness" data-state="offline">
        <span className="tos-ai-eyebrow">AI effectiveness · Last 30 days</span>
        <p className="tos-ai-effectiveness__degraded">Effectiveness unavailable offline. Reconnect to refresh review outcomes; automation controls keep their existing offline behavior.</p>
      </section>
    );
  }

  if (effectiveness.loading && !effectiveness.data) {
    return (
      <section className="tos-ai-effectiveness" data-state="loading">
        <StatePanel inline bare variant="loading" title="Loading AI effectiveness" text="Summarizing the last 30 days of automated review work." />
      </section>
    );
  }

  if (effectiveness.error && !effectiveness.data) {
    return (
      <section className="tos-ai-effectiveness" data-state="error">
        <StatePanel inline bare variant="error" title="Effectiveness could not be loaded" text={effectiveness.error} actionLabel="Retry" onAction={() => effectiveness.refetch()} />
      </section>
    );
  }

  const data = effectiveness.data;
  if (!data) return null;

  return (
    <section className="tos-ai-effectiveness" data-state="live" aria-labelledby="tradeos-ai-effectiveness-title">
      <div className="tos-ai-effectiveness__head">
        <div>
          <span className="tos-ai-eyebrow">AI effectiveness · Last 30 days</span>
          <h3 id="tradeos-ai-effectiveness-title">How useful is the automated review work?</h3>
          <p>Transparent outcomes from internal AI review tasks. This view does not change policy behavior or hide alerts.</p>
        </div>
        <span className="tos-ai-cache-state">Live · {formatTimestamp(data.generatedAt)}</span>
      </div>

      <div className="tos-ai-effectiveness__kpis">
        <EffectivenessKpi label="Tasks created" value={String(data.summary.automatedTasksCreated)} />
        <EffectivenessKpi label="Completion rate" value={formatPercent(data.summary.completionRate)} />
        <EffectivenessKpi label="Relevant outcomes" value={formatPercent(data.summary.relevantOutcomeRate)} />
        <EffectivenessKpi label="Median review time" value={formatDuration(data.summary.medianCompletionHours)} />
      </div>

      <div className="tos-ai-effectiveness__outcomes" aria-label="Review outcome breakdown">
        <OutcomeChip label="Resolved" value={data.outcomes.resolved} />
        <OutcomeChip label="Already handled" value={data.outcomes.alreadyHandled} />
        <OutcomeChip label="Not relevant" value={data.outcomes.notRelevant} />
        <OutcomeChip label="No action needed" value={data.outcomes.noActionNeeded} />
      </div>

      <div className="tos-ai-effectiveness__context">
        {data.summary.manualEntityReviewsCreated} manual AI-assisted review task{data.summary.manualEntityReviewsCreated === 1 ? "" : "s"} created in the same period; excluded from automation rates.
      </div>

      {data.tuningRecommendations.length > 0 ? (
        <div className="tos-ai-effectiveness-tuning" aria-label="Automation tuning suggestions">
          <div className="tos-ai-effectiveness-tuning__head">
            <div>
              <strong>Tuning suggestions</strong>
              <span>Deterministic guidance from the review outcomes above. TradeOS does not change policy settings automatically.</span>
            </div>
          </div>
          <div className="tos-ai-effectiveness-tuning__list">
            {data.tuningRecommendations.map((recommendation) => {
              const canReview = Boolean(onReviewPolicy && reviewablePolicyIds?.has(recommendation.policyId));
              return (
                <article key={`${recommendation.policyId}:${recommendation.kind}`} className="tos-ai-effectiveness-tuning__item" data-priority={recommendation.priority.toLowerCase()}>
                  <div className="tos-ai-effectiveness-tuning__copy">
                    <span className="tos-ai-effectiveness-tuning__priority">{recommendation.priority} · {recommendation.focus === "TRIGGER" ? "Trigger" : "Workflow"}</span>
                    <strong>{recommendation.title}</strong>
                    <p>{recommendation.summary}</p>
                    <small>{recommendation.rationale}</small>
                  </div>
                  {canReview ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onReviewPolicy?.(recommendation.policyId)}>
                      Review policy
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="tos-ai-effectiveness__policies">
        {data.policies.map((policy) => {
          const state = automationEffectivenessPolicyState(policy);
          return (
            <article key={policy.policyId} className="tos-ai-effectiveness-policy">
              <div className="tos-ai-effectiveness-policy__head">
                <div>
                  <strong>{policy.name}</strong>
                  <span>{policy.enabled ? "Enabled" : "Disabled"} · {policy.tasksCreated} task{policy.tasksCreated === 1 ? "" : "s"}</span>
                </div>
                <span className={`tos-ai-effectiveness-policy__state tos-ai-effectiveness-policy__state--${stateToken(state)}`}>{state}</span>
              </div>
              <div className="tos-ai-effectiveness-policy__metrics">
                <span>{formatPercent(policy.completionRate)} completed</span>
                <span>{formatPercent(policy.relevantOutcomeRate)} relevant</span>
                <span>{policy.negativeOutcomes} low-value outcome{policy.negativeOutcomes === 1 ? "" : "s"}</span>
                <span>{formatDuration(policy.medianCompletionHours)} median review</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EffectivenessKpi({ label, value }: { label: string; value: string }) {
  return <div className="tos-ai-effectiveness-kpi"><span>{label}</span><strong>{value}</strong></div>;
}

function OutcomeChip({ label, value }: { label: string; value: number }) {
  return <span className="tos-ai-effectiveness-outcome"><strong>{value}</strong>{label}</span>;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "now";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function stateToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}
