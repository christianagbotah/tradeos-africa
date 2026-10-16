import Link from "next/link";

export interface AiInsightCardProps {
  finding: string;
  severity: string;
  evidence: unknown[];
  confidence?: number | null;
  recommendation: string;
  recordHref?: string | null;
  generatedAt: string;
}

export function AiInsightCard({
  finding,
  severity,
  evidence,
  confidence = null,
  recommendation,
  recordHref,
  generatedAt,
}: AiInsightCardProps) {
  return (
    <article className="admin-ai-card admin-insight-card">
      <div className="admin-ai-card__head">
        <div>
          <span className="admin-ai-kicker">{severity}</span>
          <h3>{finding}</h3>
        </div>
        {confidence == null ? null : <span className="admin-ai-confidence">{Math.round(confidence * 100)}% confidence</span>}
      </div>
      <p>{recommendation}</p>
      <div className="admin-ai-evidence" aria-label="Evidence">
        <strong>Evidence</strong>
        {evidence.length === 0 ? <span>No structured evidence attached.</span> : evidence.slice(0, 4).map((item, index) => (
          <span key={index}>{formatEvidence(item)}</span>
        ))}
      </div>
      <div className="admin-ai-card__footer">
        <small>Generated {formatTime(generatedAt)}</small>
        {recordHref ? <Link href={recordHref}>Authoritative record</Link> : null}
      </div>
    </article>
  );
}

function formatEvidence(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : typeof record.sourceType === "string" ? record.sourceType : "Evidence";
    const detail = record.value ?? record.sourceId ?? record.id ?? "available";
    return `${label}: ${typeof detail === "string" || typeof detail === "number" || typeof detail === "boolean" ? String(detail) : "structured record"}`;
  }
  return "Structured evidence";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
