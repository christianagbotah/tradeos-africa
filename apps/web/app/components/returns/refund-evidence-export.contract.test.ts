import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const api = readFileSync(
  new URL("../../../../api/src/refund-evidence-export.ts",import.meta.url),"utf8");
const app = readFileSync(
  new URL("../../../../api/src/app.ts",import.meta.url),"utf8");
const worklist = readFileSync(
  new URL("./refund-settlement-worklist.tsx",import.meta.url),"utf8");
const evidence = readFileSync(
  new URL("./refund-provider-evidence-panel.tsx",import.meta.url),"utf8");

describe("finance-only unresolved refund investigation CSV export contract",()=>{
  it("requires authenticated finance role, exact branch and explicit allowed filters",()=>{
    expect(app).toContain("registerRefundEvidenceExportRoutes(app, pool)");
    expect(api).toContain('"/v1/refunds/settlement-evidence-export"');
    expect(api).toContain("authenticateAccessToken(pool,request.headers.authorization)");
    expect(api).toContain("requireBusinessRole(pool,auth,businessId,ROLES)");
    expect(api).toContain("is_active=true");
    expect(api).toContain("rc.branch_id=$2");
    expect(api).toContain("rt.business_id=$1");
    expect(api).toContain("rt.status IN ('PENDING','FAILED')");
    expect(api).toContain("claim.business_id=rt.business_id AND claim.branch_id=rc.branch_id");
    expect(api).toContain('"EVIDENCE_MISSING"');
    expect(api).toContain('"EVIDENCE_MISMATCH"');
    expect(api).toContain('"EVIDENCE_NEEDS_PROVIDER"');
  });
  it("bounds exports without silently truncating, mixing currencies or elevating payout status",()=>{
    expect(api).toContain("MAX_EVIDENCE_EXPORT_ROWS = 5000");
    expect(api).toContain("MAX_EVIDENCE_EXPORT_ROWS+1");
    expect(api).toContain("REFUND_EXPORT_TOO_LARGE");
    expect(api).toContain("currencyCode");
    expect(api).toContain("rt.currency_code=$4");
    expect(api).toContain('"MERCHANT_SUPPLIED_UNVERIFIED"');
    expect(api).toContain('"NOT_ESTABLISHED"');
    expect(api).toContain('"FALSE"');
    expect(api).not.toContain("UPDATE refund_transactions");
    expect(api).not.toContain("UPDATE payments");
    expect(api).not.toContain("INSERT INTO refund_transactions");
    expect(api).not.toContain("requestRefund(");
    expect(api).not.toContain("recipient_last4");
    expect(api).not.toContain("review.note");
    expect(api).not.toContain("claim.note");
  });
  it("delivers safe, no-cache, UTF-8 CSV without exposed full destinations",()=>{
    expect(api).toContain("refundEvidenceCsvCell");
    expect(api).toContain("X-Content-Type-Options");
    expect(api).toContain("nosniff");
    expect(api).toContain("Content-Disposition");
    expect(api).toContain('"text/csv; charset=utf-8"');
    expect(api).toContain("Buffer.from");
    expect(api).toContain("REFUND_EVIDENCE_CSV_EXPORTED");
  });
  it("uses authenticated online download and same filter as displayed worklist",()=>{
    expect(worklist).toContain("downloadInvestigationCsv");
    expect(worklist).toContain("getOfflineQueue().authenticatedFetch");
    expect(worklist).toContain('"/v1/refunds/settlement-evidence-export?"');
    expect(worklist).toContain("status: filter");
    expect(worklist).toContain('exportCurrency !== "ALL"');
    expect(worklist).toContain("!queue.online");
    expect(worklist).toContain("URL.createObjectURL(blob)");
    expect(worklist).toContain("URL.revokeObjectURL(objectUrl)");
    expect(worklist).toContain('role="alert"');
    expect(worklist).toContain("No evidence submitted");
    expect(evidence).toContain('providerFinality:"NOT_ESTABLISHED"');
  });
});
