export type WorkspaceNavItem = {
  href: string;
  label: string;
  group: "Overview" | "Commerce" | "Money" | "Operations" | "Insights";
  roles?: string[];
};

const allBusinessRoles = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"];

export const workspaceNavigation: WorkspaceNavItem[] = [
  { href: "/dashboard", label: "Dashboard", group: "Overview", roles: allBusinessRoles },
  { href: "/sell", label: "Sell / POS", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"] },
  { href: "/sales", label: "Sales", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT", "VIEWER"] },
  { href: "/customers", label: "Customers & credit", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT", "VIEWER"] },
  { href: "/purchases", label: "Purchases", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT", "VIEWER"] },
  { href: "/inventory", label: "Inventory", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT", "VIEWER"] },
  { href: "/catalog", label: "Catalog & units", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY"] },
  { href: "/returns", label: "Returns & refunds", group: "Commerce", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT"] },
  { href: "/cashbook", label: "Cashbook & expenses", group: "Money", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"] },
  { href: "/operations", label: "Day & shifts", group: "Operations", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "STAFF"] },
  { href: "/reports", label: "Reports & intelligence", group: "Insights", roles: ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "VIEWER"] },
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
