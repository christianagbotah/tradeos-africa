"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NetworkStatus } from "../network-status";
import { useWorkspace } from "./use-workspace";
import { isWorkspaceNavActive, visibleWorkspaceNav, type WorkspaceNavGroup } from "./workspace-navigation";
import { WorkspaceNavIcon } from "./workspace-nav-icon";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileMoreSheet } from "./mobile-more-sheet";

const groups: WorkspaceNavGroup[] = ["Operate", "Inventory", "Money & People", "Operations", "Insights"];

const businessTypeLabel = (value: string) => {
  const labels: Record<string, string> = {
    RETAIL_HARDWARE: "Retail / Hardware",
    RETAIL: "Retail / Provisions",
    FOOD: "Food / Hospitality",
    SALON: "Salon / Barber",
    DRINKS: "Drinks / Spot",
    SERVICES: "Services",
    DISTRIBUTION: "Distribution",
  };
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { session, context, branchId, activeBranch, setBusiness, setBranch, logout } = useWorkspace();
  const navItems = useMemo(() => visibleWorkspaceNav(context.membership.role), [context.membership.role]);
  const activeBranches = useMemo(() => context.branches.filter((branch) => branch.active), [context.branches]);
  const userInitials = session.user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
  const packLabel = businessTypeLabel(context.business.businessType);

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: MouseEvent) => { if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setProfileOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [profileOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const aliases: Array<[string[], string]> = [
      [["product", "item", "catalog"], "/catalog"],
      [["stock", "inventory"], "/inventory"],
      [["customer", "credit"], "/customers"],
      [["purchase", "supplier", "receive"], "/purchases"],
      [["cash", "expense", "money"], "/cashbook"],
      [["report", "insight", "ai"], "/reports"],
      [["return", "refund"], "/returns"],
      [["sale", "receipt"], "/sales"],
      [["sell", "pos", "checkout"], "/sell"],
    ];
    const alias = aliases.find(([terms, href]) => terms.some((term) => query.includes(term)) && navItems.some((item) => item.href === href));
    const navMatch = navItems.find((item) => item.label.toLowerCase().includes(query) || item.href.slice(1).includes(query));
    const href = alias?.[1] ?? navMatch?.href;
    if (href) {
      router.push(href);
      setSearchQuery("");
    }
  };

  const globalSearch = (
    <form className="workspace-global-search" role="search" onSubmit={submitSearch}>
      <span className="workspace-search-icon" aria-hidden="true">⌕</span>
      <input ref={searchRef} type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search products, sales, customers…" aria-label="Search TradeOS" />
      <kbd aria-hidden="true">/</kbd>
    </form>
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

        <div className="workspace-business-card">
          <div className="workspace-business-card-main">
            <span className="workspace-business-icon" aria-hidden="true">▤</span>
            <div>
              {session.memberships.length > 1 ? (
                <select className="workspace-sidebar-business-select" aria-label="Switch business" value={context.business.id} onChange={(event) => void setBusiness(event.target.value)}>{session.memberships.map((membership) => <option key={membership.businessId} value={membership.businessId}>{membership.businessName}</option>)}</select>
              ) : <strong>{context.business.name}</strong>}
              {activeBranches.length > 1 ? (
                <select className="workspace-sidebar-branch-select" aria-label="Switch branch" value={branchId} onChange={(event) => setBranch(event.target.value)}>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
              ) : <small>{activeBranch.name}</small>}
            </div>
          </div>
          <div className="workspace-business-pack">
            <span className="workspace-pack-icon" aria-hidden="true">⌂</span>
            <div><strong>{packLabel}</strong><small>Business pack</small></div>
            {session.memberships.length > 1 ? <span>Switch</span> : null}
          </div>
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
                    <Link className={active ? "workspace-nav-item active" : "workspace-nav-item"} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
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
        <header className="workspace-mobile-header">
          <button className="workspace-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMoreOpen(true)}>☰</button>
          <span className="workspace-mobile-brandmark" aria-hidden="true">T</span>
          <strong>{context.business.name}</strong>
          <div className="workspace-mobile-network"><NetworkStatus /></div>
        </header>

        <header className="workspace-topbar">
          {globalSearch}
          <div className="workspace-utility-actions">
            <Link className="workspace-utility-icon" href="/reports" aria-label="Open TradeOS intelligence">✣</Link>
            <button className="workspace-utility-icon" type="button" aria-label="Open help and modules" onClick={() => setMoreOpen(true)}>?</button>
            <div className="workspace-profile-menu" ref={profileMenuRef}>
              <button className="workspace-profile-trigger" type="button" aria-label="Open user menu" title="Account & sign out" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>
                <span className="workspace-profile-avatar" aria-hidden="true">{userInitials}</span>
                <span className="workspace-profile-copy"><strong>{session.user.displayName}</strong><small>{context.membership.role}</small></span>
                <span className="workspace-profile-chevron" aria-hidden="true">⌄</span>
              </button>
              {profileOpen ? (
                <div className="workspace-profile-dropdown" role="menu">
                  <div className="workspace-profile-summary"><span>Signed in as</span><strong>{session.user.displayName}</strong><small>{context.business.name} · {activeBranch.name}</small></div>
                  <button className="workspace-profile-signout" type="button" role="menuitem" onClick={() => void logout()}>Sign out</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="workspace-mobile-search">{globalSearch}</div>
        <div key={`${context.business.id}:${branchId}`} className="workspace-content">{children}</div>
      </section>

      <MobileBottomNav role={context.membership.role} pathname={pathname} onOpenMore={() => setMoreOpen(true)} />
      <MobileMoreSheet open={moreOpen} role={context.membership.role} pathname={pathname} onClose={() => setMoreOpen(false)} businessContext={moreContext} onLogout={logout} />
    </main>
  );
}
