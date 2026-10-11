/**
 * Topbar — current screen title, global search, online/offline indicator,
 * profile / sign-in / sign-out. The search input is a real controlled input
 * wired to a callback so the active screen can react (e.g. POS product
 * search, Sales/Customer filter).
 *
 * The profile area shows one of three truthful states:
 *   - Signed out: a "Sign in" button.
 *   - Signed in: the user's display name + role + a "Sign out" button.
 *   - Demo mode: a "Demo mode" pill (no sign-in surface).
 */
import type { ReactNode } from "react";
import type { DesktopReadyState } from "../lib/desktop-runtime.js";
import { IconSearch, IconWifi, IconWifiOff, IconLogIn, IconLogOut } from "./icons.js";

export interface TopbarProps {
  crumb: string;
  title: string;
  online: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  actions?: ReactNode;
  ready: DesktopReadyState | null;
  demoMode: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function Topbar({
  crumb,
  title,
  online,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search products, sales, customers\u2026",
  actions,
  ready,
  demoMode,
  onSignIn,
  onSignOut,
}: TopbarProps) {
  const initials = ready ? ready.user.displayName.split(/\s+/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("") : "OP";
  return (
    <header className="dsk-topbar" role="banner">
      <div className="dsk-topbar__title-block">
        <span className="dsk-topbar__crumb">{crumb}</span>
        <h1 className="dsk-topbar__title">{title}</h1>
      </div>
      <div className="dsk-topbar__spacer" />
      {actions}
      <div className="dsk-search">
        <IconSearch className="dsk-search__icon" />
        <input
          type="search"
          className="dsk-search__input"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Global search"
        />
        <span className="dsk-search__kbd" aria-hidden>
          /
        </span>
      </div>
      <div
        className={`dsk-topbar__status ${online ? "" : "dsk-topbar__status--offline"}`}
        title={online ? "Connected to TradeOS API" : "Offline — sales will queue and sync automatically"}
      >
        {online ? <IconWifi width={14} height={14} /> : <IconWifiOff width={14} height={14} />}
        <span>{online ? "Online" : "Offline"}</span>
      </div>
      {demoMode ? (
        <span className="dsk-badge dsk-badge--warning" title="Demo mode is active — sample data only">
          Demo mode
        </span>
      ) : ready ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--tos-space-2)" }}>
          <button type="button" className="dsk-topbar__profile" aria-label="Operator profile" title={ready.business.name}>
            <span className="dsk-topbar__avatar" aria-hidden>
              {initials}
            </span>
            <span className="dsk-topbar__profile-text">
              <span className="dsk-topbar__profile-name">{ready.user.displayName}</span>
              <span className="dsk-topbar__profile-role">{ready.membership.role} · {ready.branch.name}</span>
            </span>
          </button>
          <button
            type="button"
            className="dsk-btn dsk-btn--ghost dsk-btn--sm"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <IconLogOut width={14} height={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="dsk-btn dsk-btn--primary dsk-btn--sm"
          onClick={onSignIn}
        >
          <IconLogIn width={14} height={14} />
          Sign in
        </button>
      )}
    </header>
  );
}
