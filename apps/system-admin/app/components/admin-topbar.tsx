"use client";

import type { ReactNode } from "react";
import { IconClose, IconMenu, IconShield } from "./icons";

interface AdminTopbarProps {
  crumb: string;
  title: string;
  /** Display name shown for the signed-in operator. */
  adminName: string;
  /** Role label, e.g. "Super admin". */
  adminRole: string;
  /** Initials shown in the avatar circle. */
  adminInitials: string;
  /** Right-hand actions slot (rendered before the privileged chip + profile). */
  actions?: ReactNode;
  /** Called when the mobile menu button is activated. */
  onMenuClick: () => void;
  /** Whether the mobile drawer is currently open (toggles button icon). */
  menuOpen: boolean;
}

export function AdminTopbar({
  crumb,
  title,
  adminName,
  adminRole,
  adminInitials,
  actions,
  onMenuClick,
  menuOpen,
}: AdminTopbarProps) {
  return (
    <header className="admin-topbar" role="banner">
      <button
        type="button"
        className="admin-topbar__menu-btn"
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={menuOpen}
        aria-controls="admin-sidebar"
        onClick={onMenuClick}
      >
        {menuOpen ? <IconClose width={18} height={18} /> : <IconMenu width={18} height={18} />}
      </button>

      <div className="admin-topbar__title-block">
        <span className="admin-topbar__crumb">{crumb}</span>
        <h1 className="admin-topbar__title">{title}</h1>
      </div>

      <div className="admin-topbar__spacer" />

      {actions}

      <span className="admin-topbar__privileged" title="Privileged access — all actions are audited">
        <IconShield width={13} height={13} />
        <span className="admin-topbar__privileged-dot" aria-hidden="true" />
        Privileged access
      </span>

      <div className="admin-topbar__profile" title={`${adminName} · ${adminRole}`}>
        <span className="admin-topbar__avatar" aria-hidden="true">
          {adminInitials}
        </span>
        <span className="admin-topbar__profile-text">
          <span className="admin-topbar__profile-name">{adminName}</span>
          <span className="admin-topbar__profile-role">{adminRole}</span>
        </span>
      </div>
    </header>
  );
}
