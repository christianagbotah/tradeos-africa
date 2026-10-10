"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NetworkStatus } from "../network-status";
import { useWorkspace } from "./use-workspace";
import { isWorkspaceNavActive, visibleWorkspaceNav } from "./workspace-navigation";
import { WorkspaceNavIcon } from "./workspace-nav-icon";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileMoreSheet } from "./mobile-more-sheet";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const { session, context, branchId, activeBranch, setBusiness, setBranch, logout } = useWorkspace();
  const navItems = useMemo(() => visibleWorkspaceNav(context.membership.role), [context.membership.role]);
  const activeBranches = useMemo(() => context.branches.filter((branch) => branch.active), [context.branches]);
  const current = navItems.find((item) => isWorkspaceNavActive(pathname, item.href));
  const groups = ["Overview", "Commerce", "Money", "Operations", "Insights"] as const;
  const userInitials = session.user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: MouseEvent) => { if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setProfileOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [profileOpen]);

  const businessBranchSelectors = (
    <div className="workspace-context-unit">
      {session.memberships.length > 1 ? (
        <label className="workspace-context-field"><span>Business</span><select value={context.business.id} onChange={(event) => void setBusiness(event.target.value)}>{session.memberships.map((membership) => <option key={membership.businessId} value={membership.businessId}>{membership.businessName}</option>)}</select></label>
      ) : <span className="workspace-business-name">{context.business.name}</span>}
      {activeBranches.length > 1 ? (
        <label className="workspace-context-field"><span>Branch</span><select value={branchId} onChange={(event) => setBranch(event.target.value)}>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      ) : null}
    </div>
  );

  const moreContext = (
    <>{businessBranchSelectors}<div className="workspace-more-user"><strong>{session.user.displayName}</strong><span>{context.membership.role}</span></div><NetworkStatus /></>
  );

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <div className="brand-mark">T</div>
          <div><strong>TradeOS</strong><span>Africa</span></div>
        </div>
        <nav className="workspace-nav" aria-label="Primary navigation">
          {groups.map((group) => {
            const items = navItems.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div className="workspace-nav-group" key={group}>
                <span className="workspace-nav-label">{group}</span>
                {items.map((item) => {
                  const active = isWorkspaceNavActive(pathname, item.href);
                  return (
                    <Link
                      className={active ? "workspace-nav-item active" : "workspace-nav-item"}
                      href={item.href}
                      key={item.href}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="workspace-nav-icon-box"><WorkspaceNavIcon name={item.icon} /></span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="workspace-sidebar-footer">
          <NetworkStatus />
          <button className="workspace-signout" type="button" onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-title">
            <div className="workspace-mobile-brandmark" aria-hidden="true">T</div>
            <div>
              <span className="workspace-breadcrumb">{current?.group ?? "TradeOS"} · {activeBranch.name}</span>
              <h1>{current?.label ?? context.business.name}</h1>
            </div>
          </div>
          <button
            className="workspace-mobile-context-trigger"
            type="button"
            aria-label="Open business and branch context"
            onClick={() => setMoreOpen(true)}
          >
            <span className="workspace-mobile-context-copy">
              <strong>{context.business.name}</strong>
              <small>{activeBranch.name}</small>
            </span>
            <span className="workspace-mobile-context-chevron" aria-hidden="true">›</span>
          </button>
          <div className="workspace-context-actions">
            {businessBranchSelectors}
            <div className="workspace-profile-menu" ref={profileMenuRef}>
              <button
                className="workspace-profile-trigger"
                type="button"
                aria-label="Open user menu"
                title="Account & sign out"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="workspace-profile-avatar" aria-hidden="true">{userInitials}</span>
                <span className="workspace-profile-copy">
                  <strong>{session.user.displayName}</strong>
                  <small>{context.membership.role}</small>
                </span>
                <span className="workspace-profile-chevron" aria-hidden="true">⌄</span>
              </button>
              {profileOpen ? (
                <div className="workspace-profile-dropdown" role="menu">
                  <div className="workspace-profile-summary">
                    <span>Signed in as</span>
                    <strong>{session.user.displayName}</strong>
                    <small>{context.business.name} · {activeBranch.name}</small>
                  </div>
                  <button className="workspace-profile-signout" type="button" role="menuitem" onClick={() => void logout()}>Sign out</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div key={`${context.business.id}:${branchId}`} className="workspace-content">{children}</div>
      </section>

      <MobileBottomNav role={context.membership.role} pathname={pathname} onOpenMore={() => setMoreOpen(true)} />
      <MobileMoreSheet open={moreOpen} role={context.membership.role} pathname={pathname} onClose={() => setMoreOpen(false)} businessContext={moreContext} onLogout={logout} />
    </main>
  );
}
