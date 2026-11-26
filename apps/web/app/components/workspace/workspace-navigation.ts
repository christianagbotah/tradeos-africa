/**
 * TradeOS Web — workspace navigation model.
 *
 * Single source of truth for the sidebar / bottom-nav items, their routes,
 * icons, and role-based visibility. The same list drives the desktop sidebar
 * (grouped), the mobile bottom nav (first 4 + "more"), and the mobile "more"
 * sheet.
 */

import type { ComponentType, SVGProps } from "react";
import {
  IconBuilding,
  IconShield,
  IconUsers,
  IconCashbook,
  IconCatalog,
  IconCustomers,
  IconDashboard,
  IconInventory,
  IconOperations,
  IconPurchases,
  IconReports,
  IconReturns,
  IconSales,
  IconReceipt,
  IconSell,
  IconUser,
} from "../ui/icons";

export type WorkspaceRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "CASHIER"
  | "POS_ATTENDANT"
  | "SALES"
  | "INVENTORY"
  | "ACCOUNTANT"
  | "STAFF"
  | "VIEWER";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface WorkspaceNavItem {
  /** Stable id used as React key and for active-route matching. */
  id: string;
  /** Route segment under /(workspace)/ — e.g. "dashboard", "sell". */
  segment: string;
  /** Display label. */
  label: string;
  /** Short label for mobile bottom nav. */
  shortLabel: string;
  /** Sidebar group label (e.g. "Trade", "Master data"). */
  group: "Trade" | "Inventory" | "Master data" | "Money" | "Insights" | "System";
  /** Icon component. */
  icon: IconComponent;
  /** Roles that may see this item. Empty = visible to all roles. */
  visibleTo?: readonly WorkspaceRole[];
  /** Whether this item is "primary" (shown in the mobile bottom nav). */
  primary?: boolean;
}

const ALL_ROLES: readonly WorkspaceRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "SALES",
  "INVENTORY",
  "ACCOUNTANT",
  "STAFF",
  "VIEWER",
];

const WRITE_ROLES: readonly WorkspaceRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "POS_ATTENDANT",
  "SALES",
  "INVENTORY",
  "ACCOUNTANT",
  "STAFF",
];

const MANAGER_ROLES: readonly WorkspaceRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "ACCOUNTANT",
];

const PURCHASE_ORDER_ROLES: readonly WorkspaceRole[] = [
  "OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "INVENTORY",
];

export const WORKSPACE_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  { id: "dashboard", segment: "dashboard", label: "Dashboard", shortLabel: "Home", group: "Trade", icon: IconDashboard, primary: true },
  { id: "sell", segment: "sell", label: "Sell (POS)", shortLabel: "Sell", group: "Trade", icon: IconSell, visibleTo: WRITE_ROLES, primary: true },
  { id: "sales", segment: "sales", label: "Sales", shortLabel: "Sales", group: "Trade", icon: IconSales, primary: true },
  { id: "documents", segment: "documents", label: "Quotes & proformas", shortLabel: "Quotes", group: "Trade", icon: IconReceipt },
  { id: "pricing", segment: "pricing", label: "Prices & approvals",
    shortLabel: "Pricing", group: "Trade", icon: IconCatalog, visibleTo: WRITE_ROLES },
  { id: "customers", segment: "customers", label: "Customers", shortLabel: "Customers", group: "Master data", icon: IconCustomers, primary: true },
  { id: "catalog", segment: "catalog", label: "Catalog", shortLabel: "Catalog", group: "Master data", icon: IconCatalog },
  { id: "inventory", segment: "inventory", label: "Inventory", shortLabel: "Stock", group: "Inventory", icon: IconInventory, visibleTo: WRITE_ROLES },
  { id: "returns", segment: "returns", label: "Returns & refunds", shortLabel: "Returns", group: "Trade", icon: IconReturns, visibleTo: MANAGER_ROLES },
  { id: "purchases", segment: "purchases", label: "Purchases & suppliers", shortLabel: "Purchases", group: "Inventory", icon: IconPurchases, visibleTo: MANAGER_ROLES },
  { id: "purchase-orders", segment: "purchase-orders", label: "Purchase orders", shortLabel: "Orders", group: "Inventory", icon: IconReceipt, visibleTo: PURCHASE_ORDER_ROLES },
  { id: "cashbook", segment: "cashbook", label: "Cashbook", shortLabel: "Cashbook", group: "Money", icon: IconCashbook, visibleTo: MANAGER_ROLES },
  { id: "operations", segment: "operations", label: "Operations", shortLabel: "Ops", group: "Money", icon: IconOperations, visibleTo: MANAGER_ROLES },
  { id: "reports", segment: "reports", label: "Reports", shortLabel: "Reports", group: "Insights", icon: IconReports, visibleTo: MANAGER_ROLES },
  { id: "settings", segment: "settings", label: "Settings", shortLabel: "Settings", group: "System", icon: IconUser },
];

