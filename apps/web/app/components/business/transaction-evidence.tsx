"use client";

import React from "react";

export type TransactionSyncState = "PENDING" | "APPLIED" | "NEEDS_REVIEW";

export function TransactionStatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  return <span className={`transaction-status-badge transaction-status-badge--${tone}`}>{label ?? title(status)}</span>;
}

export function transactionSyncCopy(state: TransactionSyncState, subject: string): string {
  if (state === "NEEDS_REVIEW") return `${subject} needs review before it can be applied.`;
  if (state === "PENDING") return `${subject} is saved and pending synchronization.`;
  return `${subject} applied successfully.`;
}

export function TransactionSyncNotice({ state, subject, detail }: { state: TransactionSyncState; subject: string; detail?: string }) {
  return (
    <div className={`transaction-sync-notice transaction-sync-notice--${state.toLowerCase().replaceAll("_", "-")}`} role="status">
      <TransactionStatusBadge status={state} />
      <div><strong>{transactionSyncCopy(state, subject)}</strong>{detail ? <span>{detail}</span> : null}</div>
    </div>
  );
}

export function PostedHistoryNote({ subject, correction, title: heading }: { subject: string; correction: string; title?: string }) {
  return (
    <section className="transaction-posted-note">
      <strong>{heading ?? `${subject} is read-only after posting.`}</strong>
      <span>TradeOS never edits or deletes posted business evidence. Corrections are recorded as {correction} with their own actor, reason and audit trail.</span>
    </section>
  );
}

export function ActorReasonEvidence({ actor, reason, reference }: { actor: string | null | undefined; reason: string; reference?: string | null }) {
  return (
    <div className="transaction-actor-reason">
      <div><span>Actor</span><strong>{actor?.trim() || "System"}</strong></div>
      <div><span>Reason</span><strong>{humanize(reason)}</strong></div>
      {reference ? <div><span>Reference</span><strong>{reference}</strong></div> : null}
    </div>
  );
}

function statusTone(status: string): "positive" | "warning" | "danger" | "neutral" {
  const normalized = status.toUpperCase();
  if (["COMPLETED", "APPLIED", "SUCCEEDED", "RECEIVED"].includes(normalized)) return "positive";
  if (["PROCESSING", "PENDING", "PARTIALLY_REFUNDED", "PARTIALLY_REVERSED"].includes(normalized)) return "warning";
  if (["NEEDS_REVIEW", "REJECTED", "FAILED", "CANCELLED"].includes(normalized)) return "danger";
  return "neutral";
}
function humanize(value: string): string { return value.replaceAll("_", " "); }
function title(value: string): string { const text = humanize(value).toLowerCase(); return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text; }
