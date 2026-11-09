"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  BusinessAssistantContext,
  BusinessAssistantQueryResponse,
  BusinessEvidenceReference,
  BusinessRecommendation,
} from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { IconClose, IconSearch } from "../ui/icons";

interface AskTradeOSDrawerProps {
  open: boolean;
  onClose: () => void;
  initialQuestion?: string | null;
  initialContext?: BusinessAssistantContext | null;
}

const STARTERS = [
  "What needs my attention today?",
  "Which customers need a credit follow-up?",
  "What stock should I review for reorder?",
] as const;

export function AskTradeOSDrawer({ open, onClose, initialQuestion, initialContext }: AskTradeOSDrawerProps) {
  const { session, queue } = useWorkspace();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<BusinessAssistantQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuestion(initialQuestion ?? "");
    setAnswer(null);
    setError(null);
  }, [initialContext, initialQuestion, open]);

  if (!open) return null;

  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!session || !question.trim() || loading) return;
    if (!queue.online) {
      setError("Ask TradeOS needs a connection for fresh evidence. Your cached dashboard briefing remains available offline.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/intelligence/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId: session.businessId,
          branchId: session.branchId,
          question: question.trim(),
          conversationId: answer?.conversationId ?? null,
          context: initialContext ?? null,
        }),
      });
      if (!response.ok) {
        setError(await readApiErrorMessage(response));
        return;
      }
      setAnswer(await response.json() as BusinessAssistantQueryResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "TradeOS intelligence could not be reached.");
    } finally {
      setLoading(false);
    }
  };

  const openWorkflow = (recommendation: BusinessRecommendation) => {
    if (!queue.online) {
      setError("Reconnect before opening an AI-guided workflow. TradeOS will never auto-submit an economic action while offline.");
      return;
    }
    router.push(workflowHref(recommendation.suggestedActionType));
    onClose();
  };

  return (
    <>
      <div className="tos-ai-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="tos-ai-drawer" role="dialog" aria-modal="true" aria-label="Ask TradeOS">
        <header className="tos-ai-drawer__head">
          <div>
            <span className="tos-ai-eyebrow">TradeOS Intelligence</span>
            <h2 className="tos-ai-drawer__title">Ask TradeOS</h2>
            <p className="tos-ai-drawer__subtitle">Grounded answers from your business records—not guesses.</p>
          </div>
          <button type="button" className="tos-ai-icon-button" onClick={onClose} aria-label="Close Ask TradeOS">
            <IconClose />
          </button>
        </header>

        <div className="tos-ai-drawer__body">
          {!queue.online ? (
            <div className="tos-ai-notice" role="status">
              You are offline. Fresh AI questions are paused; no payment, refund, sale, or stock action can be submitted by AI offline.
            </div>
          ) : null}

          <form className="tos-ai-ask" onSubmit={(event) => void ask(event)}>
            <label className="tos-ai-ask__label" htmlFor="ask-tradeos-question">Ask a business question</label>
            <textarea
              id="ask-tradeos-question"
              className="tos-ai-ask__input"
              rows={3}
              value={question}
              maxLength={500}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Example: Which customers need attention this week?"
            />
            <div className="tos-ai-ask__actions">
              <Button type="submit" variant="gold" loading={loading} disabled={!queue.online || !question.trim()} icon={<IconSearch />}>
                Ask TradeOS
              </Button>
            </div>
          </form>

          {!answer ? (
            <div className="tos-ai-starters" aria-label="Suggested questions">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" className="tos-ai-starter" onClick={() => setQuestion(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          ) : null}

          {error ? <div className="tos-ai-error" role="alert">{error}</div> : null}

          {answer ? (
            <div className="tos-ai-answer">
              <section className="tos-ai-answer__section">
                <span className="tos-ai-answer__label">Answer</span>
                <p className="tos-ai-answer__copy">{answer.answer}</p>
                <span className="tos-ai-answer__time">Generated {formatTimestamp(answer.generatedAt)}</span>
              </section>

              <section className="tos-ai-answer__section">
                <span className="tos-ai-answer__label">Evidence</span>
                {answer.evidence.length > 0 ? (
                  <ul className="tos-ai-evidence">
                    {answer.evidence.slice(0, 8).map((item, index) => (
                      <EvidenceRow key={`${item.source}-${item.entityId ?? index}`} evidence={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="tos-ai-answer__muted">No authoritative evidence was available for this answer.</p>
                )}
              </section>

              <section className="tos-ai-answer__section">
                <span className="tos-ai-answer__label">Recommendations</span>
                {answer.recommendations.length > 0 ? (
                  <div className="tos-ai-recommendations">
                    {answer.recommendations.map((recommendation) => (
                      <article key={recommendation.code} className="tos-ai-recommendation">
                        <strong>{recommendation.title}</strong>
                        <p>{recommendation.summary}</p>
                        <small>{recommendation.rationale}</small>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!queue.online}
                          onClick={() => openWorkflow(recommendation)}
                        >
                          Open workflow
                        </Button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="tos-ai-answer__muted">No action is recommended from the available evidence.</p>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function EvidenceRow({ evidence }: { evidence: BusinessEvidenceReference }) {
  return (
    <li className="tos-ai-evidence__row">
      <span>
        <strong>{evidence.label ?? evidence.entityType}</strong>
        <small>{evidence.source}</small>
      </span>
      {evidence.value !== undefined && evidence.value !== null ? <b>{String(evidence.value)}</b> : null}
    </li>
  );
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
