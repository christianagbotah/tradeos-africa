import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, normalizeSettingsSection } from "./settings-workspace";

const billingUrl = new URL("./billing-settings.tsx", import.meta.url);
const billingSource = existsSync(billingUrl) ? readFileSync(billingUrl, "utf8") : "";
const workspaceSource = readFileSync(new URL("./settings-workspace.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../../workspace-shell.css", import.meta.url), "utf8");

describe("tenant billing settings contract", () => {
  it("adds Billing & subscription as a first-class Settings destination", () => {
    expect(SETTINGS_SECTIONS.some((section) => section.id === "billing" && section.label === "Billing & subscription")).toBe(true);
    expect(normalizeSettingsSection("billing")).toBe("billing");
    expect(workspaceSource).toContain("<BillingSettings");
  });

  it("loads only tenant-safe overview, invoice and payment projections", () => {
    expect(billingSource).toContain("/v1/billing/overview?businessId=");
    expect(billingSource).toContain("/v1/billing/invoices?businessId=");
    expect(billingSource).toContain("/v1/billing/payments?businessId=");
    expect(billingSource).toContain("TenantBillingOverview");
    expect(billingSource).toContain("TenantBillingInvoiceSummary");
    expect(billingSource).toContain("TenantBillingPaymentSummary");
    expect(billingSource).not.toMatch(/providerEventReference|providerTransactionReference|providerInvoiceReference|failureMessage/);
  });

  it("keeps lifecycle actions server-shaped, role-gated and online-only", () => {
    expect(billingSource).toContain("canReadTenantBilling");
    expect(billingSource).toContain("canManageTenantSubscription");
    expect(billingSource).toContain('role === "OWNER" || role === "ADMIN"');
    expect(billingSource).toContain('/v1/billing/subscription/cancel-at-period-end');
    expect(billingSource).toContain('/v1/billing/subscription/resume');
    expect(billingSource).toMatch(/body:\s*JSON\.stringify\(\{\s*businessId:\s*session\.businessId\s*\}\)/s);
    expect(billingSource).toMatch(/if \(!online \|\| !canManage/);
    const transitionSource = billingSource.slice(billingSource.indexOf("const transitionSubscription"), billingSource.indexOf("if (!session) return null"));
    expect(transitionSource).not.toMatch(/planId|amountMinor|providerTransaction|paymentMethod/);
  });

  it("renders current plan, entitlements, plan comparison and billing history with mobile-safe styling", () => {
    for (const text of ["Current plan", "Effective entitlements", "Available plans", "Invoices", "Payments"]) {
      expect(billingSource).toContain(text);
    }
    expect(cssSource).toContain(".tos-billing-settings");
    expect(cssSource).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.tos-billing-settings__plans[\s\S]*?grid-template-columns:\s*1fr/);
    expect(cssSource).toMatch(/@media \(max-width: 420px\)[\s\S]*?\.tos-billing-settings__history-row/);
  });
});
