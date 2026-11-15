"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { BusinessQuestionResponse } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { MoneyValue } from "../business/money-value";
import styles from "./business-question-panel.module.css";
import { questionRecognitionConstructor, type QuestionRecognition } from "./question-speech";

const ROLES = new Set(["OWNER","ADMIN","MANAGER","ACCOUNTANT"]);
const SUGGESTIONS = [
  "What were my total sales yesterday?",
  "How do sales this week compare with last week?",
  "What were our total sales last month?",
  "What is our cash balance?",
  "Who owes us money?",
  "Which stock needs replenishment?",
] as const;
const OWNER_SUGGESTIONS = ["Which branch sold the most this week?"] as const;

export function BusinessQuestionPanel() {
  const { session, role, queue } = useWorkspace();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<BusinessQuestionResponse | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speechOutputSupported, setSpeechOutputSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const recognizerRef = useRef<QuestionRecognition | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setVoiceSupported(Boolean(questionRecognitionConstructor(window)));
    setSpeechOutputSupported("speechSynthesis" in window);
    return () => {
      recognizerRef.current?.abort();
      recognizerRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!answer) return;
    window.requestAnimationFrame(() => answerRef.current?.scrollIntoView({
      behavior: "smooth", block: "nearest",
    }));
  }, [answer]);
  const context = session ? session.businessId + ":" + session.branchId : "";
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => {
    if (recognizerRef.current) {
      recognizerRef.current.abort();
      recognizerRef.current = null;
      setListening(false);
    }
  }, [context]);
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

  function toggleListening() {
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
      setListening(false);
      return;
    }
    if (!voiceSupported || busy || !queue.online) return;
    const Recognition = questionRecognitionConstructor(window);
    if (!Recognition) {
      setVoiceNotice("Voice recognition is unavailable in this browser. You can type your question.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-GB";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      if (recognizerRef.current !== recognition) return;
      const transcript = event.results[event.resultIndex]?.[0]?.transcript?.trim();
      recognizerRef.current = null;
      setListening(false);
      if (!transcript) {
        setVoiceNotice("No question was recognized. Try again or type it.");
        return;
      }
      setQuestion(transcript);
      setVoiceNotice(null);
      void submit(undefined, transcript);
    };
    recognition.onerror = (event) => {
      if (recognizerRef.current !== recognition) return;
      recognizerRef.current = null;
      setListening(false);
      if (event.error === "aborted") return;
      setVoiceNotice(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone access was blocked. Allow microphone permission or type your question."
        : event.error === "no-speech"
        ? "No speech was heard. Tap Speak and try again."
        : "Speech recognition failed. Try again or type your question.");
    };
    recognition.onend = () => {
      if (recognizerRef.current === recognition) {
        recognizerRef.current = null;
        setListening(false);
      }
    };
    setVoiceNotice(null);
    try {
      recognition.start();
      recognizerRef.current = recognition;
      setListening(true);
    } catch {
      setListening(false);
      setVoiceNotice("Could not start microphone recognition. Try typing your question.");
    }
  }

  function readAnswerAloud() {
    if (!current || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(current.answer);
    utterance.lang = "en-GB";
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className={styles.panel} aria-labelledby="business-questions-heading">
      <details open>
        <summary className={styles.summary}>
          <span>
            <strong id="business-questions-heading">Ask TradeOS</strong>
            <small>Ask by voice or text about sales comparisons, profits, cash, debts and stock.</small>
          </span>
          <span className={styles.summaryAction}>Speak or type</span>
        </summary>
        <div className={styles.body}>
          <p className={styles.hint}>
            Answers and comparisons come from your recorded TradeOS reports, with their sources shown.
            No paid AI service is required, and asking a question cannot change business records.
          </p>
          <div className={styles.suggestions} aria-label="Suggested questions">
            {[...SUGGESTIONS, ...(role === "OWNER" || role === "ADMIN" ? OWNER_SUGGESTIONS : [])].map((suggestion) => (
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
              <button type="button" className={styles.micButton}
                aria-label={listening ? "Stop listening" : "Speak a business question"}
                aria-pressed={listening}
                title={listening ? "Stop listening" : "Ask TradeOS by voice"}
                disabled={busy || !queue.online || !voiceSupported} onClick={toggleListening}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
                </svg>
                <span>{listening ? "Stop" : "Speak"}</span>
              </button>
              <button type="submit" disabled={busy || !queue.online || question.trim().length < 4}>
                {busy ? "Checking…" : "Ask"}
              </button>
            </div>
          </form>
          {listening ? <p className={styles.listening} role="status">Listening… Ask your business question now.</p> : null}
          {voiceNotice ? <p role="alert" className={styles.notice}>{voiceNotice}</p> : null}
          {!voiceSupported ? <p className={styles.voiceHint}>Your browser does not support voice recognition here. You can still type any supported question.</p>
            : <p className={styles.voiceHint}>Voice is optional. Your browser may use an online speech service; only the recognized question is submitted to TradeOS.</p>}
          {!queue.online ? (
            <p role="status" className={styles.notice}>
              Connect to refresh answers. Offline sales and inventory recording are unaffected.
            </p>
          ) : error ? (
            <p role="alert" className={styles.error}>{error}</p>
          ) : busy ? (
            <p role="status" className={styles.notice}>Checking your recorded business figures…</p>
          ) : current ? (
            <div ref={answerRef} className={styles.answer} aria-live="polite">
              <div className={styles.answerHeader}>
                <strong>Answer from TradeOS records</strong>
                {speechOutputSupported ? <button type="button" className={styles.readAloud}
                  onClick={readAnswerAloud}>Read aloud</button> : null}
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
