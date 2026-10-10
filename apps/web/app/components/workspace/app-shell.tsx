"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NetworkStatus } from "../network-status";
import { useWorkspace } from "./use-workspace";
import { isWorkspaceNavActive, visibleWorkspaceNav, type WorkspaceNavItem } from "./workspace-navigation";
import { WorkspaceNavIcon } from "./workspace-nav-icon";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MobileMoreSheet } from "./mobile-more-sheet";
import { ReferenceIcon } from "../ui/reference-icon";

const sidebarGroups = ["Operate", "Inventory", "Money & people", "Control & insights"] as const;

function sidebarGroup(item: WorkspaceNavItem): (typeof sidebarGroups)[number] {
  if (["/dashboard", "/sell", "/sales", "/returns"].includes(item.href)) return "Operate";
  if (["/catalog", "/inventory", "/purchases"].includes(item.href)) return "Inventory";
  if (["/customers", "/cashbook"].includes(item.href)) return "Money & people";
  return "Control & insights";
}

function sidebarLabel(item: WorkspaceNavItem) {
  const labels: Record<string, string> = {
    "/returns": "Returns",
    "/catalog": "Catalog",
    "/customers": "Customers",
    "/cashbook": "Cashbook",
    "/operations": "Day & shifts",
    "/reports": "Reports",
  };
  return labels[item.href] ?? item.label;
}

function businessPackLabel(type: string) {
  const labels: Record<string, string> = {
    RETAIL_HARDWARE: "Retail / Provisions",
    FOOD: "Food / Hospitality",
    SALON_BARBER: "Salon / Barber",
    DRINKING_SPOT: "Drinks / Hospitality",
    WASHING_BAY: "Washing bay",
    CAR_PARK: "Car park",
    DISTRIBUTION: "Wholesale / Distribution",
    SERVICES: "Services",
  };
  return labels[type] ?? "Business workspace";
}

