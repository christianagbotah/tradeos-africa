export type WorkspaceNavIcon = "dashboard" | "sell" | "sales" | "customers" | "purchases" | "inventory" | "catalog" | "returns" | "cashbook" | "operations" | "reports" | "more";

export type WorkspaceNavGroup = "Operate" | "Inventory" | "Money & People" | "Operations" | "Insights";

export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: WorkspaceNavIcon;
  group: WorkspaceNavGroup;
  roles?: string[];
};

export type MobileNavItem = WorkspaceNavItem | { href: "#more"; label: "More"; icon: "more"; group: "Operate" };

const allBusinessRoles = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"];

export const workspaceNavigation: WorkspaceNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "Operate", roles: allBusinessRoles },
  { href: "/sell", label: "Sell / POS", icon: "sell", group: "Operate", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"] },
  { href: "/sales", label: "Sales", icon: "sales", group: "Operate", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT", "VIEWER"] },
  { href: "/returns", label: "Returns", icon: "returns", group: "Operate", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER"] },
  { href: "/catalog", label: "Catalog", icon: "catalog", group: "Inventory", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY"] },
  { href: "/inventory", label: "Inventory", icon: "inventory", group: "Inventory", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT", "VIEWER"] },
  { href: "/purchases", label: "Purchases", icon: "purchases", group: "Inventory", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT", "VIEWER"] },
  { href: "/customers", label: "Customers", icon: "customers", group: "Money & People", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT", "VIEWER"] },
  { href: "/cashbook", label: "Cashbook", icon: "cashbook", group: "Money & People", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"] },
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

const priorities: Record<string, string[]> = {
  OWNER: ["/dashboard", "/sell", "/cashbook", "/inventory"],
  ADMIN: ["/dashboard", "/sell", "/cashbook", "/inventory"],
  MANAGER: ["/dashboard", "/sell", "/cashbook", "/inventory"],
  CASHIER: ["/dashboard", "/sell", "/sales", "/cashbook"],
  INVENTORY: ["/dashboard", "/inventory", "/purchases", "/catalog"],
  ACCOUNTANT: ["/dashboard", "/cashbook", "/customers", "/reports"],
  VIEWER: ["/dashboard", "/sales", "/inventory", "/reports"],
};

function mobileLabel(item: WorkspaceNavItem): string {
  if (item.href === "/dashboard") return "Home";
  if (item.href === "/cashbook") return "Money";
  if (item.href === "/inventory") return "Stock";
  return item.label.replace(" / POS", "").replace(" & intelligence", "");
}

export function mobileWorkspaceNav(role: string): MobileNavItem[] {
  const visible = visibleWorkspaceNav(role);
  const byHref = new Map(visible.map((item) => [item.href, item]));
  const preferred = priorities[role] ?? visible.slice(0, 4).map((item) => item.href);
  const direct = preferred
    .map((href) => byHref.get(href))
    .filter((item): item is WorkspaceNavItem => Boolean(item))
    .slice(0, 4)
    .map((item) => ({ ...item, label: mobileLabel(item) }));
  return [...direct, { href: "#more", label: "More", icon: "more", group: "Operate" }];
}

export function mobileMoreNav(role: string): WorkspaceNavItem[] {
  const direct = new Set(mobileWorkspaceNav(role).filter((item) => item.href !== "#more").map((item) => item.href));
  return visibleWorkspaceNav(role).filter((item) => !direct.has(item.href));
}

export function isMobileMoreActive(role: string, pathname: string): boolean {
  return mobileMoreNav(role).some((item) => isWorkspaceNavActive(pathname, item.href));
}
