import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const api=readFileSync(new URL("../../../../api/src/sales-read.ts",import.meta.url),"utf8");
const rollup=readFileSync(new URL("../../../../api/src/refund-evidence-branch-rollup.ts",import.meta.url),"utf8");
const worklist=readFileSync(new URL("./refund-settlement-worklist.tsx",import.meta.url),"utf8");
const reconciliation=readFileSync(new URL("./refund-reconciliation-panel.tsx",import.meta.url),"utf8");
const evidence=readFileSync(new URL("./refund-provider-evidence-panel.tsx",import.meta.url),"utf8");

describe("branch-wide provider evidence rollup and reactive worklist",()=>{
  it("returns all unresolved liabilities by exact tenant, branch, and original currency",()=>{
    expect(api).toContain("requireBusinessRole(pool, auth, businessId, REFUND_REVIEW_ROLES)");
    expect(api).toContain("await requireBranch(pool, businessId, branchId)");
    expect(api).toContain("loadRefundEvidenceBranchRollup(");
    expect(api).toContain("evidenceSummaryByCurrency,");
    expect(api).toContain("\"EVIDENCE_MISSING\"");
    expect(api).toContain("$3='EVIDENCE_MISSING'");
    expect(api).toContain("original_payment.sale_id=rc.original_sale_id");
    expect(rollup).toContain("rc.branch_id=$2");
    expect(rollup).toContain("WHERE rt.business_id=$1 AND rt.status IN ('PENDING','FAILED')");
    expect(rollup).toContain("claim.branch_id=rc.branch_id");
    expect(rollup).toContain("review.branch_id=rc.branch_id");
    expect(rollup).toContain("original_payment.sale_id=rc.original_sale_id");
    expect(rollup).toContain("GROUP BY currency_code ORDER BY currency_code");
  });
  it("counts each refund once per bucket, explicitly allowing discrepancy-review overlap",()=>{
    expect(rollup).toContain("LEFT JOIN LATERAL");
    expect(rollup).toContain("COUNT(*) FILTER");
    expect(rollup).toContain("COUNT(*) FILTER (\n          WHERE electronic_refund AND claim_count=0");
    expect(rollup).toContain("WHERE awaiting_review_count>0");
    expect(rollup).toContain("WHERE discrepancy_count>0");
    expect(rollup).toContain("WHERE claim_count>0 AND awaiting_review_count=0");
    expect(rollup).toContain("not provider payout receipts");
    expect(rollup).not.toContain("UPDATE refund_transactions");
    expect(rollup).not.toContain("UPDATE payments");
    expect(rollup).not.toContain("providerAuthenticated:true");
    expect(worklist).toContain("Discrepancy and awaiting-review categories can overlap");
    expect(worklist).toContain("No evidence counts only electronic refunds");
  });
  it("fails closed rather than fabricating zero branch totals for stale API responses",()=>{
    expect(worklist).toContain("Array.isArray(rawEvidence)");
    expect(worklist).toContain("rawEvidence.length === rawBalances.length");
    expect(worklist).toContain("Number.isSafeInteger(value) && value >= 0");
    expect(worklist).toContain("Branch-wide evidence totals are unavailable");
    expect(worklist).toContain('"EVIDENCE_MISSING", label: "No evidence submitted"');
    expect(worklist).toContain("No evidence ({summary.missingCount})");
    expect(worklist).toContain("Provider proof needed ({summary.needsProviderCount})");
  });
  it("refreshes parent worklist after either authenticated evidence write",()=>{
    expect(worklist).toContain("onEvidenceRecorded={refetch}");
    expect(reconciliation).toContain("onEvidenceRecorded: () => void");
    expect(reconciliation).toContain("onRecorded={onEvidenceRecorded}");
    expect(evidence).toContain("onRecorded?:()=>void");
    expect(evidence).toContain("onRecorded?.();");
    expect(evidence.match(/onRecorded\?\.\(\);/g)).toHaveLength(2);
    expect(evidence).toContain("if(!resp.ok)throw new Error");
    expect(evidence).toContain("result.providerFinality!==\"NOT_ESTABLISHED\"");
  });
});
