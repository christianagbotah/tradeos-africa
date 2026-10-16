"use client";

export interface ApprovalCardProps {
  proposedAction: string;
  impact: string;
  target: string;
  evidence: unknown[];
  requiredRole: string;
  reason: string;
  onReasonChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
}

export function ApprovalCard({
  proposedAction,
  impact,
  target,
  evidence,
  requiredRole,
  reason,
  onReasonChange,
  onApprove,
  onReject,
  busy = false,
}: ApprovalCardProps) {
  function confirmDecision(kind: "approve" | "reject") {
    if (!reason.trim()) return;
    const accepted = window.confirm(
      kind === "approve"
        ? `Approve this automation action for ${target}?`
        : `Reject this automation action for ${target}?`,
    );
    if (!accepted) return;
    if (kind === "approve") onApprove();
    else onReject();
  }

  return (
    <article className="admin-approval-card">
      <div className="admin-ai-card__head">
        <div>
          <span className="admin-ai-kicker">Approval required</span>
          <h3>{proposedAction}</h3>
        </div>
        <span className="admin-ai-role">{requiredRole}</span>
      </div>

      <div className="admin-ai-facts">
        <div><span>Target</span><strong>{target}</strong></div>
        <div><span>Impact</span><strong>{impact}</strong></div>
      </div>

      <div className="admin-ai-evidence">
        <strong>Evidence</strong>
        {evidence.length === 0 ? <span>No structured evidence attached.</span> : evidence.slice(0, 5).map((item, index) => (
          <span key={index}>{summarize(item)}</span>
        ))}
      </div>

      <label className="admin-ai-reason">
        <span>Decision reason</span>
        <textarea
          className="admin-field__input admin-billing-textarea"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="Why is this action safe or inappropriate?"
          maxLength={500}
          disabled={busy}
        />
      </label>

      <div className="admin-ai-actions">
        <button type="button" className="admin-primary-button" disabled={busy || !reason.trim()} onClick={() => confirmDecision("approve")}>
          Approve
        </button>
        <button type="button" className="admin-secondary-button" disabled={busy || !reason.trim()} onClick={() => confirmDecision("reject")}>
          Reject
        </button>
      </div>
    </article>
  );
}

function summarize(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const source = typeof record.sourceType === "string" ? record.sourceType : typeof record.label === "string" ? record.label : "Evidence";
    const id = typeof record.sourceId === "string" ? record.sourceId : typeof record.id === "string" ? record.id : "record";
    return `${source}: ${id}`;
  }
  return "Structured evidence";
}
