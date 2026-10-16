import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(appRoot, relative));

describe("System Admin billing workspaces contract", () => {
  it("adds task-oriented billing navigation", () => {
    const nav = read("components/nav.ts");
    expect(nav).toContain('label: "Billing"');
    for (const href of ["/console/plans", "/console/subscriptions", "/console/billing/invoices", "/console/billing/payments"]) {
      expect(nav).toContain(`href: "${href}"`);
    }
  });

  it("connects plans and subscriptions to live management APIs with explicit impact/reason controls", () => {
    expect(exists("console/plans/page.tsx")).toBe(true);
    expect(exists("console/subscriptions/page.tsx")).toBe(true);
    if (!exists("console/plans/page.tsx") || !exists("console/subscriptions/page.tsx")) return;
    const plans = read("console/plans/page.tsx");
    const subscriptions = read("console/subscriptions/page.tsx");
    expect(plans).toContain("/api/admin/plans");
    expect(plans).toContain('method: "POST"');
    expect(plans).toContain('method: "PATCH"');
    expect(plans).toContain("amountMinor");
    expect(plans).toContain("billingInterval");
    expect(plans).toContain("reason");
    expect(plans).toContain("expectedUpdatedAt");
    expect(subscriptions).toContain("/api/admin/subscriptions");
    expect(subscriptions).toContain("/api/admin/tenants/");
    expect(subscriptions).toContain('method: "PATCH"');
    expect(subscriptions).toContain("reason");
    expect(subscriptions).toContain("expectedUpdatedAt");
    expect((plans + subscriptions).toLowerCase()).toContain("confirm");
  });

  it("renders live invoice and payment ledgers with filters, minor-unit formatting, and drill-down details", () => {
    expect(exists("console/billing/invoices/page.tsx")).toBe(true);
    expect(exists("console/billing/payments/page.tsx")).toBe(true);
    if (!exists("console/billing/invoices/page.tsx") || !exists("console/billing/payments/page.tsx")) return;
    const invoices = read("console/billing/invoices/page.tsx");
    const payments = read("console/billing/payments/page.tsx");
    expect(invoices).toContain("/api/admin/billing/invoices");
    expect(invoices).toContain("formatMinor");
    expect(invoices).toContain("statusFilter");
    expect(invoices).toContain("selectedInvoiceId");
    expect(invoices).toContain("/api/admin/billing/invoices/");
    expect(payments).toContain("/api/admin/billing/payments");
    expect(payments).toContain("formatMinor");
    expect(payments).toContain("statusFilter");
    expect(payments).toContain("providerTransactionReference");
    expect(payments).toContain("<details");
    expect((invoices + payments).toLowerCase()).not.toContain("api pending");
  });

  it("uses loading/error/empty states and responsive billing layout instead of desktop-only tables", () => {
    for (const file of [
      "console/plans/page.tsx",
      "console/subscriptions/page.tsx",
      "console/billing/invoices/page.tsx",
      "console/billing/payments/page.tsx",
    ]) {
      if (!exists(file)) continue;
      const source = read(file);
      expect(source).toContain("loading");
      expect(source).toContain("error");
      expect(source).toContain("admin-billing-card");
    }
    const css = read("admin-components.css");
    expect(css).toContain(".admin-billing-grid");
    expect(css).toContain(".admin-billing-card");
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*admin-billing-grid/);
  });
});
