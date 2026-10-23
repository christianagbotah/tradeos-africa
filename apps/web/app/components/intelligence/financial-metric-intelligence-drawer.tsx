"use client";

import Link from "next/link";
import type {
  BusinessEvidenceReference,
  BusinessFinancialMetricIntelligence,
  BusinessFinancialMetricKey,
  BusinessFinancialMetricRange,
} from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { StatePanel } from "../ui/state-panel";
import { useWorkspace } from "../workspace/use-workspace";
import { contextualWorkflowHref } from "./contextual-intelligence";

interface FinancialMetricIntelligenceDrawerProps {
  open: boolean;
  metricKey: BusinessFinancialMetricKey;
  range: BusinessFinancialMetricRange;
  onClose: () => void;
}

export function FinancialMetricIntelligenceDrawer({
  open,
  metricKey,
  range,
  onClose,
}: FinancialMetricIntelligenceDrawerProps) {
  const { session, queue } = useWorkspace();
  const metricPath = open && session && queue.online
    ? `/v1/intelligence/metric?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&metricKey=${encodeURIComponent(metricKey)}&range=${encodeURIComponent(range)}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<BusinessFinancialMetricIntelligence>(metricPath);
  const currentData = data?.metric.metricKey === metricKey && data.range === range ? data : null;

  if (!open || !session) return null;

  const askTradeOS = () => {
    if (!queue.online || !currentData || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("tradeos:ask", {
      detail: { question: currentData.askPrompt, context: { metricKey, range } },
    }));
  };

  return (
    <>
      <div className="tos-metric-ai-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="tos-metric-ai" role="dialog" aria-modal="true" aria-label="Financial metric intelligence">
        <header className="tos-metric-ai__head">
          <div>
            <span className="tos-ai-eyebrow">TradeOS Intelligence · Financial metric</span>
            <h2>{currentData?.metric.label ?? humanizeMetric(metricKey)}</h2>
            <p>Authoritative explanation from the same accounting snapshot used by Financial Reports.</p>
          </div>
          <button type="button" className="tos-ai-icon-button" onClick={onClose} aria-label="Close metric intelligence">
            <IconClose />
          </button>
        </header>

        <div className="tos-metric-ai__body">
          {!queue.online ? (
            <StatePanel
              inline
              variant="empty"
              title="Financial intelligence is offline"
              text="Reconnect to refresh this metric and ask TradeOS about the current accounting evidence. The report already on screen remains available under its normal offline behavior."
            />
          ) : loading && !currentData ? (
            <div className="tos-metric-ai__loading" aria-busy="true">
              <span className="tos-skeleton tos-skeleton--line-short" />
              <span className="tos-skeleton tos-skeleton--block" />
            </div>
          ) : error && !currentData ? (
            <StatePanel
              inline
              variant="error"
              title="Could not load financial metric intelligence"
              text={error}
              actionLabel="Retry"
              onAction={() => refetch()}
            />
          ) : currentData ? (
            <>
              <section className="tos-metric-ai__score" aria-label="Metric comparison">
                <div className="tos-metric-ai__current">
                  <span>Current · {rangeLabel(currentData.range)}</span>
                  <strong>{formatMoneyMinor(currentData.currentMinor, currentData.currencyCode)}</strong>
                  <small>{formatPeriod(currentData.period.from, currentData.period.to)}</small>
                </div>
                <div className="tos-metric-ai__comparison">
                  {currentData.previousMinor === null ? (
                    <>
                      <strong>Snapshot only</strong>
                      <span>No prior inventory valuation snapshot is available for a comparable period.</span>
                    </>
                  ) : (
                    <>
                      <span>Prior comparable</span>
                      <strong>{formatMoneyMinor(currentData.previousMinor, currentData.currencyCode)}</strong>
                      <span>
                        {currentData.deltaMinor === null ? "—" : formatSignedMoney(currentData.deltaMinor, currentData.currencyCode)}
                        {currentData.changePercent === null ? "" : ` · ${formatSignedPercent(currentData.changePercent)}`}
                      </span>
                    </>
                  )}
                </div>
              </section>

              <section className="tos-metric-ai__summary">
                <strong>What this means</strong>
                <p>{currentData.summary}</p>
              </section>

              <section className="tos-metric-ai__section">
                <div className="tos-metric-ai__section-head">
                  <strong>Attention</strong>
                  <span>{currentData.attentionItems.length}</span>
                </div>
                {currentData.attentionItems.length > 0 ? (
                  <div className="tos-metric-ai__attention-list">
                    {currentData.attentionItems.slice(0, 4).map((item) => (
                      <article key={item.id} data-severity={item.severity.toLowerCase()}>
                        <div><strong>{item.title}</strong><span>{item.severity}</span></div>
                        <p>{item.summary}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="tos-metric-ai__calm">No open evidence-backed alert is currently mapped to this metric.</p>
                )}
              </section>

              <section className="tos-metric-ai__section">
                <div className="tos-metric-ai__section-head"><strong>Evidence</strong><span>Read-only</span></div>
                <dl className="tos-metric-ai__facts">
                  {currentData.evidence.slice(0, 8).map((item, index) => (
                    <div key={`${item.source}:${item.label ?? item.entityType}:${index}`}>
                      <dt>{humanizeLabel(item.label ?? item.entityType)}</dt>
                      <dd>{formatEvidenceValue(item, currentData.currencyCode)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {currentData.recommendations.length > 0 ? (
                <section className="tos-metric-ai__section">
                  <div className="tos-metric-ai__section-head"><strong>Review next</strong></div>
                  <div className="tos-metric-ai__recommendations">
                    {currentData.recommendations.slice(0, 2).map((recommendation) => (
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
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="tos-metric-ai__footer">
          <span>Financial intelligence is read-only. TradeOS will not auto-submit payments, sales, purchases, stock, refunds, or access changes.</span>
          <Button type="button" variant="gold" size="sm" disabled={!queue.online} onClick={askTradeOS}>
            Ask TradeOS about this metric
          </Button>
        </footer>
      </aside>
    </>
  );
}

function formatMoneyMinor(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(value / 100);
  } catch {
    return `${currencyCode} ${(value / 100).toFixed(2)}`;
  }
}

function formatSignedMoney(value: number, currencyCode: string): string {
  const formatted = formatMoneyMinor(Math.abs(value), currencyCode);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function formatSignedPercent(value: number): string {
  const formatted = `${Math.abs(value).toFixed(1)}%`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function formatEvidenceValue(item: BusinessEvidenceReference, currencyCode: string): string {
  if (item.value === null || item.value === undefined || item.value === "") return "—";
  if (item.metadata?.kind === "money_minor") {
    const numeric = typeof item.value === "number" ? item.value : Number(item.value);
    const code = typeof item.metadata.currencyCode === "string" ? item.metadata.currencyCode : currencyCode;
    if (Number.isFinite(numeric)) return formatMoneyMinor(numeric, code);
  }
  if (typeof item.value === "boolean") return item.value ? "Yes" : "No";
  if (item.label === "changePercent" && typeof item.value === "number") return formatSignedPercent(item.value);
  return String(item.value);
}

function formatPeriod(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return `${from} – ${to}`;
  return `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`;
}

function rangeLabel(range: BusinessFinancialMetricRange): string {
  switch (range) {
    case "today": return "Today";
    case "week": return "This week";
    case "month": return "This month";
    case "quarter": return "This quarter";
  }
}

function humanizeMetric(value: BusinessFinancialMetricKey): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function humanizeLabel(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[:_]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}
