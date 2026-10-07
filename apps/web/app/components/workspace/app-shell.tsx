"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { NetworkStatus } from "../network-status";
import { useWorkspace } from "./use-workspace";
import { isWorkspaceNavActive, visibleWorkspaceNav } from "./workspace-navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { session, context, branchId, activeBranch, setBusiness, setBranch, logout } = useWorkspace();
  const navItems = useMemo(() => visibleWorkspaceNav(context.membership.role), [context.membership.role]);
  const current = navItems.find((item) => isWorkspaceNavActive(pathname, item.href));
  const groups = ["Overview", "Commerce", "Money", "Operations", "Insights"] as const;

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
                <Link
                  className={active ? "workspace-nav-item active" : "workspace-nav-item"}
                  href={item.href}
                  key={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setDrawerOpen(false)}
                >
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
        <aside className="workspace-drawer-panel">
          <div className="workspace-brand"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
          {navigation}
        </aside>
      </div>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-title">
            <button className="workspace-menu-button" type="button" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>☰</button>
            <div>
              <span className="workspace-breadcrumb">{current?.group ?? "TradeOS"} · {activeBranch.name}</span>
              <h1>{current?.label ?? context.business.name}</h1>
            </div>
          </div>
          <div className="workspace-context-actions">
            {session.memberships.length > 1 ? (
              <label className="workspace-context-field"><span>Business</span><select value={context.business.id} onChange={(event) => void setBusiness(event.target.value)}>{session.memberships.map((membership) => <option key={membership.businessId} value={membership.businessId}>{membership.businessName}</option>)}</select></label>
            ) : <span className="workspace-business-name">{context.business.name}</span>}
            {context.branches.filter((branch) => branch.active).length > 1 ? (
              <label className="workspace-context-field"><span>Branch</span><select value={branchId} onChange={(event) => setBranch(event.target.value)}>{context.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            ) : null}
            <div className="workspace-user-chip"><strong>{session.user.displayName}</strong><span>{context.membership.role}</span></div>
          </div>
        </header>
        <div className="workspace-content">{children}</div>
      </section>
    </main>
  );
}
