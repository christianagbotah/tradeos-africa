"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { BusinessQuestionResponse } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { MoneyValue } from "../business/money-value";
import styles from "./business-question-panel.module.css";

const ROLES = new Set(["OWNER","ADMIN","MANAGER","ACCOUNTANT"]);
const SUGGESTIONS = [
  "How much did we sell this week?",
  "What is our cash balance?",
  "Who owes us money?",
  "Which stock needs replenishment?",
] as const;

export function BusinessQuestionPanel() {
  const { session, role, queue } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<BusinessQuestionResponse | null>(null);
  const context = session ? session.businessId + ":" + session.branchId : "";
  const contextRef = useRef(context);
  contextRef.current = context;
  if (!session || role === null || !ROLES.has(role)) return null;

  const current = answer && answer.businessId === session.businessId &&
    answer.branchId === session.branchId ? answer : null;

  async function submit(event?: FormEvent<HTMLFormElement>, textOverride?: string) {
    event?.preventDefault();
    const text = (textOverride ?? question).trim();
    if (busy || !queue.online || text.length < 4 || text.length > 400 || !session) return;
    const before = context;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/intelligence/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: session.businessId, branchId: session.branchId, question: text }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as BusinessQuestionResponse;
      if (contextRef.current === before && result.businessId === session?.businessId &&
          result.branchId === session?.branchId) {
        setAnswer(result);
      }
    } catch (err) {
      if (contextRef.current === before) {
        setError(err instanceof Error ? err.message : "Could not answer the question.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="business-questions-heading">
      <details>
        <summary className={styles.summary}>
          <span>
            <strong id="business-questions-heading">Ask TradeOS</strong>
            <small>Ask about recorded sales, cash, debts, best-selling items or stock.</small>
          </span>
          <span className={styles.summaryAction}>Open questions</span>
        </summary>
        <div className={styles.body}>
          <p className={styles.hint}>
            Answers are based on recorded TradeOS reports, with their sources shown.
            This question service runs without a paid AI provider and does not change business records.
          </p>
          <div className={styles.suggestions} aria-label="Suggested questions">
            {SUGGESTIONS.map((suggestion) => (
              <button type="button" className={styles.suggestion} key={suggestion}
                disabled={busy || !queue.online}
                onClick={() => { setQuestion(suggestion); void submit(undefined, suggestion); }}>
                {suggestion}
              </button>
            ))}
          </div>
          <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
            <label htmlFor="tradeos-business-question">Your business question</label>
            <div className={styles.formRow}>
              <input id="tradeos-business-question" type="text" value={question}
                placeholder="e.g. Which products sold best this month?"
                maxLength={400} minLength={4}
                disabled={busy || !queue.online}
                onChange={(event) => setQuestion(event.target.value)} />
              <button type="submit" disabled={busy || !queue.online || question.trim().length < 4}>
                {busy ? "Checking…" : "Ask"}
              </button>
            </div>
          </form>
          {!queue.online ? (
            <p role="status" className={styles.notice}>
              Connect to refresh answers. Offline sales and inventory recording are unaffected.
            </p>
          ) : error ? (
            <p role="alert" className={styles.error}>{error}</p>
          ) : busy ? (
            <p role="status" className={styles.notice}>Checking your recorded business figures…</p>
          ) : current ? (
            <div className={styles.answer} aria-live="polite">
              <div className={styles.answerHeader}>
                <strong>Answer from TradeOS records</strong>
                <span>{new Date(current.generatedAt).toLocaleString("en-GH",
                  { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              <p>{current.answer}</p>
              {current.items.length ? (
                <ul className={styles.results}>
                  {current.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {current.evidence.length ? (
                <ul className={styles.evidence}>
                  {current.evidence.map((item) => (
                    <li key={item.key}>{item.label}: {item.unit === "MINOR" ? (
                      <MoneyValue minor={item.value} currencyCode={current.currencyCode ?? "GHS"} />
                    ) : item.value.toLocaleString("en-GH", { maximumFractionDigits: 3 })}</li>
                  ))}
                </ul>
              ) : null}
              {current.limitations.length ? (
                <p className={styles.limitations}>{current.limitations.join(" ")}</p>
              ) : null}
              {current.sourcePage ? <Link className={styles.link} href={current.sourcePage}>
                Review the underlying records
              </Link> : null}
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
