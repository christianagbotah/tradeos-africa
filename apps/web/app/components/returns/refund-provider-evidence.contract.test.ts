import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const api=readFileSync(new URL("../../../../api/src/refund-provider-evidence.ts",import.meta.url),"utf8");
const app=readFileSync(new URL("../../../../api/src/app.ts",import.meta.url),"utf8");
const panel=readFileSync(new URL("./refund-provider-evidence-panel.tsx",import.meta.url),"utf8");
const outer=readFileSync(new URL("./refund-reconciliation-panel.tsx",import.meta.url),"utf8");
const migration=readFileSync(new URL("../../../../../packages/db/migrations/0060_refund_provider_evidence_claim_review.sql",import.meta.url),"utf8");

describe("unverified merchant-supplied provider proof contract",()=>{
  it("scopes claims/reviews to authorized finance membership and the original refund branch",()=>{
    expect(app).toContain("registerRefundProviderEvidenceRoutes(app, pool)");
    expect(api).toContain('"/v1/refunds/provider-evidence"');
    expect(api).toContain('"/v1/refunds/provider-evidence-review"');
    expect(api).toContain("authenticateAccessToken(pool,headers.authorization)");
    expect(api).toContain("requireBusinessRole(pool,auth,businessId,ROLES)");
    expect(api).toContain("rc.branch_id=$3");
    expect(api).toContain("FOR UPDATE OF rt");
    expect(api).toContain("auth.userId===claim.submitted_by_user_id");
    expect(api).toContain("REFUND_EVIDENCE_SECOND_REVIEWER_REQUIRED");
    expect(api).toContain("REFUND_EVIDENCE_AMOUNT_CURRENCY_MISMATCH");
    expect(api).toContain("REFUND_EVIDENCE_IDEMPOTENCY_CONFLICT");
  });
  it("prevents payout finality or any false provider authentication",()=>{
    expect(api).toContain('evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED"');
    expect(api).toContain('providerAuthenticated:false');
    expect(api).toContain('refundDestinationAuthenticated:false');
    expect(api).toContain('providerFinality:"NOT_ESTABLISHED"');
    expect(api).toContain('canMarkPaid:false');
    expect(api).not.toContain("UPDATE refund_transactions");
    expect(api).not.toContain("UPDATE payments SET");
    expect(api).not.toContain("fetch(");
    expect(migration).toContain("CHECK (provider_authenticated=false)");
    expect(migration).toContain("CHECK (payout_finality_established=false)");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE");
    expect(migration).toContain("Merchant provider evidence claims are append-only");
    expect(migration).toContain("c.submitted_by_user_id<>NEW.reviewer_user_id");
    expect(migration).toContain("NEW.decision<>'FIELDS_MATCHED_UNVERIFIED'");
  });
  it("shows only masked destinations with honest provider status and reviewer separation",()=>{
    expect(outer).toContain("<RefundProviderEvidencePanel refundId={refundId}");
    expect(panel).toContain("data?.refundId===refundId");
    expect(panel).toContain('item.providerAuthenticated===false');
    expect(panel).toContain('item.providerFinality==="NOT_ESTABLISHED"');
    expect(panel).toContain("****{item.recipientLast4}");
    expect(panel).toContain("account&&account.id!==item.submittedByUserId");
    expect(panel).toContain("!queue.online");
    expect(panel).toContain("submissionId.current??crypto.randomUUID()");
    expect(panel).toContain("reviewId.current??crypto.randomUUID()");
    expect(panel).toContain("getOfflineQueue().authenticatedFetch");
    expect(panel).toContain('cache:"no-store"');
    expect(panel).toContain("provider independently authenticates");
    expect(panel).not.toContain("Mark paid");
  });
  it("uses exact ISO-currency minor units without floating-point arithmetic",()=>{
    expect(panel).toContain("new Intl.NumberFormat");
    expect(panel).toContain("10n**BigInt(decimals)");
    expect(panel).toContain("Number.MAX_SAFE_INTEGER");
    expect(panel).toContain("Number.isSafeInteger(data.expectedAmountMinor)");
    expect(panel).toContain("Number.isSafeInteger(item.reportedAmountMinor)");
  });
});
