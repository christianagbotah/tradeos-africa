import React, { type ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  status?: ReactNode;
};

export function PageHeader({ eyebrow, title, subtitle, action, status }: Props) {
  return (
    <header className="tradeos-page-header">
      <div className="tradeos-page-header-copy">
        {eyebrow ? <p  className="tradeos-page-tradeos-kicker">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="tradeos-page-subtitle">{subtitle}</p> : null}
      </div>
      {status || action ? <div className="tradeos-page-header-actions">{status}{action}</div> : null}
    </header>
  );
}
