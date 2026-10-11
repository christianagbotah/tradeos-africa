import type { ComponentType, ReactNode, SVGProps } from "react";
import { IconInbox } from "./icons";

interface AdminEmptyStateProps {
  /** Headline, e.g. "No tenants loaded". */
  title: string;
  /** Supporting copy explaining the state. */
  description: ReactNode;
  /** Optional icon. Defaults to an inbox glyph. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** When true, renders a "Pending backend" tag beneath the description. */
  pending?: boolean;
  /** Optional call-to-action rendered beneath the copy. */
  action?: ReactNode;
}

export function AdminEmptyState({
  title,
  description,
  icon: Icon = IconInbox,
  pending = false,
  action,
}: AdminEmptyStateProps) {
  return (
    <div className="admin-empty" role="status">
      <span className="admin-empty__icon-wrap" aria-hidden="true">
        <Icon className="admin-empty__icon" />
      </span>
      <h2 className="admin-empty__title">{title}</h2>
      <p className="admin-empty__text">{description}</p>
      {pending ? <span className="admin-empty__pending-tag">Pending backend</span> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
