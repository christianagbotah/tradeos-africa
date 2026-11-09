"use client";

import Link from "next/link";
import type { BusinessBriefing } from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { useWorkspace } from "../workspace/use-workspace";
import {
  contextualWorkflowHref,
  selectContextualIntelligence,
  type ContextualIntelligenceSurface,
} from "./contextual-intelligence";

interface ContextualIntelligencePanelProps {
  surface: ContextualIntelligenceSurface;
}

export function ContextualIntelligencePanel({ surface }: ContextualIntelligencePanelProps) {
  const { session, queue } = useWorkspace();
  const range = surface === "reports" ? "month" : "today";
  const briefingPath = session && queue.online
    ? `/v1/intelligence/briefing?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&range=${range}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<BusinessBriefing>(briefingPath);

  if (!session) return null;

  if (!queue.online) {
    return (
      <section className="tos-context-ai" data-surface={surface} data-state="offline">
        <StatePanel
          inline
          variant="empty"
          title="Contextual intelligence is offline"
          text="Reconnect for fresh evidence and Ask TradeOS. Core offline workflows remain available and no AI-guided economic action can run while disconnected."
        />
        <div className="tos-context-ai__offline-actions">
          <Button variant="outline" size="sm" disabled={!queue.online}>Ask TradeOS</Button>
        </div>
      </section>
    );
  }

  if (loading && !data) {
    return (
      <section className="tos-context-ai tos-context-ai--loading" data-surface={surface} aria-busy="true">
        <span className="tos-skeleton tos-skeleton--line-short" />
        <span className="tos-skeleton tos-skeleton--block" />
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="tos-context-ai" data-surface={surface} data-state="error">
        <StatePanel
          inline
          variant="error"
          title="Could not load contextual intelligence"
          text={error}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </section>
    );
  }

  if (!data) return null;
  const view = selectContextualIntelligence(data, surface);
  const attentionItems = view.attentionItems.slice(0, 3);
  const recommendations = view.recommendations.slice(0, 2);

  const askTradeOS = () => {
    if (!queue.online || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("tradeos:ask", {
      detail: { question: view.askPrompt },
    }));
  };

  return (
    <section className="tos-context-ai" data-surface={surface} data-state="live">
      <div className="tos-context-ai__head">
        <div className="tos-context-ai__heading">
          <span className="tos-ai-eyebrow">TradeOS Intelligence · In context</span>
          <h2>{view.label}</h2>
          <p>{view.summary}</p>
        </div>
        <div className="tos-context-ai__meta">
          <span className={`tos-ai-confidence tos-ai-confidence--${view.confidence.level.toLowerCase()}`}>
            {view.confidence.level} confidence
          </span>
          <span className="tos-ai-cache-state">Live · {formatTimestamp(view.generatedAt)}</span>
        </div>
      </div>

      <div className="tos-context-ai__grid">
        <div className="tos-context-ai__panel">
          <div className="tos-context-ai__panel-head">
            <div>
              <span className="tos-ai-panel-kicker">Signals</span>
              <h3>What matters here</h3>
            </div>
            <span className="tos-ai-count">{attentionItems.length}</span>
          </div>

          {attentionItems.length > 0 ? (
            <div className="tos-context-ai__signal-list">
              {attentionItems.map((item) => (
                <article key={item.id} className="tos-context-ai__signal" data-severity={item.severity.toLowerCase()}>
                  <div className="tos-context-ai__signal-head">
                    <strong>{item.title}</strong>
                    <span className="tos-context-ai__severity">{item.severity}</span>
                  </div>
                  <p>{item.summary}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="tos-context-ai__calm">No open evidence-backed alerts in this workflow.</div>
          )}
        </div>

        <div className="tos-context-ai__panel">
          <div className="tos-context-ai__panel-head">
            <div>
              <span className="tos-ai-panel-kicker">Next move</span>
              <h3>Recommended review</h3>
            </div>
          </div>

          {surface === "settings" ? (
            <div className="tos-context-ai__readiness">
              <strong>{view.dataQuality.sufficientForTrends ? "Trend-ready data" : "Build more operating history"}</strong>
              <p>{view.dataQuality.completedSales30d} completed sale(s) in the last 30 days. {view.confidence.reason}</p>
            </div>
          ) : null}

          {recommendations.length > 0 ? (
            <div className="tos-context-ai__recommendations">
              {recommendations.map((recommendation) => (
                <article key={recommendation.code} className="tos-context-ai__recommendation">
                  <strong>{recommendation.title}</strong>
                  <p>{recommendation.summary}</p>
                  <Link className="tos-ai-workflow-link" href={contextualWorkflowHref(recommendation.suggestedActionType)}>
                    {recommendation.suggestedActionLabel ?? "Open workflow"}
                  </Link>
                </article>
              ))}
            </div>
          ) : surface !== "settings" ? (
            <div className="tos-context-ai__calm">No immediate recommendation is supported by the current evidence.</div>
          ) : null}
        </div>
      </div>

      <div className="tos-context-ai__footer">
        <span>Ask uses current business and branch evidence. TradeOS will not auto-submit money, stock, or access changes.</span>
        <Button variant="gold" size="sm" disabled={!queue.online} onClick={askTradeOS}>Ask TradeOS</Button>
      </div>
    </section>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
