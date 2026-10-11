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
  IconSell,
} from "../ui/icons";

export type WorkspaceRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "CASHIER"
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
  group: "Trade" | "Inventory" | "Master data" | "Money" | "Insights";
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

export const WORKSPACE_NAV_ITEMS: readonly WorkspaceNavItem[] = [
  { id: "dashboard", segment: "dashboard", label: "Dashboard", shortLabel: "Home", group: "Trade", icon: IconDashboard, primary: true },
  { id: "sell", segment: "sell", label: "Sell (POS)", shortLabel: "Sell", group: "Trade", icon: IconSell, visibleTo: WRITE_ROLES, primary: true },
  { id: "sales", segment: "sales", label: "Sales", shortLabel: "Sales", group: "Trade", icon: IconSales, primary: true },
  { id: "customers", segment: "customers", label: "Customers", shortLabel: "Customers", group: "Master data", icon: IconCustomers, primary: true },
  { id: "catalog", segment: "catalog", label: "Catalog", shortLabel: "Catalog", group: "Master data", icon: IconCatalog },
  { id: "inventory", segment: "inventory", label: "Inventory", shortLabel: "Stock", group: "Inventory", icon: IconInventory, visibleTo: WRITE_ROLES },
  { id: "returns", segment: "returns", label: "Returns & refunds", shortLabel: "Returns", group: "Trade", icon: IconReturns, visibleTo: MANAGER_ROLES },
  { id: "purchases", segment: "purchases", label: "Purchases & suppliers", shortLabel: "Purchases", group: "Inventory", icon: IconPurchases, visibleTo: MANAGER_ROLES },
  { id: "cashbook", segment: "cashbook", label: "Cashbook", shortLabel: "Cashbook", group: "Money", icon: IconCashbook, visibleTo: MANAGER_ROLES },
  { id: "operations", segment: "operations", label: "Operations", shortLabel: "Ops", group: "Money", icon: IconOperations, visibleTo: MANAGER_ROLES },
  { id: "reports", segment: "reports", label: "Reports", shortLabel: "Reports", group: "Insights", icon: IconReports, visibleTo: MANAGER_ROLES },
];

/** Returns the nav items visible to the given role. */
export function visibleNavItems(role: WorkspaceRole | null | undefined): readonly WorkspaceNavItem[] {
  if (!role) return [];
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
  const order: readonly WorkspaceNavItem["group"][] = ["Trade", "Inventory", "Master data", "Money", "Insights"];
  return order.map((group) => ({
    group,
    items: visible.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}
