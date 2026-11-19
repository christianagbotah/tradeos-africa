"use client";

import { useEffect, useState } from "react";

export type ActionFeedbackTone = "success" | "error" | "info" | "warning";
export interface ActionFeedback {
  tone: ActionFeedbackTone;
  message: string;
  title?: string | undefined;
}

interface FeedbackToast extends ActionFeedback {
  id: number;
  expiresAt: number | null;
}

const EVENT_NAME = "tradeos:action-feedback";
let nextToastId = 0;

/**
 * Publish a completed CRUD result from any client component without scrolling
 * the page. Only call after the server confirms success, or with an error
 * actually returned by the operation. Queued offline work is NOT "saved".
 */
export function notifyAction(feedback: ActionFeedback): void {
  if (typeof window === "undefined" || !feedback.message.trim()) return;
  window.dispatchEvent(new CustomEvent<ActionFeedback>(EVENT_NAME, { detail: feedback }));
}

const defaultTitle: Record<ActionFeedbackTone, string> = {
  success: "Saved successfully",
  error: "Action could not be completed",
  info: "Information",
  warning: "Attention needed",
};
const symbol: Record<ActionFeedbackTone, string> = {
  success: "✓", error: "!", info: "i", warning: "!",
};

export function ActionFeedbackViewport() {
  const [toasts, setToasts] = useState<FeedbackToast[]>([]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ActionFeedback>).detail;
      if (!detail || !["success", "error", "info", "warning"].includes(detail.tone)
        || typeof detail.message !== "string" || !detail.message.trim()) return;
      const message = detail.message.trim();
      const now = Date.now();
      setToasts((current) => {
        // A domain-specific message replaces a generic queue-sync success.
        // If the custom message came first, don't add a generic duplicate.
        const genericMessage = "Changes saved successfully.";
        if (message === genericMessage && current.some((item) =>
          item.tone === "success" && item.message !== genericMessage &&
          item.expiresAt !== null && item.expiresAt - now > 4700)) return current;
        const existing = message !== genericMessage
          ? current.filter((item) => !(item.tone === "success" && item.message === genericMessage &&
              item.expiresAt !== null && item.expiresAt - now > 3500))
          : current;
        if (existing.some((item) => item.message === message && item.tone === detail.tone
          && item.expiresAt !== null && item.expiresAt - now > 3500)) return existing;
        const entry: FeedbackToast = {
          ...detail, message, id: ++nextToastId,
          expiresAt: detail.tone === "error" ? null : now + (detail.tone === "success" ? 5500 : 7000),
        };
        return [...existing, entry].slice(-3);
      });
    };
    window.addEventListener(EVENT_NAME, receive);
    return () => window.removeEventListener(EVENT_NAME, receive);
  }, []);

  useEffect(() => {
    const expiries = toasts.filter((toast) => toast.expiresAt !== null);
    if (!expiries.length) return;
    const next = Math.min(...expiries.map((toast) => toast.expiresAt!));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setToasts((current) => current.filter((toast) =>
        toast.expiresAt === null || toast.expiresAt > now));
    }, Math.max(0, next - Date.now()) + 10);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className="tos-action-feedback" aria-label="Action notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`tos-action-feedback__toast tos-action-feedback__toast--${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}>
          <span className="tos-action-feedback__symbol" aria-hidden="true">
            {symbol[toast.tone]}
          </span>
          <div className="tos-action-feedback__text">
            <strong>{toast.title ?? defaultTitle[toast.tone]}</strong>
            <p>{toast.message}</p>
          </div>
          <button type="button" className="tos-action-feedback__close"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
            aria-label="Dismiss notification">×</button>
        </div>
      ))}
    </div>
  );
}

/** Surface existing action feedback state (including after a nested panel
 * closes). Normal data loads should not call this hook unless an alert is useful.
 */
export function useActionFeedbackMessages(success?: string | null, error?: string | null) {
  useEffect(() => {
    if (success) notifyAction({ tone: "success", message: success });
  }, [success]);
  useEffect(() => {
    if (error) notifyAction({ tone: "error", message: error });
  }, [error]);
}

export function useActionFeedbackState(feedback: ActionFeedback | null) {
  const tone = feedback?.tone;
  const message = feedback?.message;
  const title = feedback?.title;
  useEffect(() => {
    if (tone && message) notifyAction({ tone, message, title });
  }, [tone, message, title]);
}
