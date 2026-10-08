export type WorkspaceNavIcon = "dashboard" | "sell" | "sales" | "customers" | "purchases" | "inventory" | "catalog" | "returns" | "cashbook" | "operations" | "reports";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: WorkspaceNavIcon;
  group: "Overview" | "Commerce" | "Money" | "Operations" | "Insights";
  roles?: string[];
};

const allBusinessRoles = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"];

export const workspaceNavigation: WorkspaceNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "Overview", roles: allBusinessRoles },
  { href: "/sell", label: "Sell / POS", icon: "sell", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"] },
  { href: "/sales", label: "Sales", icon: "sales", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT", "VIEWER"] },
  { href: "/customers", label: "Customers & credit", icon: "customers", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT", "VIEWER"] },
  { href: "/purchases", label: "Purchases", icon: "purchases", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT", "VIEWER"] },
  { href: "/inventory", label: "Inventory", icon: "inventory", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT", "VIEWER"] },
  { href: "/catalog", label: "Catalog & units", icon: "catalog", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY"] },
  { href: "/returns", label: "Returns & refunds", icon: "returns", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER"] },
  { href: "/cashbook", label: "Cashbook & expenses", icon: "cashbook", group: "Money", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"] },
  { href: "/operations", label: "Day & shifts", icon: "operations", group: "Operations", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"] },
  { href: "/reports", label: "Reports & intelligence", icon: "reports", group: "Insights", roles: ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "VIEWER"] },
];

export function visibleWorkspaceNav(role: string): WorkspaceNavItem[] {
  return workspaceNavigation.filter((item) => !item.roles || item.roles.includes(role));
}

export function canAccessWorkspaceRoute(role: string, href: string): boolean {
  return visibleWorkspaceNav(role).some((item) => item.href === href);
}

export function isWorkspaceNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
