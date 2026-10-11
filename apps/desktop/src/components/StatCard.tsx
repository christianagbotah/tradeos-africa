/**
 * StatCard — KPI card for the Dashboard.
 * Presentational; tone drives the icon chip colour.
 */
import type { ReactNode } from "react";

export type StatTone = "positive" | "warning" | "info" | "gold";

export interface StatCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: StatTone;
  hint?: ReactNode;
  hintTone?: "positive" | "warning" | "danger" | "neutral";
}

export function StatCard({
  label,
  value,
  icon,
  tone = "info",
  hint,
  hintTone = "neutral",
}: StatCardProps) {
  return (
    <article className="dsk-stat">
      <div className="dsk-stat__head">
        <span className="dsk-stat__label">{label}</span>
        <span className={`dsk-stat__icon dsk-stat__icon--${tone}`} aria-hidden>
          {icon}
        </span>
      </div>
      <div className="dsk-stat__value tnum">{value}</div>
      {hint ? (
        <div className="dsk-stat__hint" data-tone={hintTone === "neutral" ? undefined : hintTone}>
          {hint}
        </div>
      ) : null}
    </article>
  );
}