/** Returns the nav items visible to the given role. */
export function visibleNavItems(role: WorkspaceRole | null | undefined): readonly WorkspaceNavItem[] {
  if (!role) return [];
  // SELL is shared with wider WRITE_ROLES; never let this list implicitly
  // grant attendant access to pricing/inventory or future write modules.
  if (role === "POS_ATTENDANT") return WORKSPACE_NAV_ITEMS.filter(item=>item.segment==="sell");
  return WORKSPACE_NAV_ITEMS.filter((item) => (item.visibleTo ?? ALL_ROLES).includes(role));
}

/** Returns the primary nav items (mobile bottom nav). Falls back to first 4. */
export function primaryNavItems(role: WorkspaceRole | null | undefined): readonly WorkspaceNavItem[] {
  const visible = visibleNavItems(role);
  const primary = visible.filter((item) => item.primary);
  return primary.length >= 4 ? primary : visible.slice(0, 4);
}

/** Returns the secondary (overflow) nav items shown in the mobile "more" sheet. */
export function secondaryNavItems(role: WorkspaceRole | null | undefined): readonly WorkspaceNavItem[] {
  const visible = visibleNavItems(role);
  const primaryIds = new Set(primaryNavItems(role).map((item) => item.id));
  return visible.filter((item) => !primaryIds.has(item.id));
}

/** Finds a nav item by route segment. */
export function findNavItem(segment: string): WorkspaceNavItem | undefined {
  return WORKSPACE_NAV_ITEMS.find((item) => item.segment === segment);
}

/** Groups visible items by their `group` field for sidebar rendering. */
export function groupedNavItems(
  role: WorkspaceRole | null | undefined,
): readonly { readonly group: WorkspaceNavItem["group"]; readonly items: readonly WorkspaceNavItem[] }[] {
  const visible = visibleNavItems(role);
  const order: readonly WorkspaceNavItem["group"][] = ["Trade", "Inventory", "Master data", "Money", "Insights", "System"];
  return order.map((group) => ({
    group,
    items: visible.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}

/** Navigable groups in the mobile More sheet. All destinations exist already;
 * account sections use the settings page's canonical `section` query. */
export interface MobileMoreLink {
  id: string;
  label: string;
  href: string;
  icon: IconComponent;
}

export interface MobileMoreGroup {
  id: string;
  title: string;
  items: readonly MobileMoreLink[];
}

export function mobileMoreNavigationGroups(role: WorkspaceRole | null | undefined): readonly MobileMoreGroup[] {
  if (!role) return [];
  // A dedicated POS login must never promote other workspace routes.
  if (role === "POS_ATTENDANT") return [];
  const secondary = secondaryNavItems(role);
  const linksFor = (segments: readonly string[]) => secondary
    .filter((item) => segments.includes(item.segment))
    .map((item) => ({ id: item.id, label: item.label, href: `/${item.segment}`, icon: item.icon }));

  const canManage = role === "OWNER" || role === "ADMIN";
  const canReadTeam = canManage || role === "MANAGER";
  const accountLinks: MobileMoreLink[] = [
    { id: "business", label: "Business", href: "/settings?section=business", icon: IconBuilding },
    { id: "branches", label: "Branches", href: "/settings?section=branches", icon: IconBuilding },
    ...(canReadTeam ? [{ id: "team", label: "Team & access", href: "/settings?section=team", icon: IconUsers }] : []),
    ...(canManage ? [{ id: "billing", label: "Subscription & billing", href: "/settings?section=billing", icon: IconCashbook }] : []),
    { id: "devices", label: "Devices & sessions", href: "/settings?section=devices", icon: IconShield },
    { id: "profile", label: "My profile", href: "/settings?section=profile", icon: IconUser },
    { id: "security", label: "Security", href: "/settings?section=security", icon: IconShield },
    ...linksFor(["settings"]),
  ];

  return [
    { id: "stock", title: "Sales & stock", items: linksFor(["documents", "pricing", "catalog", "inventory", "returns", "purchases", "purchase-orders"]) },
    { id: "insights", title: "Operations & insights", items: linksFor(["cashbook", "operations", "reports"]) },
    { id: "account", title: "Business & account", items: accountLinks },
  ].filter((group) => group.items.length > 0);
}
