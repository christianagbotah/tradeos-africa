import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { classifyRefundReconciliation } from "../src/refund-reconciliation-preflight.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

type Source = Parameters<typeof classifyRefundReconciliation>[0];
const base: Source = {
  refund_id: "10000000-0000-4000-8000-000000000001",
  refund_status: "PENDING", refund_amount_minor: "1000",
  refund_currency: "GHS", refund_method: "MOMO", refund_provider_reference: null,
  original_payment_id: "10000000-0000-4000-8000-000000000002",
  payment_id: "10000000-0000-4000-8000-000000000002",
  payment_status: "SUCCEEDED", payment_amount_minor: "1000",
  payment_currency: "GHS", payment_method: "MOMO",
  payment_provider_reference: "verified-original-transaction",
  attempt_id: "10000000-0000-4000-8000-000000000003",
  attempt_state: "RECONCILED", attempt_amount_minor: "1000",
  attempt_currency: "GHS",
  provider_transaction_id: "verified-original-transaction",
  merchant_collection_account: "111222333",
  checkout_client_reference: "original-client-ref",
};
describe("refund reconciliation preflight", () => {
  it("never treats a verified original checkout as proof the refund was paid", () => {
    const result = classifyRefundReconciliation(base);
    expect(result).toMatchObject({
      checks: {
        amountWithinOriginalPayment: true,
        currencyMatchesOriginalPayment: true,
        refundDestinationProviderVerified: false,
        refundSpecificSettlementVerified: false,
      },
      hubtel: { checkoutLinked: true, originalCheckoutReconciled: true,
        originalTransactionReferenceMatches: true, providerRecheckAvailable: false },
      verdict: "PROVIDER_REFUND_PROOF_MISSING",
      providerFinality: "NOT_ESTABLISHED", canMarkPaid: false,
      paymentStatusUnchanged: true,
    });
    expect(result.blockers).toEqual([
      "REFUND_DESTINATION_NOT_PROVIDER_VERIFIED",
      "REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED",
    ]);
  });
  it("detects amount, currency, original transaction, and unsupported partial orders", () => {
    const result = classifyRefundReconciliation({
      ...base, refund_amount_minor: "1200", refund_currency: "USD",
      payment_provider_reference: "different-txn", attempt_currency: "GHS",
    });
    expect(result.checks).toMatchObject({
      amountWithinOriginalPayment: false,
      currencyMatchesOriginalPayment: false,
      refundDestinationProviderVerified: false,
      refundSpecificSettlementVerified: false,
    });
    expect(result.blockers).toEqual(expect.arrayContaining([
      "ORIGINAL_PAYMENT_CURRENCY_MISMATCH",
      "REFUND_AMOUNT_EXCEEDS_PAYMENT",
      "HUBTEL_ORIGINAL_CHECKOUT_MISMATCH",
      "HUBTEL_ORIGINAL_TRANSACTION_REFERENCE_CONFLICT",
      "HUBTEL_ORDER_LEVEL_PARTIAL_REFUND_UNSUPPORTED",
    ]));
    expect(result.canMarkPaid).toBe(false);
  });
  it("fails closed for missing payment, non-final states, and unsafe money", () => {
    const missing = classifyRefundReconciliation({
      ...base, original_payment_id: null, payment_id: null, payment_status: null,
      payment_amount_minor: null, payment_currency: null, payment_method: null,
      payment_provider_reference: null, attempt_id: null,
      attempt_state: null, attempt_amount_minor: null, attempt_currency: null,
      provider_transaction_id: null, merchant_collection_account: null,
      checkout_client_reference: null,
    });
    expect(missing.originalPayment).toMatchObject({
      linked: false, amountMinor: null, currencyCode: null,
    });
    expect(missing.blockers).toContain("ORIGINAL_PAYMENT_NOT_LINKED");
    expect(missing.canMarkPaid).toBe(false);
    const closed = classifyRefundReconciliation({ ...base, refund_status: "SUCCEEDED",
      payment_status: "PENDING" });
    expect(closed.blockers).toEqual(expect.arrayContaining([
      "REFUND_ALREADY_CLOSED", "ORIGINAL_PAYMENT_NOT_SETTLED",
    ]));
    expect(() => classifyRefundReconciliation({
      ...base, refund_amount_minor: "9007199254740993",
    })).toThrow(/precision/i);
    expect(() => classifyRefundReconciliation({
      ...base, payment_amount_minor: "NaN",
    })).toThrow(/precision/i);
  });
  it("allows only finance roles to view the exact refund branch; no write route exists", async () => {
    async function user(email: string, key: string) {
      const reg = await app.inject({ method: "POST", url: "/v1/auth/register",
        payload: { displayName: email.split("@")[0], email, password: "Qa-Recon-2026-Safe!",
          platform: "WEB", deviceKey: key, appVersion: "test" } });
      expect(reg.statusCode).toBe(201);
      return { headers: { authorization: `Bearer ${reg.json().session.accessToken}` },
        userId: reg.json().user.id as string };
    }
    const owner = await user("owner-recon@tradeos.test", "recon-owner");
    const cashier = await user("cashier-recon@tradeos.test", "recon-cashier");
    const outsider = await user("outsider-recon@tradeos.test", "recon-outsider");
    const onboarding = await app.inject({ method: "POST",url: "/v1/onboarding/business",
      headers: owner.headers, payload: { name: "Refund Reconciliation Test",
        businessType: "RETAIL_HARDWARE", branchName: "Main" } });
    expect(onboarding.statusCode).toBe(201);
    const businessId: string = onboarding.json().business.id;
    const branchId: string = onboarding.json().branch.id;
    await pool.query(
      "INSERT INTO business_memberships(business_id,user_id,role,status) VALUES($1,$2,'CASHIER','ACTIVE')",
      [businessId, cashier.userId],
    );
    const otherBranchId = (await pool.query<{id:string}>(
      "INSERT INTO branches(business_id,name,code) VALUES($1,'Other','OTHER') RETURNING id",
      [businessId])).rows[0]!.id;
    async function seed(key: string, branch: string,
      linkPayment: boolean, refundCurrency = "GHS") {
      const sale = (await pool.query<{id:string}>(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,
          subtotal_net_minor,total_minor,client_mutation_id)
          VALUES($1,$2,'COMPLETED','GHS',5000,5000,$3) RETURNING id`,
        [businessId,branch,`sale-${key}`])).rows[0]!.id;
      let payment: string | null = null;
      if (linkPayment) {
        payment = (await pool.query<{id:string}>(
          `INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,currency_code,
           method,status,provider_reference,client_mutation_id)
           VALUES($1,$2,$3,1500,'GHS','MOMO','SUCCEEDED','txn-ok',$4) RETURNING id`,
          [businessId,branch,sale,`payment-${key}`])).rows[0]!.id;
      }
      const ret = (await pool.query<{id:string}>(
        `INSERT INTO return_cases(business_id,branch_id,original_sale_id,status,
         reason,refund_method,currency_code,refund_total_minor,client_mutation_id)
         VALUES($1,$2,$3,'COMPLETED','QA','MOMO',$4,800,$5) RETURNING id`,
        [businessId,branch,sale,refundCurrency,`return-${key}`])).rows[0]!.id;
      const refund = (await pool.query<{id:string}>(
        `INSERT INTO refund_transactions(business_id,return_case_id,original_payment_id,
          amount_minor,currency_code,method,status,idempotency_key)
         VALUES($1,$2,$3,800,$4,'MOMO','PENDING',$5) RETURNING id`,
        [businessId,ret,payment,refundCurrency,key])).rows[0]!.id;
      return {refund,payment};
    }
    const first = await seed("main",branchId,true);
    const unlinked = await seed("missing",branchId,false);
    const mixed = await seed("mixed",branchId,true,"USD");
    const foreignBranch = await seed("other",otherBranchId,true);
    const url = (refund:string,branch = branchId) =>
      `/v1/refunds/reconciliation-preflight?businessId=${businessId}&branchId=${branch}&refundId=${refund}`;
    const found = await app.inject({method:"GET",headers:owner.headers,url:url(first.refund)});
    expect(found.statusCode).toBe(200);
    expect(found.headers["cache-control"]).toContain("no-store");
    expect(found.json()).toMatchObject({
      refundId:first.refund, expected:{amountMinor:800,currencyCode:"GHS"},
      originalPayment:{linked:true,amountMinor:1500,currencyCode:"GHS"},
      checks:{amountWithinOriginalPayment:true,currencyMatchesOriginalPayment:true,
        refundDestinationProviderVerified:false,refundSpecificSettlementVerified:false},
      canMarkPaid:false, paymentStatusUnchanged:true,
    });
    expect(found.json().blockers).toContain("REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED");
    const noLink = await app.inject({method:"GET",headers:owner.headers,url:url(unlinked.refund)});
    expect(noLink.json().blockers).toContain("ORIGINAL_PAYMENT_NOT_LINKED");
    const wrongCurrency = await app.inject({method:"GET",headers:owner.headers,url:url(mixed.refund)});
    expect(wrongCurrency.json().blockers).toContain("ORIGINAL_PAYMENT_CURRENCY_MISMATCH");
    expect((await app.inject({method:"GET",headers:owner.headers,
      url:url(foreignBranch.refund)})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",headers:cashier.headers,
      url:url(first.refund)})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",headers:outsider.headers,
      url:url(first.refund)})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:url(first.refund)})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",headers:owner.headers,
      url:url(first.refund).replace(branchId,otherBranchId)})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",headers:owner.headers,
      url:"/v1/refunds/reconciliation-preflight",
      payload:{businessId,branchId,refundId:first.refund,status:"SUCCEEDED"}})).statusCode).toBe(404);
    const financial = (await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [first.refund])).rows[0];
    expect(financial).toEqual({status:"PENDING",amount_minor:"800"});
  });
});
