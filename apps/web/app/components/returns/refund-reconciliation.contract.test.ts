import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../../../api/src/refund-reconciliation-preflight.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../../api/src/app.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("./refund-reconciliation-panel.tsx", import.meta.url), "utf8");
const worklist = readFileSync(new URL("./refund-settlement-worklist.tsx", import.meta.url), "utf8");

describe("refund provider reconciliation preflight", () => {
  it("reads the original money, currency and reference in the precise merchant branch", () => {
    expect(app).toContain("registerRefundReconciliationRoutes(app, pool)");
    expect(api).toContain('"/v1/refunds/reconciliation-preflight"');
    expect(api).toContain("authenticateAccessToken(pool, request.headers.authorization)");
    expect(api).toContain("requireBusinessRole(pool, auth, businessId, REVIEW_ROLES)");
    expect(api).toContain("rc.branch_id=$3");
    expect(api).toContain("p.branch_id=rc.branch_id AND p.sale_id=rc.original_sale_id");
    expect(api).toContain("a.payment_id=p.id");
    expect(api).toContain('safeMinor(row.payment_amount_minor, "original payment")');
    expect(api).toContain('"REFUND_AMOUNT_EXCEEDS_PAYMENT"');
    expect(api).toContain('"ORIGINAL_PAYMENT_CURRENCY_MISMATCH"');
    expect(api).toContain('"HUBTEL_ORIGINAL_TRANSACTION_REFERENCE_CONFLICT"');
  });
  it("never misidentifies the original payment as destination-proven refund settlement", () => {
    expect(api).toContain('"REFUND_DESTINATION_NOT_PROVIDER_VERIFIED"');
    expect(api).toContain('"REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED"');
    expect(api).toContain('providerFinality: "NOT_ESTABLISHED"');
    expect(api).toContain('canMarkPaid: false');
    expect(api).toContain("providerRecheckAvailable: false");
    expect(api).not.toContain("UPDATE refund_transactions");
    expect(api).not.toContain("fetch(");
    expect(panel).toContain('snapshot.canMarkPaid === false');
    expect(panel).toContain('snapshot.providerFinality === "NOT_ESTABLISHED"');
    expect(panel).toContain("Refund completion requires an independently authenticated");
    expect(panel).not.toContain("Mark paid");
  });
  it("exposes the check only within refund worklist, with a fail-closed response", () => {
    expect(worklist).toContain("<RefundReconciliationPanel");
    expect(worklist).toContain("setSelectedReconciliationId(null)");
    expect(worklist).toContain("Reconciliation checks");
    expect(panel).toContain("data?.refundId === refundId");
    expect(panel).toContain("Array.isArray(snapshot.blockers)");
    expect(panel).toContain("Reconciliation response is incomplete or inconsistent");
    expect(panel).toContain("refetch");
  });
});
