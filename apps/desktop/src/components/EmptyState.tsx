/**
 * EmptyState — consistent empty / loading / pending state.
 * Used by every list screen and inside empty table rows.
 */
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  text?: ReactNode;
  tag?: string | undefined;
  action?: ReactNode;
  dense?: boolean;
}

export function EmptyState({ icon, title, text, tag, action, dense }: EmptyStateProps) {
  return (
    <div className="dsk-empty" role="status" style={dense ? { minHeight: "auto", padding: "var(--tos-space-6)" } : undefined}>
      <div className="dsk-empty__icon" aria-hidden>
        {icon}
      </div>
      <div className="dsk-empty__title">{title}</div>
      {text ? <div className="dsk-empty__text">{text}</div> : null}
      {tag ? <span className="dsk-empty__tag">{tag}</span> : null}
      {action ? <div style={{ marginTop: "var(--tos-space-1)" }}>{action}</div> : null}
    </div>
  );
}
