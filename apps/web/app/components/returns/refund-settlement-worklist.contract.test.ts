import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const worklist = readFileSync(new URL("./refund-settlement-worklist.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./return-refund-workspace.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../../api/src/sales-read.ts", import.meta.url), "utf8");

describe("outstanding refund settlement worklist", () => {
  it("has a read-only, tenant-and-branch-scoped API not limited to recent receipts", () => {
    expect(api).toContain('"/v1/refunds/settlement-queue"');
    expect(api).toContain("requireBusinessRole(pool, auth, businessId, REFUND_REVIEW_ROLES)");
    expect(api).toContain("requireBranch(pool, businessId, branchId)");
    expect(api).toContain("rt.business_id=$1 AND rc.branch_id=$2");
    expect(api).toContain("rt.status IN ('PENDING','FAILED')");
    expect(api).toContain("LIMIT $4 OFFSET $5");
    expect(api).toContain('"Cache-Control", "private, no-store, max-age=0"');
    expect(api).not.toContain('app.post("/v1/refunds/settlement-queue"');
  });
  it("surfaces verified financial statuses and no manual mark-paid action", () => {
    expect(worklist).toContain("All outstanding payouts in this branch");
    expect(worklist).toContain("Read-only: pending refunds are not paid until the provider confirms settlement.");
    expect(worklist).toContain("REVIEW_ROLES.has(role)");
    expect(worklist).toContain("summary.pendingMinor");
    expect(worklist).toContain("summary.failedMinor");
    expect(worklist).toContain("settlementAgeLabel(");
    expect(worklist).toContain("providerReference");
    expect(worklist).toContain('aria-label="Unresolved refund payouts"');
    expect(worklist).toContain('href={`/sales/receipt/${encodeURIComponent(item.saleId)}`}');
    expect(worklist).toContain("hasMore");
    expect(worklist).toContain("[session?.businessId, session?.branchId]");
    expect(worklist).not.toContain("Mark paid");
    expect(worklist).not.toContain("/v1/sync");
  });
  it("refreshes the worklist after a return/exchange completes", () => {
    expect(workspace).toContain("<RefundSettlementWorklist refreshToken={settlementRefresh} />");
    expect(workspace).toContain("setSettlementRefresh((previous) => previous + 1)");
    expect(workspace).toContain("void refreshInventory()");
    expect(workspace).toContain("void refreshCustomers()");
  });
});
