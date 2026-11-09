import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const contractPath = resolve(__dirname, "../../../packages/contracts/src/tenant-billing.ts");
const indexPath = resolve(__dirname, "../../../packages/contracts/src/index.ts");

function contractSource(): string {
  return readFileSync(contractPath, "utf8");
}

describe("tenant billing contracts", () => {
  it("defines tenant-safe overview, plan, entitlement and lifecycle action shapes", () => {
    const source = contractSource();
    expect(source).toContain("TenantBillingOverview");
    expect(source).toContain("TenantBillingPlan");
    expect(source).toContain("TenantBillingSubscription");
    expect(source).toContain("TenantBillingEntitlement");
    expect(source).toContain('"CANCEL_AT_PERIOD_END" | "RESUME"');
    expect(source).toContain("supportedActions");
    expect(source).toContain("effectiveEntitlements");
    expect(source).toContain("publicPlans");
  });

  it("defines tenant-safe invoice and payment projections without provider/internal references", () => {
    const source = contractSource();
    expect(source).toContain("TenantBillingInvoiceSummary");
    expect(source).toContain("TenantBillingInvoiceDetail");
    expect(source).toContain("TenantBillingPaymentSummary");
    expect(source).toContain('"REFUNDED";');
    expect(source).toContain('"REVERSED"');
    expect(source).not.toMatch(/providerCustomerReference|providerSubscriptionReference|providerEventReference|idempotencyKey|rawMetadata/);
  });

  it("exports the tenant billing contracts from the package root", () => {
    const index = readFileSync(indexPath, "utf8");
    expect(index).toContain('export * from "./tenant-billing.js";');
  });
});
