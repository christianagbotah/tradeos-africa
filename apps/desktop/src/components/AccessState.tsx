/**
 * AccessState — truthful empty/error state for screens that depend on a live
 * API session. Renders ONE of:
 *
 *   - "sign-in-required"   — no session; user must sign in.
 *   - "needs-business"     — session OK but no active business membership.
 *   - "session-expired"    — tokens revoked / refresh failed; re-sign-in.
 *   - "api-unavailable"    — network error or 5xx; retry.
 *   - "permission-denied"  — 403 from the API.
 *   - "no-data-offline"    — offline and no cached data.
 *   - "sync-pending"       — queue has pending mutations; informational.
 *   - "sync-failed"        — queue has rejected mutations; review needed.
 *
 * Each state is rendered as an EmptyState with the right icon, title, text
 * and (where useful) a CTA. Never silently falls back to sample data.
 */
import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState.js";
import {
  IconUser,
  IconBox,
  IconAlert,
  IconWifiOff,
  IconClock,
  IconInfo,
  IconLogIn,
  IconRefresh,
} from "./icons.js";

export type AccessStateKind =
  | "sign-in-required"
  | "needs-business"
  | "session-expired"
  | "api-unavailable"
  | "permission-denied"
  | "no-data-offline"
  | "sync-pending"
  | "sync-failed";

export interface AccessStateProps {
  kind: AccessStateKind;
  onSignIn?: () => void;
  onRetry?: () => void;
  detail?: string;
}

export function AccessState({ kind, onSignIn, onRetry, detail }: AccessStateProps) {
  const config = CONFIG[kind];
  const action: ReactNode | undefined =
    config.actionKind === "sign-in" && onSignIn ? (
      <button type="button" className="dsk-btn dsk-btn--primary dsk-btn--sm" onClick={onSignIn}>
        <IconLogIn width={14} height={14} />
        Sign in
      </button>
    ) : config.actionKind === "retry" && onRetry ? (
      <button type="button" className="dsk-btn dsk-btn--outline dsk-btn--sm" onClick={onRetry}>
        <IconRefresh width={14} height={14} />
        Retry
      </button>
    ) : undefined;

  return (
    <div className="dsk-card">
      <EmptyState
        icon={config.icon}
        title={config.title}
        text={
          <>
            {config.text}
            {detail ? <div style={{ marginTop: 8, fontFamily: "var(--tos-font-mono)", fontSize: 11, color: "var(--tos-text-soft)" }}>{detail}</div> : null}
          </>
        }
        action={action}
      />
    </div>
  );
}

const CONFIG: Record<
  AccessStateKind,
  { icon: ReactNode; title: string; text: ReactNode; actionKind?: "sign-in" | "retry" }
> = {
  "sign-in-required": {
    icon: <IconUser width={44} height={44} />,
    title: "Sign in required",
    text: "Sign in to a TradeOS business to load live sales, inventory and customers.",
    actionKind: "sign-in",
  },
  "needs-business": {
    icon: <IconBox width={44} height={44} />,
    title: "Business connection required",
    text: "Your account has no active business membership. Ask an owner to invite you, or sign in with a different account.",
  },
  "session-expired": {
    icon: <IconClock width={44} height={44} />,
    title: "Session expired",
    text: "Your TradeOS session has expired. Sign in again to continue.",
    actionKind: "sign-in",
  },
  "api-unavailable": {
    icon: <IconWifiOff width={44} height={44} />,
    title: "API unavailable",
    text: "TradeOS could not reach the API. Check your network or the API base URL, then retry.",
    actionKind: "retry",
  },
  "permission-denied": {
    icon: <IconAlert width={44} height={44} />,
    title: "Permission denied",
    text: "Your current role does not have permission to view this data. Contact your business owner.",
  },
  "no-data-offline": {
    icon: <IconWifiOff width={44} height={44} />,
    title: "No saved data available offline",
    text: "You're offline and this screen has no cached data. Reconnect to load it.",
    actionKind: "retry",
  },
  "sync-pending": {
    icon: <IconClock width={44} height={44} />,
    title: "Sync pending",
    text: "Some sales are queued for sync and will be sent automatically when back online.",
  },
  "sync-failed": {
    icon: <IconAlert width={44} height={44} />,
    title: "Sync failed / needs review",
    text: "One or more queued mutations were rejected by the server. Review them in the sync panel.",
  },
};

export function IconInfoFallback() {
  return <IconInfo width={44} height={44} />;
}
