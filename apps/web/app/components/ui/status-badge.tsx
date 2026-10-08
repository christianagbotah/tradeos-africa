import React, { type ReactNode } from "react";

type Props = { children: ReactNode; tone?: "neutral" | "positive" | "warning" | "danger" | "info" };

export function StatusBadge({ children, tone = "neutral" }: Props) {
  return <span className={`tradeos-status-badge ${tone}`}>{children}</span>;
}
