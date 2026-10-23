"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { BusinessEntityContext, BusinessEntityType } from "@tradeos/contracts";
import { AskTradeOSDrawer } from "../intelligence/ask-tradeos-drawer";
import { useWorkspace } from "./use-workspace";
import {
  findNavItem,
  groupedNavItems,
  primaryNavItems,
  secondaryNavItems,
  type WorkspaceNavItem,
} from "./workspace-navigation";
import {
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconLogout,
  IconMenu,
  IconMore,
  IconPlus,
  IconSearch,
  IconShield,
  IconUser,
} from "../ui/icons";
import { Button } from "../ui/button";

interface AppShellProps {
  children: ReactNode;
}

type ShellFeedback = { tone: "error" | "info"; text: string } | null;

export function AppShell({ children }: AppShellProps) {
  const {
    session,
    role,
    account,
    memberships,
    businessContext,
    contextBusy,
    signOut,
    queue,
    switchBusiness,
    switchBranch,
  } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [askTradeOSOpen, setAskTradeOSOpen] = useState(false);
  const [askTradeOSInitialQuestion, setAskTradeOSInitialQuestion] = useState<string | null>(null);
  const [askTradeOSInitialContext, setAskTradeOSInitialContext] = useState<BusinessEntityContext | null>(null);
  const [shellFeedback, setShellFeedback] = useState<ShellFeedback>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setMoreOpen(false);
    setContextOpen(false);
    setAccountOpen(false);
    setAskTradeOSOpen(false);
    setAskTradeOSInitialQuestion(null);
    setAskTradeOSInitialContext(null);
    setShellFeedback(null);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = drawerOpen || askTradeOSOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen, askTradeOSOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const openContextualAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ question?: unknown; context?: unknown }>).detail;
      if (!detail || typeof detail.question !== "string" || !detail.question.trim()) return;
      let context: BusinessEntityContext | null = null;
      if (detail.context !== undefined && detail.context !== null) {
        if (!isBusinessEntityContext(detail.context)) return;
        context = detail.context;
      }
      setAskTradeOSInitialQuestion(detail.question.trim());
      setAskTradeOSInitialContext(context);
      setAskTradeOSOpen(true);
      setContextOpen(false);
      setAccountOpen(false);
      setMoreOpen(false);
    };
    window.addEventListener("tradeos:ask", openContextualAsk);
    return () => window.removeEventListener("tradeos:ask", openContextualAsk);
  }, []);

  const activeSegment = deriveActiveSegment(pathname);
  const activeItem = findNavItem(activeSegment);
  const groups = groupedNavItems(role);
  const primary = primaryNavItems(role);
  const secondary = secondaryNavItems(role);

  const availableMemberships = useMemo(
    () => memberships.filter((membership) => membership.businessStatus === "ACTIVE" && Boolean(membership.staffId)),
    [memberships],
  );
  const activeBranches = useMemo(
    () => (businessContext?.branches ?? []).filter((branch) => branch.active),
    [businessContext?.branches],
  );
  const currentBranch = activeBranches.find((branch) => branch.id === session?.branchId) ?? null;
  const canManageBusiness = role === "OWNER" || role === "ADMIN";

  const handleSignOut = () => {
    signOut();
    router.replace("/");
  };

  const chooseBusiness = async (businessId: string) => {
    if (!session || businessId === session.businessId || contextBusy) return;
    setShellFeedback(null);
    try {
      await switchBusiness(businessId);
      setContextOpen(false);
    } catch (error) {
      setShellFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Business could not be opened.",
      });
    }
  };

  const chooseBranch = async (branchId: string) => {
    if (!session || branchId === session.branchId || contextBusy) return;
    setShellFeedback(null);
    try {
      await switchBranch(branchId);
      setContextOpen(false);
    } catch (error) {
      setShellFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Branch could not be opened.",
      });
    }
  };

  if (!session) return null;

  const displayName = account?.displayName ?? session.displayName;
  const avatarUrl = account?.avatarUrl ?? null;
  const initials = (displayName || "T")
    .split(/\s+/)
    .map((part) => part[0])
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
          <span className="tos-sidebar__ctx-sub">{currentBranch?.name ?? "Branch"} · {session.currencyCode}</span>
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
              <span className="tos-sidebar__queue-title">{queue.online ? `${queue.pending} pending` : "Offline"}</span>
              <span className="tos-sidebar__queue-text">
                {queue.online ? "Queued offline changes will sync automatically." : "Sales will queue locally and sync when you reconnect."}
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

      <div className="tos-main" data-view={activeSegment}>
        <header className="tos-topbar">
          <button type="button" className="tos-topbar__menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Open navigation menu">
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
              onChange={(event) => {
                const value = event.target.value.trim();
                if (value) router.push(`/catalog?q=${encodeURIComponent(value)}`);
              }}
            />
          </div>
          <div className="tos-topbar__spacer" />

          <Button
            variant="gold"
            size="sm"
            className="tos-ai-topbar-button"
            onClick={() => {
              setAskTradeOSInitialQuestion(null);
              setAskTradeOSInitialContext(null);
              setAskTradeOSOpen(true);
              setContextOpen(false);
              setAccountOpen(false);
              setMoreOpen(false);
            }}
          >
            Ask TradeOS
          </Button>

          <div className="tos-shell-context">
            <button
              type="button"
              className="tos-shell-context__trigger"
              aria-label="Business & branch switcher"
              aria-expanded={contextOpen}
              onClick={() => {
                setContextOpen((value) => !value);
                setAccountOpen(false);
                setShellFeedback(null);
              }}
            >
              <IconBuilding className="tos-shell-context__icon" />
              <span className="tos-shell-context__copy">
                <strong>{session.businessName}</strong>
                <small>{currentBranch?.name ?? "Current branch"}</small>
              </span>
              <IconChevronDown className="tos-shell-context__chevron" />
            </button>

            {contextOpen ? (
              <div className="tos-shell-popover tos-shell-popover--context" role="dialog" aria-label="Business & branch switcher">
                <div className="tos-shell-popover__head">
                  <span className="tos-shell-popover__eyebrow">Workspace</span>
                  <strong>Business & branch switcher</strong>
                </div>
                {shellFeedback ? (
                  <div className={shellFeedback.tone === "error" ? "tos-shell-feedback tos-shell-feedback--error" : "tos-shell-feedback tos-shell-feedback--info"}>
                    {shellFeedback.text}
                  </div>
                ) : null}

                <div className="tos-shell-popover__section">
                  <span className="tos-shell-popover__section-title">Businesses</span>
                  <div className="tos-shell-popover__list">
                    {availableMemberships.map((membership) => {
                      const current = membership.businessId === session.businessId;
                      return (
                        <button
                          key={membership.businessId}
                          type="button"
                          className="tos-shell-choice"
                          data-current={current}
                          disabled={contextBusy || current}
                          onClick={() => void chooseBusiness(membership.businessId)}
                        >
                          <span className="tos-shell-choice__main">
                            <strong>{membership.businessName}</strong>
                            <small>{membership.role}</small>
                          </span>
                          {current ? <IconCheck className="tos-shell-choice__check" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="tos-shell-popover__section">
                  <span className="tos-shell-popover__section-title">Branches</span>
                  <div className="tos-shell-popover__list">
                    {activeBranches.map((branch) => {
                      const current = branch.id === session.branchId;
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          className="tos-shell-choice"
                          data-current={current}
                          disabled={contextBusy || current}
                          onClick={() => void chooseBranch(branch.id)}
                        >
                          <span className="tos-shell-choice__main">
                            <strong>{branch.name}</strong>
                            <small>{branch.code} · {branch.timezone}</small>
                          </span>
                          {current ? <IconCheck className="tos-shell-choice__check" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="tos-shell-popover__actions">
                  <Link href="/settings?section=business&action=create" className="tos-shell-action-link" onClick={() => setContextOpen(false)}><IconPlus />Add business</Link>
                  {canManageBusiness ? <Link href="/settings?section=branches&action=create" className="tos-shell-action-link" onClick={() => setContextOpen(false)}><IconPlus />Add branch</Link> : null}
                </div>
              </div>
            ) : null}
          </div>

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

          <div className="tos-account-menu">
            <button
              type="button"
              className="tos-topbar__profile tos-topbar__profile--button"
              aria-label="Account menu"
              aria-expanded={accountOpen}
              onClick={() => {
                setAccountOpen((value) => !value);
                setContextOpen(false);
              }}
            >
              <div className="tos-topbar__avatar">{avatarUrl ? <img src={avatarUrl} alt="" className="tos-topbar__avatar-image" /> : <span aria-hidden="true">{initials}</span>}</div>
              <div className="tos-topbar__profile-text">
                <span className="tos-topbar__profile-name">{displayName}</span>
                <span className="tos-topbar__profile-role">{role}</span>
              </div>
              <IconChevronDown className="tos-account-menu__chevron" />
            </button>

            {accountOpen ? (
              <div className="tos-shell-popover tos-shell-popover--account" role="menu" aria-label="Account menu">
                <div className="tos-account-card">
                  <div className="tos-account-card__avatar">{avatarUrl ? <img src={avatarUrl} alt="" className="tos-account-card__avatar-image" /> : <span aria-hidden="true">{initials}</span>}</div>
                  <div className="tos-account-card__copy">
                    <strong>{displayName}</strong>
                    <span>{account?.email ?? account?.phoneE164 ?? "TradeOS account"}</span>
                  </div>
                </div>
                <Link href="/settings?section=profile" className="tos-account-link" role="menuitem" onClick={() => setAccountOpen(false)}><IconUser />My profile</Link>
                <Link href="/settings?section=security" className="tos-account-link" role="menuitem" onClick={() => setAccountOpen(false)}><IconShield />Security</Link>
                <Link href="/settings?section=business" className="tos-account-link" role="menuitem" onClick={() => setAccountOpen(false)}><IconBuilding />Settings</Link>
                <button type="button" className="tos-account-link tos-account-link--danger" role="menuitem" onClick={handleSignOut}>
                  <IconLogout />Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="tos-content">{children}</main>

        <nav className="tos-bottomnav" aria-label="Primary">
          <div className="tos-bottomnav__inner">
            {primary.map((item) => <BottomNavLink key={item.id} item={item} active={item.segment === activeSegment} />)}
          </div>
        </nav>

        {secondary.length > 0 ? (
          <div className="tos-bottomnav__more">
            <Button
              variant="primary"
              size="icon"
              aria-label="More navigation"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
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
                <div className="tos-more-sheet">{secondary.map((item) => <MoreTile key={item.id} item={item} />)}</div>
              </div>
            </div>
          </>
        ) : null}

        <AskTradeOSDrawer open={askTradeOSOpen} initialQuestion={askTradeOSInitialQuestion} initialContext={askTradeOSInitialContext} onClose={() => setAskTradeOSOpen(false)} />
      </div>
    </div>
  );
}

const BUSINESS_ENTITY_TYPES = new Set<BusinessEntityType>(["CATALOG_ITEM", "CUSTOMER", "SUPPLIER", "PURCHASE"]);
const ENTITY_CONTEXT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isBusinessEntityContext(value: unknown): value is BusinessEntityContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 2
    && keys.every((key) => key === "entityType" || key === "entityId")
    && typeof record.entityType === "string"
    && BUSINESS_ENTITY_TYPES.has(record.entityType as BusinessEntityType)
    && typeof record.entityId === "string"
    && ENTITY_CONTEXT_UUID.test(record.entityId);
}

function deriveActiveSegment(pathname: string): string {
  const match = pathname.match(/^\/([^/]+)/);
  return match?.[1] ?? "dashboard";
}

function SidebarLink({ item, active }: { item: WorkspaceNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={`/${item.segment}`} className="tos-sidebar__link" data-active={active} aria-current={active ? "page" : undefined}>
      <Icon className="tos-sidebar__link-icon" />
      <span>{item.label}</span>
    </Link>
  );
}

function BottomNavLink({ item, active }: { item: WorkspaceNavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={`/${item.segment}`} className="tos-bottomnav__link" data-active={active} aria-current={active ? "page" : undefined}>
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
