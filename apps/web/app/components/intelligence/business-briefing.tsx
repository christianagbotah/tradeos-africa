"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  BusinessActionItem,
  BusinessBriefing as BusinessBriefingData,
  BusinessRecommendation,
} from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import {
  businessIntelligenceCacheKey,
  isBusinessIntelligenceCacheStale,
  readBusinessIntelligenceCache,
  writeBusinessIntelligenceCache,
  type BusinessIntelligenceCacheEnvelope,
  type BusinessIntelligenceCacheScope,
} from "./business-intelligence-cache";
import { isBusinessActionItemActive, mutateBusinessActionItem } from "./business-action-items";
import { BusinessActionExplanation } from "./business-action-explanation";

interface ActionItemsResponse {
  items: BusinessActionItem[];
}

interface CachedBriefingData {
  briefing: BusinessBriefingData;
  actionItems: BusinessActionItem[];
}

const MAX_CACHE_AGE_MS = 15 * 60 * 1000;

export function BusinessBriefing() {
  const { session, account, queue } = useWorkspace();
  const [cached, setCached] = useState<BusinessIntelligenceCacheEnvelope<CachedBriefingData> | null>(null);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const scope = useMemo<BusinessIntelligenceCacheScope | null>(() => {
    if (!session || !account) return null;
    return {
      userId: account.id,
      businessId: session.businessId,
      branchId: session.branchId,
    };
  }, [account, session]);

  const briefingPath = session
    ? `/v1/intelligence/briefing?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&range=today`
    : null;
  const actionsPath = session
    ? `/v1/intelligence/action-items?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;

  const briefingQuery = useApiFetch<BusinessBriefingData>(briefingPath);
  const actionQuery = useApiFetch<ActionItemsResponse>(actionsPath);

  useEffect(() => {
    if (!scope || typeof window === "undefined") {
      setCached(null);
      return;
    }
    // Computing the key here makes the tenant/user/branch boundary explicit in
    // the component as well as in the cache implementation.
    void businessIntelligenceCacheKey(scope);
    setCached(readBusinessIntelligenceCache<CachedBriefingData>(window.localStorage, scope));
  }, [scope]);

  useEffect(() => {
    if (!scope || typeof window === "undefined" || !queue.online || !briefingQuery.data || !actionQuery.data) return;
    const envelope: BusinessIntelligenceCacheEnvelope<CachedBriefingData> = {
      generatedAt: briefingQuery.data.generatedAt,
      sourceRoute: "/v1/intelligence/briefing",
      range: briefingQuery.data.range,
      data: {
        briefing: briefingQuery.data,
        actionItems: actionQuery.data.items,
      },
    };
    writeBusinessIntelligenceCache(window.localStorage, scope, envelope);
    setCached(envelope);
  }, [actionQuery.data, briefingQuery.data, queue.online, scope]);

  const updateActionItem = async (item: BusinessActionItem, action: "complete" | "snooze") => {
    if (!session || !queue.online || actionBusyKey) return;
    setActionBusyKey(`${item.id}:${action}`);
    setActionError(null);
    try {
      const client = getOfflineQueue();
      const updated = await mutateBusinessActionItem(
        (input, init) => client.authenticatedFetch(input, init),
        action === "snooze"
          ? {
              action: "snooze",
              actionItemId: item.id,
              businessId: session.businessId,
              snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            }
          : {
              action: "complete",
              actionItemId: item.id,
              businessId: session.businessId,
            },
      );
      if (actionQuery.data) {
        actionQuery.setData({
          items: actionQuery.data.items.map((candidate) => candidate.id === updated.id ? updated : candidate),
        });
      }
      actionQuery.refetch();
      briefingQuery.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action item could not be updated.");
    } finally {
      setActionBusyKey(null);
    }
  };

  const live = Boolean(queue.online && briefingQuery.data && actionQuery.data);
  const view: CachedBriefingData | null = live
    ? { briefing: briefingQuery.data!, actionItems: actionQuery.data!.items }
    : cached?.data ?? null;
  const usingCache = !live && Boolean(view);
  const stale = cached ? isBusinessIntelligenceCacheStale(cached, MAX_CACHE_AGE_MS) : false;

  if (!view) {
    if (!queue.online) {
      return (
        <section className="tos-ai-briefing">
          <StatePanel
            inline
            variant="empty"
            title="Business intelligence is offline"
            text="There is no cached briefing for this user, business, and branch yet. Your core TradeOS workflows remain available offline."
          />
        </section>
      );
    }
    if (briefingQuery.loading || actionQuery.loading) return <BriefingSkeleton />;
    return (
      <section className="tos-ai-briefing">
        <StatePanel
          inline
          variant="error"
          title="Could not load business briefing"
          text={briefingQuery.error ?? actionQuery.error ?? "TradeOS intelligence could not be refreshed."}
          actionLabel="Retry"
          onAction={() => {
            briefingQuery.refetch();
            actionQuery.refetch();
          }}
        />
      </section>
    );
  }

  const { briefing, actionItems } = view;
  const recommendations = uniqueRecommendations(briefing.sections.flatMap((section) => section.recommendations));
  const openActions = actionItems.filter((item) => isBusinessActionItemActive(item)).slice(0, 4);

  return (
    <section className="tos-ai-briefing" data-cache-state={usingCache ? "cached" : "live"}>
      <div className="tos-ai-briefing__hero">
        <div className="tos-ai-briefing__heading">
          <span className="tos-ai-eyebrow">TradeOS Intelligence</span>
          <h2>{briefing.headline}</h2>
          <p>{briefing.summary}</p>
        </div>
        <div className="tos-ai-briefing__meta">
          <span className={`tos-ai-confidence tos-ai-confidence--${briefing.confidence.level.toLowerCase()}`}>
            {briefing.confidence.level} confidence
          </span>
          <span className={usingCache ? "tos-ai-cache-state tos-ai-cache-state--cached" : "tos-ai-cache-state"}>
            {usingCache ? `Cached${stale ? " · stale" : ""}` : "Live"} · Generated {formatTimestamp(briefing.generatedAt)}
          </span>
        </div>
      </div>

      {usingCache ? (
        <div className="tos-ai-notice" role="status">
          {queue.online
            ? "Showing the last successful cached briefing while fresh intelligence reconnects."
            : "Offline: showing cached intelligence. AI-guided economic workflows stay disabled until you reconnect."}
        </div>
      ) : null}

      <div className="tos-ai-briefing__grid">
        <div className="tos-ai-briefing__panel">
          <div className="tos-ai-briefing__panel-head">
            <div>
              <span className="tos-ai-panel-kicker">Action queue</span>
              <h3>What to do next</h3>
            </div>
            <span className="tos-ai-count">{openActions.length}</span>
          </div>
          {actionError ? <div className="tos-ai-error" role="alert">{actionError}</div> : null}
          {openActions.length > 0 ? (
            <div className="tos-ai-action-list">
              {openActions.map((item) => (
                <article key={item.id} className="tos-ai-action-card">
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.reason}</p>
                    <small>{item.dueAt ? `Due ${formatTimestamp(item.dueAt)}` : item.status}</small>
                    <BusinessActionExplanation item={item} businessId={briefing.businessId} online={queue.online} />
                  </div>
                  {queue.online ? (
                    <div className="tos-ai-action-card__actions">
                      <Link className="tos-ai-workflow-link" href={actionItemWorkflowHref(item)}>Open workflow</Link>
                      <Button
                        size="sm"
                        variant="positive"
                        loading={actionBusyKey === `${item.id}:complete`}
                        disabled={Boolean(actionBusyKey)}
                        onClick={() => void updateActionItem(item, "complete")}
                      >
                        Mark done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={actionBusyKey === `${item.id}:snooze`}
                        disabled={Boolean(actionBusyKey)}
                        onClick={() => void updateActionItem(item, "snooze")}
                      >
                        Snooze 24h
                      </Button>
                    </div>
                  ) : (
                    <span className="tos-ai-workflow-link tos-ai-workflow-link--disabled">Reconnect to manage this action</span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="tos-ai-empty-copy">No open AI-assisted follow-ups. TradeOS will surface work here when evidence warrants attention.</p>
          )}
        </div>

        <div className="tos-ai-briefing__panel">
          <div className="tos-ai-briefing__panel-head">
            <div>
              <span className="tos-ai-panel-kicker">Recommendations</span>
              <h3>Evidence-backed opportunities</h3>
            </div>
          </div>
          {recommendations.length > 0 ? (
            <div className="tos-ai-recommendation-list">
              {recommendations.slice(0, 4).map((recommendation) => (
                <RecommendationCard key={recommendation.code} recommendation={recommendation} online={queue.online} />
              ))}
            </div>
          ) : (
            <p className="tos-ai-empty-copy">No additional recommendation is justified by the current evidence.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function RecommendationCard({ recommendation, online }: { recommendation: BusinessRecommendation; online: boolean }) {
  return (
    <article className="tos-ai-recommendation-card">
      <div className="tos-ai-recommendation-card__copy">
        <span className={`tos-ai-priority tos-ai-priority--${recommendation.priority.toLowerCase()}`}>{recommendation.priority}</span>
        <strong>{recommendation.title}</strong>
        <p>{recommendation.summary}</p>
        <small>{recommendation.rationale}</small>
      </div>
      {online ? (
        <Link className="tos-ai-workflow-link" href={workflowHref(recommendation.suggestedActionType)}>Open workflow</Link>
      ) : (
        <span className="tos-ai-workflow-link tos-ai-workflow-link--disabled">Reconnect to open workflow</span>
      )}
    </article>
  );
}

function BriefingSkeleton() {
  return (
    <section className="tos-ai-briefing tos-ai-briefing--loading" aria-label="Loading business intelligence">
      <span className="tos-skeleton tos-skeleton--line-short" />
      <span className="tos-skeleton tos-skeleton--block" />
    </section>
  );
}

function uniqueRecommendations(items: BusinessRecommendation[]): BusinessRecommendation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}

function actionItemWorkflowHref(item: BusinessActionItem): string {
  if (item.sourceEntityType === "CATALOG_ITEM") return "/inventory";
  if (item.sourceEntityType === "CUSTOMER") return "/customers";
  if (item.sourceEntityType === "SUPPLIER" || item.sourceEntityType === "PURCHASE") return "/purchases";
  if (item.actionType === "CREATE_REORDER_REVIEW") return "/purchases";
  if (item.actionType === "CREATE_RECEIVABLE_FOLLOW_UP") return "/customers";
  if (item.actionType === "CREATE_CASH_REVIEW") return "/cashbook";
  if (item.actionType === "CREATE_PERFORMANCE_REVIEW") return "/reports";
  if (item.actionType === "CREATE_INVENTORY_REVIEW") return "/inventory";
  if (item.actionType === "CREATE_PAYABLES_REVIEW") return "/purchases";
  if (item.actionType === "CREATE_DATA_READINESS_REVIEW") return "/settings?section=business";
  return "/dashboard";
}

function workflowHref(actionType?: string | null): string {
  const action = (actionType ?? "").toUpperCase();
  if (action.includes("REORDER") || action.includes("PURCHASE")) return "/purchases";
  if (action.includes("RECEIVABLE") || action.includes("CUSTOMER") || action.includes("CREDIT")) return "/customers";
  if (action.includes("CASH") || action.includes("EXPENSE")) return "/cashbook";
  if (action.includes("STOCK") || action.includes("INVENTORY")) return "/inventory";
  if (action.includes("SALE")) return "/sales";
  return "/reports";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
