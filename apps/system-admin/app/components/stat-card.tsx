import type { ComponentType, ReactNode, SVGProps } from "react";

export type StatCardTone = "default" | "pending";

interface StatCardProps {
  label: string;
  /** Primary value. Pass "—" or similar when the metric is unavailable. */
  value: ReactNode;
  /** Supporting line under the value. */
  hint: ReactNode;
  /** Optional icon shown next to the label. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Visual tone — "pending" renders the hint dot in warning color. */
  tone?: StatCardTone;
}

export function StatCard({ label, value, hint, icon: Icon, tone = "default" }: StatCardProps) {
  const isPending = tone === "pending";
  return (
    <article className="admin-stat-card" aria-label={label}>
      <span className="admin-stat-card__label">
        {Icon ? <Icon className="admin-stat-card__icon" /> : null}
        {label}
      </span>
      <span className={isPending ? "admin-stat-card__value admin-stat-card__value--muted" : "admin-stat-card__value"}>
        {value}
      </span>
      <span className="admin-stat-card__hint">
        <span
          className={
            isPending
              ? "admin-stat-card__hint-dot admin-stat-card__hint-dot--pending"
              : "admin-stat-card__hint-dot"
          }
          aria-hidden="true"
        />
        {hint}
      </span>
    </article>
  );
}

interface StatCardGridProps {
  children: ReactNode;
}

export function StatCardGrid({ children }: StatCardGridProps) {
  return <div className="admin-stat-card__grid">{children}</div>;
}
