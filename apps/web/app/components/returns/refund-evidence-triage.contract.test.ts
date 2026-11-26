import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const api=readFileSync(new URL("../../../../api/src/sales-read.ts",import.meta.url),"utf8");
const ui=readFileSync(new URL("./refund-settlement-worklist.tsx",import.meta.url),"utf8");
describe("refund provider evidence attention filters",()=>{
  it("restricts all filters to unresolved refunds of exact authorized business/branch",()=>{
    expect(api).toContain("requireBusinessRole(pool, auth, businessId, REFUND_REVIEW_ROLES)");
    expect(api).toContain("await requireBranch(pool, businessId, branchId)");
    expect(api).toContain("rt.status IN ('PENDING','FAILED')");
    expect(api).toContain("claim.business_id=rt.business_id AND claim.branch_id=rc.branch_id");
    expect(api).toContain("review.evidence_claim_id=claim.id");
    expect(api).toContain("review.business_id=rt.business_id");
    expect(api).toContain("review.branch_id=rc.branch_id");
  });
  it("separates evidence claims, unreviewed submissions and mismatches",()=>{
    expect(api).toContain("LEFT JOIN LATERAL");
    expect(api).toContain("AS evidence_claim_count");
    expect(api).toContain("AS evidence_awaiting_review_count");
    expect(api).toContain("AS evidence_discrepancy_count");
    expect(api).toContain("claim.reported_amount_minor<>rt.amount_minor");
    expect(api).toContain("claim.reported_currency<>rt.currency_code");
    expect(api).toContain("review.decision='DISCREPANCY_RECORDED'");
    expect(api).toContain("$3='EVIDENCE_MISMATCH'");
    expect(api).toContain("$3='EVIDENCE_AWAITING_REVIEW'");
    expect(api).toContain("$3='EVIDENCE_NEEDS_PROVIDER'");
    expect(api).toContain('providerFinality: "NOT_ESTABLISHED"');
    expect(api).not.toContain("UPDATE refund_transactions");
  });
  it("never mislabels reviewed merchant claims as authenticated provider payouts",()=>{
    expect(ui).toContain('type SettlementFilter = "ALL"');
    expect(ui).toContain('"EVIDENCE_AWAITING_REVIEW", label: "Evidence to review"');
    expect(ui).toContain('"EVIDENCE_MISMATCH", label: "Evidence discrepancies"');
    expect(ui).toContain('"EVIDENCE_NEEDS_PROVIDER", label: "Provider proof needed"');
    expect(ui).toContain('item.providerFinality === "NOT_ESTABLISHED"');
    expect(ui).toContain("Number.isSafeInteger(n)");
    expect(ui).toContain("Awaiting provider proof");
    expect(ui).toContain("setSelectedReconciliationId(null)");
  });
});
