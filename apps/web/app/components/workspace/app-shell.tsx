"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NetworkStatus } from "../network-status";
import { useWorkspace } from "./use-workspace";
import { isWorkspaceNavActive, visibleWorkspaceNav } from "./workspace-navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerPanelRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const { session, context, branchId, activeBranch, setBusiness, setBranch, logout } = useWorkspace();
  const navItems = useMemo(() => visibleWorkspaceNav(context.membership.role), [context.membership.role]);
  const activeBranches = useMemo(() => context.branches.filter((branch) => branch.active), [context.branches]);
  const current = navItems.find((item) => isWorkspaceNavActive(pathname, item.href));
  const groups = ["Overview", "Commerce", "Money", "Operations", "Insights"] as const;
  const userInitials = session.user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const panel = drawerPanelRef.current;
    panel?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const businessBranchSelectors = (
    <>
      {session.memberships.length > 1 ? (
        <label className="workspace-context-field"><span>Business</span><select value={context.business.id} onChange={(event) => void setBusiness(event.target.value)}>{session.memberships.map((membership) => <option key={membership.businessId} value={membership.businessId}>{membership.businessName}</option>)}</select></label>
      ) : <span className="workspace-business-name">{context.business.name}</span>}
      {activeBranches.length > 1 ? (
        <label className="workspace-context-field"><span>Branch</span><select value={branchId} onChange={(event) => setBranch(event.target.value)}>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      ) : null}
    </>
  );

  const contextSelectors = (
    <>
      {businessBranchSelectors}
      <div className="workspace-user-chip"><strong>{session.user.displayName}</strong><span>{context.membership.role}</span></div>
    </>
  );

  const navigation = (
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
                <Link className={active ? "workspace-nav-item active" : "workspace-nav-item"} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setDrawerOpen(false)}>
                  <span className="workspace-nav-dot" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
        {navigation}
        <div className="workspace-sidebar-footer">
          <NetworkStatus />
          <button className="workspace-signout" type="button" onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>

      <div className={drawerOpen ? "workspace-mobile-drawer open" : "workspace-mobile-drawer"} aria-hidden={!drawerOpen}>
        <button className="workspace-drawer-backdrop" type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
        <aside id="workspace-mobile-navigation" ref={drawerPanelRef} className="workspace-drawer-panel" role="dialog" aria-modal="true" aria-label="TradeOS navigation" tabIndex={-1}>
          <div className="workspace-brand"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
          <div className="workspace-drawer-context">{contextSelectors}</div>
          {navigation}
          <div className="workspace-sidebar-footer">
            <NetworkStatus />
            <button className="workspace-signout" type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </aside>
      </div>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-title">
            <button ref={menuButtonRef} className="workspace-menu-button" type="button" aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="workspace-mobile-navigation" onClick={() => setDrawerOpen(true)}>☰</button>
            <div>
              <span className="workspace-breadcrumb">{current?.group ?? "TradeOS"} · {activeBranch.name}</span>
              <h1>{current?.label ?? context.business.name}</h1>
            </div>
          </div>
          <div className="workspace-context-actions">
            {businessBranchSelectors}
            <div className="workspace-profile-menu" ref={profileMenuRef}>
              <button
                className="workspace-profile-trigger"
                type="button"
                aria-label="Open user menu"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="workspace-profile-avatar" aria-hidden="true">{userInitials}</span>
                <span className="workspace-profile-copy"><strong>{session.user.displayName}</strong><small>{context.membership.role}</small></span>
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
    </main>
  );
}
