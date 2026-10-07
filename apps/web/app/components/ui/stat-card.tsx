import React, { type ReactNode } from "react";

type Props = { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "positive" | "warning" | "danger" | "dark" };

export function StatCard({ label, value, hint, tone = "default" }: Props) {
  return <article className={`tradeos-stat-card ${tone}`}><span>{label}</span><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</article>;
}
