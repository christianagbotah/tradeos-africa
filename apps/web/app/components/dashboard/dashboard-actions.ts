import { canAccessWorkspaceRoute } from "../workspace/workspace-navigation";

export type DashboardQuickAction = {
  href: string;
  label: string;
  description: string;
};

type ActionDefinition = DashboardQuickAction & { roles: string[] };

const definitions: ActionDefinition[] = [
  { href: "/sell", label: "Sell", description: "Start a sale", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"] },
  { href: "/purchases", label: "Receive stock", description: "Purchase or receive inventory", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"] },
  { href: "/cashbook", label: "Record expense", description: "Capture money out", roles: ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"] },
  { href: "/customers", label: "Customer payment", description: "Collect receivables", roles: ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"] },
  { href: "/catalog", label: "Add item", description: "Product or service", roles: ["OWNER", "ADMIN", "MANAGER", "INVENTORY"] },
];

export function dashboardQuickActions(role: string): DashboardQuickAction[] {
  return definitions
    .filter((item) => item.roles.includes(role) && canAccessWorkspaceRoute(role, item.href))
    .map(({ roles: _roles, ...item }) => item);
}
