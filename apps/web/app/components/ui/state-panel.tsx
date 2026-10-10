import React, { type ReactNode } from "react";

/**
 * StatePanel — intentional loading/empty/error/offline/success state region.
 *
 * Stable class name `tradeos-state-panel` and the `tradeos-state-panel--{state}`
 * modifier are part of the design-system contract. Renders a `role="status"`
 * region so assistive tech announces state changes.
 *
 * Presentational only: no business API, no workspace state, no routing.
 */
export function StatePanel({
  state,
  title,
  description,
  action,
}: {
  state: "loading" | "empty" | "error" | "offline" | "success";
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={`tradeos-state-panel tradeos-state-panel--${state}`}
      role="status"
      aria-live="polite"
    >
      <div className="tradeos-state-panel__icon" aria-hidden="true" />
      <div className="tradeos-state-panel__copy">
        <p className="tradeos-state-panel__title">{title}</p>
        {description ? (
          <p className="tradeos-state-panel__description">{description}</p>
        ) : null}
        {action ? (
          <div className="tradeos-state-panel__action">{action}</div>
        ) : null}
      </div>
    </div>
  );
}
