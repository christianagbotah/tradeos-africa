"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavGroups } from "./nav";
import { IconLogout } from "./icons";

interface AdminSidebarProps {
  /** Controlled open state for the mobile drawer. */
  open: boolean;
  /** Called when a nav link is activated (used to close the drawer). */
  onNavigate: () => void;
  /** Called when the sign-out control is activated. */
  onSignOut: () => void;
}

export function AdminSidebar({ open, onNavigate, onSignOut }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="admin-sidebar"
      data-open={open ? "true" : "false"}
      aria-label="System admin navigation"
      aria-hidden={open ? undefined : "true"}
    >
      <div className="admin-sidebar__brand">
        <span className="admin-sidebar__mark" aria-hidden="true">
          T
        </span>
        <span className="admin-sidebar__brand-text">
          <span className="admin-sidebar__brand-name">TradeOS</span>
          <span className="admin-sidebar__brand-sub">System Admin</span>
        </span>
      </div>

      <nav className="admin-sidebar__nav" aria-label="Sections">
        {adminNavGroups.map((group) => (
          <div className="admin-sidebar__group" key={group.label}>
            <span className="admin-sidebar__group-label">{group.label}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="admin-sidebar__link"
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <Icon className="admin-sidebar__link-icon" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="admin-sidebar__footer">
        <div className="admin-sidebar__boundary">
          <span className="admin-sidebar__boundary-title">Platform boundary</span>
          <span className="admin-sidebar__boundary-text">
            This console is separate from tenant &amp; business administration. All actions are
            audited.
          </span>
        </div>
        <button type="button" className="admin-sidebar__signout" onClick={onSignOut}>
          <IconLogout className="admin-sidebar__signout-icon" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
