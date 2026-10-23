"use client";

import Link from "next/link";
import type { BusinessEntityIntelligence, BusinessEntityType } from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { useWorkspace } from "../workspace/use-workspace";
import { contextualWorkflowHref } from "./contextual-intelligence";

interface EntityIntelligencePanelProps {
  entityType: BusinessEntityType;
  entityId: string;
}

export function EntityIntelligencePanel({ entityType, entityId }: EntityIntelligencePanelProps) {
  const { session, queue } = useWorkspace();
  const entityPath = session && queue.online && entityId
    ? `/v1/intelligence/entity?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<BusinessEntityIntelligence>(entityPath);

  if (!session || !entityId) return null;

  if (!queue.online) {
    return (
      <section className="tos-entity-ai" data-state="offline" data-entity-type={entityType}>
        <StatePanel
          inline
          variant="empty"
          title="Record intelligence is offline"
          text="Reconnect to refresh evidence and ask TradeOS about this record. Existing offline workflows remain available."
        />
        <div className="tos-entity-ai__offline-actions">
          <Button type="button" variant="outline" size="sm" disabled={!queue.online}>Ask TradeOS about this</Button>
        </div>
      </section>
    );
  }

  if (loading && !data) {
    return (
      <section className="tos-entity-ai tos-entity-ai--loading" data-state="loading" data-entity-type={entityType} aria-busy="true">
        <span className="tos-skeleton tos-skeleton--line-short" />
        <span className="tos-skeleton tos-skeleton--block" />
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="tos-entity-ai" data-state="error" data-entity-type={entityType}>
        <StatePanel
          inline
          variant="error"
          title="Could not load entity intelligence"
          text={error}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </section>
    );
  }

  if (!data) return null;

  const evidence = data.evidence.slice(0, 8);
  const attentionItems = data.attentionItems.slice(0, 3);
  const recommendations = data.recommendations.slice(0, 2);

  const askTradeOS = () => {
    if (!queue.online || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("tradeos:ask", {
      detail: { question: data.askPrompt, context: { entityType, entityId } },
    }));
  };

  return (
    <section className="tos-entity-ai" data-state="live" data-entity-type={entityType}>
      <div className="tos-entity-ai__head">
        <div>
          <span className="tos-ai-eyebrow">TradeOS Intelligence · This record</span>
          <h3>{data.entity.label}</h3>
          <p>Authoritative signals for the record you are reviewing now.</p>
        </div>
        <span className="tos-ai-cache-state">Live · {formatTimestamp(data.generatedAt)}</span>
      </div>

      <div className="tos-entity-ai__facts" aria-label="Authoritative record evidence">
        {evidence.map((item, index) => (
          <div className="tos-entity-ai__fact" key={`${item.source}:${item.label ?? item.entityType}:${index}`}>
            <dt>{humanize(item.label ?? item.entityType)}</dt>
            <dd>{formatEvidenceValue(item.value)}</dd>
          </div>
        ))}
      </div>

      <div className="tos-entity-ai__attention">
        <div className="tos-entity-ai__section-head">
          <strong>Attention</strong>
          <span>{attentionItems.length}</span>
        </div>
        {attentionItems.length > 0 ? (
          <div className="tos-entity-ai__attention-list">
            {attentionItems.map((item) => (
              <article key={item.id} className="tos-entity-ai__attention-item" data-severity={item.severity.toLowerCase()}>
                <div><strong>{item.title}</strong><span>{item.severity}</span></div>
                <p>{item.summary}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="tos-entity-ai__calm">No open evidence-backed alert matches this record.</p>
        )}
      </div>

      {recommendations.length > 0 ? (
        <div className="tos-entity-ai__recommendations">
          {recommendations.map((recommendation) => (
            <article key={recommendation.code}>
              <div>
                <strong>{recommendation.title}</strong>
                <p>{recommendation.summary}</p>
              </div>
              <Link className="tos-ai-workflow-link" href={contextualWorkflowHref(recommendation.suggestedActionType)}>
                {recommendation.suggestedActionLabel ?? "Open workflow"}
              </Link>
            </article>
          ))}
        </div>
      ) : null}

      <div className="tos-entity-ai__footer">
        <span>Evidence is read-only. TradeOS will not auto-submit money, stock, purchase, return, or access changes.</span>
        <Button type="button" variant="gold" size="sm" disabled={!queue.online} onClick={askTradeOS}>
          Ask TradeOS about this
        </Button>
      </div>
    </section>
  );
}

function formatEvidenceValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[:_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
