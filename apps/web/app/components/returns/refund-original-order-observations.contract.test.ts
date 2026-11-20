import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const api=readFileSync(new URL("../../../../api/src/refund-original-order-observations.ts",import.meta.url),"utf8");
const app=readFileSync(new URL("../../../../api/src/app.ts",import.meta.url),"utf8");
const panel=readFileSync(new URL("./refund-hubtel-original-order-checks.tsx",import.meta.url),"utf8");
const reconciliation=readFileSync(new URL("./refund-reconciliation-panel.tsx",import.meta.url),"utf8");
const migration=readFileSync(new URL("../../../../../packages/db/migrations/0059_refund_provider_original_order_observations.sql",import.meta.url),"utf8");

describe("Hubtel original order refund observation safety contract",()=>{
  it("requires finance authorization, source payment scope and original merchant credentials",()=>{
    expect(app).toContain("registerRefundOriginalOrderRoutes(app, pool)");
    expect(api).toContain("authenticateAccessToken(pool,request.headers.authorization)");
    expect(api).toContain("requireBusinessRole(pool,auth,businessId,ROLES)");
    expect(api).toContain("rc.branch_id=$3");
    expect(api).toContain("p.sale_id=rc.original_sale_id");
    expect(api).toContain("a.payment_id=p.id");
    expect(api).toContain("config.collectionAccount!==context.merchant_collection_account");
    expect(api).toContain("config.credentialSource!==context.credential_source");
    expect(api).toContain("config.merchantCredentialRevision!==context.merchant_credential_revision");
    expect(api).toContain("HubtelStatusClient");
    expect(api).toContain("verified.clientReference!==context.client_reference");
    expect(api).toContain("verified.collectionAccount!==config.collectionAccount");
    expect(api).toContain("safeMinor(context.expected_amount_minor");
  });
  it("audits immutable original-order observations without ever marking a refund paid",()=>{
    expect(api).toContain("COOLDOWN_MINUTES = 5");
    expect(api).toContain("ON CONFLICT(refund_transaction_id) DO UPDATE SET");
    expect(api).toContain("REFUND_ORIGINAL_ORDER_COOLDOWN");
    expect(api).toContain("FOR UPDATE OF rt,p,a");
    expect(api).toContain('"REFUND_ORIGINAL_ORDER_CHANGED"');
    expect(api).toContain("REFUND_ORIGINAL_HUBTEL_ORDER_CHECKED");
    expect(api).toContain('evidenceScope: "ORIGINAL_PAYMENT_ONLY"');
    expect(api).toContain('refundDestinationVerified: false');
    expect(api).toContain('refundSpecificSettlementVerified: false');
    expect(api).toContain('providerFinality: "NOT_ESTABLISHED"');
    expect(api).toContain('canMarkPaid: false');
    expect(api).not.toContain("UPDATE refund_transactions");
    expect(api).not.toContain("UPDATE payments SET");
    expect(api).not.toContain("requestRefund(");
    expect(migration).toContain("CHECK(refund_destination_verified=false)");
    expect(migration).toContain("CHECK(refund_settlement_verified=false)");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE");
    expect(migration).toContain("Provider original-order observations are immutable");
  });
  it("keeps the UI online only and fail-closed with evidence-scope warnings",()=>{
    expect(reconciliation).toContain("<RefundHubtelOriginalOrderChecks refundId={refundId}");
    expect(panel).toContain("data?.refundId===refundId");
    expect(panel).toContain('result.providerFinality==="NOT_ESTABLISHED"');
    expect(panel).toContain('item.evidenceScope==="ORIGINAL_PAYMENT_ONLY"');
    expect(panel).toContain('result.canMarkPaid===false');
    expect(panel).toContain("!queue.online");
    expect(panel).toContain("requestId.current??crypto.randomUUID()");
    expect(panel).toContain("cache:\"no-store\"");
    expect(panel).toContain("No authenticated original-order checks recorded");
    expect(panel).toContain("not a specific");
    expect(panel).not.toContain("Mark paid");
  });
});
