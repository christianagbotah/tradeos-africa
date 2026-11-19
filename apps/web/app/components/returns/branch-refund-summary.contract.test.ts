import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const screen = read("./return-refund-workspace.tsx");
const api = read("../../../../api/src/sales-read.ts");

describe("branch-wide refund financial totals", () => {
  it("reads payment totals from an authorized all-time branch endpoint", () => {
    expect(api).toContain('"/v1/refunds/branch-summary"');
    expect(api).toContain('scope: "BRANCH_ALL_TIME"');
    expect(api).toContain("GROUP BY rt.currency_code");
    expect(api).toContain("rc.branch_id=$2");
    expect(api).toContain("rt.status='SUCCEEDED'");
    expect(api).toContain("rt.status='PENDING'");
    expect(api).toContain("rt.status='FAILED'");
    expect(api).toContain('["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER"]');
    expect(screen).toContain('scope !== "BRANCH_ALL_TIME"');
    expect(screen).toContain("pendingPayoutMinor");
    expect(screen).toContain("settledPayoutMinor");
    expect(screen).toContain("failedPayoutMinor");
    expect(screen).toContain("refetchSummary()");
  });

  it("does not turn an invalid response into a verified zero", () => {
    expect(screen).toContain("Number.isSafeInteger(amount) && amount >= 0");
    expect(screen).toContain("!Array.isArray(branchRefundData.balances)");
    expect(screen).toContain("Branch refund totals could not be verified");
    expect(screen).toContain("currencies are not combined");
    expect(screen).toContain('Latest 50 receipts only');
    expect(screen).toContain("all branch receipts");
    expect(screen).toContain('label="Recent receipt value"');
    expect(screen).toContain("Gross receipts · latest 50");
    expect(screen).toContain("Corrections in latest 50");
  });
});
