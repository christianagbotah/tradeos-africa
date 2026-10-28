"use client";

import { useRef, useState } from "react";
import type { BusinessActionItem, BusinessActionItemExplanation, BusinessEvidenceReference } from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { fetchBusinessActionItemExplanation } from "./business-action-items";

interface BusinessActionExplanationProps {
  item: BusinessActionItem;
  businessId: string;
  online: boolean;
}

export function BusinessActionExplanation({ item, businessId, online }: BusinessActionExplanationProps) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState<BusinessActionItemExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const loadExplanation = async () => {
    if (!online || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchBusinessActionItemExplanation(
        (input, init) => getOfflineQueue().authenticatedFetch(input, init),
        { businessId, actionItemId: item.id },
      );
      setExplanation(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Task explanation could not be loaded.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const toggleExplanation = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && online && !explanation && !inFlight.current) void loadExplanation();
  };

  return (
    <div className="tos-ai-action-explanation">
      <button type="button" className="tos-ai-action-explanation__toggle" onClick={toggleExplanation} aria-expanded={open}>
        Why this task?
      </button>
      {open ? (
        <div className="tos-ai-action-explanation__details">
          <p className="tos-ai-action-explanation__reason">{item.reason}</p>
          {!online ? (
            <p className="tos-ai-action-explanation__offline">Reconnect to see the automation source and fresh evidence.</p>
          ) : loading && !explanation ? (
            <p className="tos-ai-action-explanation__status" role="status">Loading source details…</p>
          ) : error && !explanation ? (
            <div className="tos-ai-action-explanation__error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void loadExplanation()}>Try again</button>
            </div>
          ) : explanation ? (
            <>
              <div className="tos-ai-action-explanation__meta">
                <span>{sourceKindLabel(explanation.sourceKind)}</span>
                <small>Updated {formatTimestamp(explanation.generatedAt)}</small>
              </div>
              <p>{explanation.summary}</p>
              {explanation.automation?.policyName ? (
                <div className="tos-ai-action-explanation__source">
                  <strong>Automation policy</strong>
                  <span>{explanation.automation.policyName} · v{explanation.automation.policyVersion}</span>
                </div>
              ) : null}
              {explanation.attention ? (
                <div className="tos-ai-action-explanation__source">
                  <strong>Triggering signal</strong>
                  <span>{explanation.attention.severity} · {explanation.attention.title}</span>
                  <small>{explanation.attention.summary}</small>
                </div>
              ) : null}
              {explanation.evidence.length > 0 ? (
                <div className="tos-ai-action-explanation__evidence">
                  <strong>Supporting evidence</strong>
                  <dl>
                    {explanation.evidence.slice(0, 5).map((fact, index) => (
                      <div key={`${fact.source}:${fact.label ?? index}:${fact.entityId ?? index}`}>
                        <dt>{fact.label ?? fact.source}</dt>
                        <dd>{formatEvidenceValue(fact)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <small className="tos-ai-action-explanation__timestamp">Task created {formatTimestamp(explanation.action.createdAt)}</small>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function sourceKindLabel(kind: BusinessActionItemExplanation["sourceKind"]): string {
  switch (kind) {
    case "AUTOMATION": return "Created by TradeOS automation";
    case "ENTITY_REVIEW": return "Created from record intelligence";
    case "ATTENTION": return "Created from a TradeOS attention signal";
    case "MANUAL": return "Created as an internal review";
  }
}

function formatEvidenceValue(fact: BusinessEvidenceReference): string {
  const value = fact.value;
  if (fact.metadata?.kind === "money_minor" && typeof fact.metadata.currencyCode === "string") {
    const minor = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(minor)) {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: fact.metadata.currencyCode }).format(minor / 100);
      } catch {
        return `${fact.metadata.currencyCode} ${(minor / 100).toFixed(2)}`;
      }
    }
  }
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
