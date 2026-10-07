import React, { type ReactNode } from "react";

type Props = { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string };

export function DataCard({ title, subtitle, action, children, className = "" }: Props) {
  return <section className={`tradeos-data-card ${className}`.trim()}><div className="tradeos-card-heading"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>{action}</div><div className="tradeos-data-card-body">{children}</div></section>;
}
