import React, { type ReactNode } from "react";

/**
 * MobileRecordCard — touch-friendly record representation for mobile lists.
 *
 * Replaces dense desktop table rows on narrow screens. Stable class name
 * `tradeos-mobile-record-card` is part of the design-system contract.
 *
 * Presentational only: no business API, no workspace state, no routing.
 */
export function MobileRecordCard({
  title,
  meta,
  status,
  actions,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="tradeos-mobile-record-card">
      <header className="tradeos-mobile-record-card__head">
        <div className="tradeos-mobile-record-card__title">{title}</div>
        {status ? (
          <div className="tradeos-mobile-record-card__status">{status}</div>
        ) : null}
      </header>
      {meta ? <div className="tradeos-mobile-record-card__meta">{meta}</div> : null}
      {children ? (
        <div className="tradeos-mobile-record-card__body">{children}</div>
      ) : null}
      {actions ? (
        <div className="tradeos-mobile-record-card__actions">{actions}</div>
      ) : null}
    </article>
  );
}
