export type DemoAccount = {
  id: string;
  label: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "CASHIER" | "SALES" | "INVENTORY" | "ACCOUNTANT" | "STAFF" | "VIEWER";
  email: string;
  password: string;
};

const DEMO_PASSWORD = "TradeOSDemo2026!";

export const demoAccounts: readonly DemoAccount[] = [
  { id: "owner", label: "Business Owner · full access", role: "OWNER", email: "demo.owner@tradeos.africa", password: DEMO_PASSWORD },
  { id: "admin", label: "Business Admin", role: "ADMIN", email: "demo.admin@tradeos.africa", password: DEMO_PASSWORD },
  { id: "manager", label: "Branch Manager", role: "MANAGER", email: "demo.manager@tradeos.africa", password: DEMO_PASSWORD },
  { id: "cashier", label: "Cashier · POS", role: "CASHIER", email: "demo.cashier@tradeos.africa", password: DEMO_PASSWORD },
  { id: "sales", label: "Sales Officer", role: "SALES", email: "demo.sales@tradeos.africa", password: DEMO_PASSWORD },
  { id: "inventory", label: "Inventory Officer", role: "INVENTORY", email: "demo.inventory@tradeos.africa", password: DEMO_PASSWORD },
  { id: "accountant", label: "Accountant", role: "ACCOUNTANT", email: "demo.accountant@tradeos.africa", password: DEMO_PASSWORD },
  { id: "staff", label: "General Staff", role: "STAFF", email: "demo.staff@tradeos.africa", password: DEMO_PASSWORD },
  { id: "viewer", label: "Viewer · read only", role: "VIEWER", email: "demo.viewer@tradeos.africa", password: DEMO_PASSWORD },
] as const;

export function getDemoAccount(id: string): DemoAccount | null {
  return demoAccounts.find((account) => account.id === id) ?? null;
}
