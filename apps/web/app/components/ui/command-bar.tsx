import React, { type ReactNode } from "react";

/**
 * CommandBar — presentational command row for list/report pages.
 *
 * Holds search/filter/sort controls (children) and an optional primary action.
 * Stable class name `tradeos-command-bar` is part of the design-system contract.
 *
 * Presentational only: no business API, no workspace state, no routing.
 */
export function CommandBar({
  ariaLabel,
  primaryAction,
  children,
}: {
  ariaLabel: string;
  primaryAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tradeos-command-bar" aria-label={ariaLabel} role="group">
      <div className="tradeos-command-bar__controls">{children}</div>
      {primaryAction ? (
        <div className="tradeos-command-bar__primary">{primaryAction}</div>
      ) : null}
    </div>
  );
}
