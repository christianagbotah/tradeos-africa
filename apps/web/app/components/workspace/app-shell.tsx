"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useWorkspace } from "./use-workspace";
import { findNavItem, groupedNavItems, primaryNavItems, secondaryNavItems, type WorkspaceNavItem } from "./workspace-navigation";
import { IconClose, IconLogout, IconMenu, IconMore, IconSearch } from "../ui/icons";
import { Button } from "../ui/button";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { session, role, signOut, queue } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the drawer on route change.
  useEffect(() => {
    setDrawerOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Lock body scroll when the drawer is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const activeSegment = deriveActiveSegment(pathname);
  const activeItem = findNavItem(activeSegment);
  const groups = groupedNavItems(role);
  const primary = primaryNavItems(role);
  const secondary = secondaryNavItems(role);

  const handleSignOut = () => {
    signOut();
    router.replace("/");
  };

  if (!session) return null;

  const initials = (session.displayName || "T")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "T";

  return (
    <div className="tos-shell">
      <aside className="tos-sidebar" data-open={drawerOpen} aria-label="Workspace navigation">
        <div className="tos-sidebar__brand">
          <div className="tos-sidebar__mark" aria-hidden="true">T</div>
          <div className="tos-sidebar__brand-text">
            <span className="tos-sidebar__brand-name">TradeOS</span>
            <span className="tos-sidebar__brand-sub">Merchant web</span>
          </div>
        </div>
        <div className="tos-sidebar__ctx">
          <span className="tos-sidebar__ctx-label">Business</span>
          <span className="tos-sidebar__ctx-name" title={session.businessName}>{session.businessName}</span>
          <span className="tos-sidebar__ctx-sub">{session.currencyCode} · {session.timezone}</span>
        </div>
        <nav className="tos-sidebar__nav">
          {groups.map((group) => (
            <div key={group.group} className="tos-sidebar__group">
              <span className="tos-sidebar__group-label">{group.group}</span>
              {group.items.map((item) => (
                <SidebarLink key={item.id} item={item} active={item.segment === activeSegment} />
              ))}
            </div>
          ))}
        </nav>
        <div className="tos-sidebar__foot">
          {queue.pending > 0 || !queue.online ? (
            <div className="tos-sidebar__queue">
              <span className="tos-sidebar__queue-title">
                {queue.online ? `${queue.pending} pending` : "Offline"}
              </span>
              <span className="tos-sidebar__queue-text">
                {queue.online
                  ? "Queued mutations will sync automatically."
                  : "Sales will queue locally and sync when you reconnect."}
              </span>
            </div>
          ) : null}
          <button type="button" className="tos-sidebar__signout" onClick={handleSignOut}>
            <IconLogout className="tos-sidebar__link-icon" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="tos-sidebar-scrim" data-open={drawerOpen} onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <div className="tos-main">
        <header className="tos-topbar">
          <button
            type="button"
            className="tos-topbar__menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
          >
            <IconMenu style={{ width: 20, height: 20 }} />
          </button>
          <div className="tos-topbar__title-block">
            <span className="tos-topbar__crumb">{activeItem?.group ?? "TradeOS"}</span>
            <span className="tos-topbar__title">{activeItem?.label ?? "Workspace"}</span>
          </div>
          <div className="tos-topbar__search">
            <IconSearch className="tos-topbar__search-icon" />
            <input
              type="search"
              className="tos-topbar__search-input"
              placeholder="Search products, customers, receipts…"
              aria-label="Global search"
              onChange={(e) => {
                const value = e.target.value.trim();
                if (value) {
                  // Simple search: route to catalog with query.
                  router.push(`/catalog?q=${encodeURIComponent(value)}`);
                }
              }}
            />
          </div>
          <div className="tos-topbar__spacer" />
          {queue.online ? (
            queue.pending > 0 ? (
              <span className="tos-topbar__pill tos-topbar__pill--warning" title={queue.lastError ?? undefined}>
                <span className="tos-topbar__pill-dot" />
                {queue.pending} syncing
              </span>
            ) : null
          ) : (
            <span className="tos-offline-pill" title="You are offline. Sales will queue.">
              <span className="tos-offline-pill__dot" />
              Offline
            </span>
          )}
          <div className="tos-topbar__profile" title={session.displayName}>
            <div className="tos-topbar__avatar" aria-hidden="true">{initials}</div>
            <div className="tos-topbar__profile-text">
              <span className="tos-topbar__profile-name">{session.displayName}</span>
              <span className="tos-topbar__profile-role">{role}</span>
            </div>
          </div>
        </header>

        <main className="tos-content">{children}</main>

        <nav className="tos-bottomnav" aria-label="Primary">
          <div className="tos-bottomnav__inner">
            {primary.map((item) => (
              <BottomNavLink key={item.id} item={item} active={item.segment === activeSegment} />
            ))}
          </div>
        </nav>

        {secondary.length > 0 ? (
          <div className="tos-bottomnav__more">
            <Button
              variant="primary"
              size="icon"
              aria-label="More navigation"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              icon={<IconMore style={{ width: 20, height: 20 }} />}
            />
          </div>
        ) : null}

        {moreOpen ? (
          <>
            <div className="tos-sheet-scrim" onClick={() => setMoreOpen(false)} aria-hidden="true" />
            <div className="tos-sheet" role="dialog" aria-label="More navigation">
              <div className="tos-sheet__head">
                <div className="tos-sheet__head-main">
                  <span className="tos-sheet__eyebrow">Navigation</span>
                  <h2 className="tos-sheet__title">More</h2>
                </div>
                <button type="button" className="tos-sheet__close" onClick={() => setMoreOpen(false)} aria-label="Close more navigation">
                  <IconClose style={{ width: 18, height: 18 }} />
                </button>
              </div>
              <div className="tos-sheet__body">
                <div className="tos-more-sheet">
                  {secondary.map((item) => (
                    <MoreTile key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function deriveActiveSegment(pathname: string): string {
  const match = pathname.match(/^\/([^/]+)/);
  return match?.[1] ?? "dashboard";
}

function SidebarLink({ item, active }: { item: WorkspaceNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={`/${item.segment}`}
      className="tos-sidebar__link"
      data-active={active}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="tos-sidebar__link-icon" />
      <span>{item.label}</span>
    </Link>
  );
}

function BottomNavLink({ item, active }: { item: WorkspaceNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={`/${item.segment}`}
      className="tos-bottomnav__link"
      data-active={active}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="tos-bottomnav__link-icon" />
      <span>{item.shortLabel}</span>
    </Link>
  );
}

function MoreTile({ item }: { item: WorkspaceNavItem }) {
  const Icon = item.icon;
  return (
    <Link href={`/${item.segment}`} className="tos-more-tile">
      <Icon className="tos-more-tile__icon" />
      <span className="tos-more-tile__label">{item.label}</span>
    </Link>
  );
}
