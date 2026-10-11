"use client";

import type { ReactNode } from "react";
import { IconAlert, IconInfo, IconRefresh } from "./icons";
import { Button } from "./button";

export type StateVariant = "empty" | "loading" | "error";

export interface StatePanelProps {
  variant: StateVariant;
  title?: string;
  text?: string;
  icon?: ReactNode;
  inline?: boolean;
  bare?: boolean;
  /** Action button label (e.g. "Retry", "Add item"). */
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  /** Secondary action label. */
  secondaryLabel?: string | undefined;
  onSecondary?: (() => void) | undefined;
  children?: ReactNode;
}

export function StatePanel({
  variant,
  title,
  text,
  icon,
  inline = false,
  bare = false,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  children,
}: StatePanelProps) {
  const cls = [
    "tos-state",
    inline ? " tos-state--inline" : "",
    bare ? " tos-state--bare" : "",
  ].join("");

  const defaultTitle =
    variant === "loading" ? "Loading…" : variant === "error" ? "Something went wrong" : "Nothing here yet";
  const defaultText =
    variant === "loading"
      ? "Please wait while we fetch the latest data."
      : variant === "error"
        ? "We could not complete the request. Try again, or check your connection."
        : "No records to show yet.";

  return (
    <div className={cls} role={variant === "loading" ? "status" : undefined}>
      <div className="tos-state__icon-wrap" aria-hidden="true">
        {variant === "loading" ? (
          <span className="tos-state__spinner" />
        ) : icon ? (
          icon
        ) : variant === "error" ? (
          <IconAlert className="tos-state__icon" />
        ) : (
          <IconInfo className="tos-state__icon" />
        )}
      </div>
      <h3 className="tos-state__title">{title ?? defaultTitle}</h3>
      {text ? <p className="tos-state__text">{text}</p> : null}
      {children ? <div className="tos-state__text">{children}</div> : null}
      {(actionLabel || secondaryLabel) && (variant !== "loading") ? (
        <div className="tos-state__actions">
          {actionLabel && onAction ? (
            <Button size="sm" variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={onAction}>
              {actionLabel}
            </Button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <Button size="sm" variant="ghost" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Convenience wrapper for honest "no data yet" states. */
export function EmptyState(props: Omit<StatePanelProps, "variant">) {
  return <StatePanel variant="empty" {...props} />;
}

/** Convenience wrapper for honest loading states. */
export function LoadingState(props: Omit<StatePanelProps, "variant">) {
  return <StatePanel variant="loading" {...props} />;
}

/** Convenience wrapper for honest error states. */
export function ErrorState(props: Omit<StatePanelProps, "variant">) {
  return <StatePanel variant="error" {...props} />;
}
