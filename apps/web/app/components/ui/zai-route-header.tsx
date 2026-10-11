import type { ReactNode } from "react";

type Props = {
  kicker?: string;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  action?: ReactNode;
};

export function ZaiRouteHeader({ kicker, title, subtitle, status, action }: Props) {
  return (
    <header className="zai-route-header">
      <div className="zai-route-header-copy">
        {kicker ? <p className="zai-route-kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="zai-route-subtitle">{subtitle}</p> : null}
      </div>
      {status || action ? <div className="zai-route-header-actions">{status}{action}</div> : null}
    </header>
  );
}