function searchDestination(query: string) {
  const normalized = query.trim().toLowerCase();
  if (/customer|credit|debtor|receivable/.test(normalized)) return "/customers";
  if (/receipt|sale|invoice|refund|return/.test(normalized)) return "/sales";
  if (/purchase|supplier|receive/.test(normalized)) return "/purchases";
  if (/expense|cash|momo|bank|money/.test(normalized)) return "/cashbook";
  if (/stock|inventory|on hand/.test(normalized)) return "/inventory";
  return "/catalog";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const { session, context, branchId, activeBranch, setBusiness, setBranch, logout } = useWorkspace();
  const navItems = useMemo(() => visibleWorkspaceNav(context.membership.role), [context.membership.role]);
  const activeBranches = useMemo(() => context.branches.filter((branch) => branch.active), [context.branches]);
  const userInitials = session.user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
  const packLabel = businessPackLabel(context.business.businessType);

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
      ) : <span className="workspace-branch-name">{activeBranch.name}</span>}
    </div>
  );

  const moreContext = (
    <>{businessBranchSelectors}<div className="workspace-more-user"><strong>{session.user.displayName}</strong><span>{context.membership.role}</span></div><NetworkStatus /></>
  );

  const onGlobalSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = globalQuery.trim();
    if (!query) return;
    router.push(`${searchDestination(query)}?q=${encodeURIComponent(query)}`);
  };

  const profile = (
    <div className="workspace-profile-menu" ref={profileMenuRef}>
      <button className="workspace-profile-trigger" type="button" aria-label="Open user menu" title="Account & sign out" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>
        <span className="workspace-profile-avatar" aria-hidden="true">{userInitials}</span>
        <span className="workspace-profile-copy"><strong>{session.user.displayName}</strong><small>{context.membership.role}</small></span>
        <span className="workspace-profile-chevron" aria-hidden="true"><ReferenceIcon name="chevronDown" /></span>
      </button>
      {profileOpen ? (
        <div className="workspace-profile-dropdown" role="menu">
          <div className="workspace-profile-summary"><span>Signed in as</span><strong>{session.user.displayName}</strong><small>{context.business.name} · {activeBranch.name}</small></div>
          <button className="workspace-profile-signout" type="button" role="menuitem" onClick={() => void logout()}>Sign out</button>
        </div>
      ) : null}
    </div>
  );

  return (
    <main className={collapsed ? "workspace-shell sidebar-collapsed" : "workspace-shell"}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <div className="brand-mark">T<span className="brand-online-dot" /></div>
          <div className="workspace-brand-copy"><strong>TradeOS</strong><span>Africa</span></div>
        </div>

        <section className="workspace-business-card" aria-label="Active business and branch">
          <div className="workspace-business-card-main">
            <span className="workspace-business-icon" aria-hidden="true"><ReferenceIcon name="store" /></span>
            <div><strong>{context.business.name}</strong><span>{activeBranch.name}</span></div>
            <span aria-hidden="true"><ReferenceIcon name="chevronDown" /></span>
          </div>
          <div className="workspace-pack-card">
            <span aria-hidden="true"><ReferenceIcon name="home" /></span>
            <div><strong>{packLabel}</strong><small>Business pack</small></div>
            <span>Switch</span>
          </div>
        </section>

        <nav className="workspace-nav" aria-label="Primary navigation">
          {sidebarGroups.map((group) => {
            const items = navItems.filter((item) => sidebarGroup(item) === group);
            if (items.length === 0) return null;
            return (
              <div className="workspace-nav-group" key={group}>
                <span className="workspace-nav-label">{group}</span>
                {items.map((item) => {
                  const active = isWorkspaceNavActive(pathname, item.href);
                  return (
                    <Link className={active ? "workspace-nav-item active" : "workspace-nav-item"} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
                      <span className="workspace-nav-icon-box"><WorkspaceNavIcon name={item.icon} /></span>
                      <span>{sidebarLabel(item)}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="workspace-sidebar-footer">
          <NetworkStatus />
          <button className="workspace-sidebar-collapse" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <span aria-hidden="true">{collapsed ? "›" : "‹"}</span><span>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-mobile-header">
          <button type="button" className="workspace-mobile-menu" aria-label="Open menu" onClick={() => setMoreOpen(true)}><ReferenceIcon name="menu" /></button>
          <span className="workspace-mobile-mark" aria-hidden="true">T</span>
          <strong>{context.business.name}</strong>
          <span className="workspace-mobile-online" aria-label="Online status"><ReferenceIcon name="wifi" /></span>
        </header>

        <header className="workspace-topbar">
          <form className="workspace-global-search" role="search" onSubmit={onGlobalSearch}>
            <span aria-hidden="true"><ReferenceIcon name="search" /></span>
            <input value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="Search products, sales, customers…" aria-label="Search products, sales, customers" />
            <kbd>/</kbd>
          </form>
          <div className="workspace-topbar-utilities">
            <Link className="workspace-utility-icon" href="/reports" aria-label="Open AI insights" title="AI insights"><ReferenceIcon name="sparkles" /></Link>
            <span className="workspace-utility-icon" aria-hidden="true"><ReferenceIcon name="help" /></span>
            <span className="workspace-utility-icon workspace-notification" aria-label="Notifications"><ReferenceIcon name="bell" /></span>
            {profile}
          </div>
        </header>

        <div className="workspace-mobile-search-row">
          <form className="workspace-global-search" role="search" onSubmit={onGlobalSearch}>
            <span aria-hidden="true"><ReferenceIcon name="search" /></span>
            <input value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="Search products, sales, customers…" aria-label="Search products, sales, customers" />
          </form>
          <span className="workspace-mobile-online" aria-label="Online status"><ReferenceIcon name="wifi" /></span>
        </div>

        <div key={`${context.business.id}:${branchId}`} className="workspace-content">{children}</div>
      </section>

      <MobileBottomNav role={context.membership.role} pathname={pathname} onOpenMore={() => setMoreOpen(true)} />
      <MobileMoreSheet open={moreOpen} role={context.membership.role} pathname={pathname} onClose={() => setMoreOpen(false)} businessContext={moreContext} onLogout={logout} />
    </main>
  );
}
