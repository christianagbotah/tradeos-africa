import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("all-time, branch-scoped refund status summary", () => {
  it("counts payouts beyond recent 50 sales without leaking another branch or mixing currencies", async () => {
    const registration = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: {
        displayName: "Refund Reviewer", email: "refund-summary@tradeos.test",
        password: "TradeOS-Refund-QA-1234", platform: "WEB",
        deviceKey: "refund-branch-test", appVersion: "test",
      },
    });
    expect(registration.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };
    const onboarding = await app.inject({
      method: "POST", url: "/v1/onboarding/business", headers,
      payload: { name: "Branch Refund Shop", businessType: "RETAIL_HARDWARE", branchName: "Main" },
    });
    expect(onboarding.statusCode).toBe(201);
    const businessId: string = onboarding.json().business.id;
    const branchId: string = onboarding.json().branch.id;
    const otherBranchId: string = (await pool.query<{ id: string }>(
      `INSERT INTO branches(business_id,name,code) VALUES($1,'Secondary','SECOND')
        RETURNING id`, [businessId],
    )).rows[0]!.id;

    async function sale(key: string, branch: string, currency = "GHS", date = "2026-11-19T20:00:00Z") {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,
          subtotal_net_minor,total_minor,client_mutation_id,completed_at)
          VALUES($1,$2,'COMPLETED',$3,5000,5000,$4,$5) RETURNING id`,
        [businessId, branch, currency, key, date],
      );
      return result.rows[0]!.id;
    }
    async function caseFor(saleId: string, key: string, branch: string, currency = "GHS") {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO return_cases(business_id,branch_id,original_sale_id,status,
          reason,refund_method,currency_code,refund_total_minor,client_mutation_id)
          VALUES($1,$2,$3,'COMPLETED','Test return','CASH',$4,15000,$5) RETURNING id`,
        [businessId, branch, saleId, currency, key],
      );
      return result.rows[0]!.id;
    }
    async function refund(returnCaseId: string, key: string,
      amount: number, status: string, currency = "GHS") {
      await pool.query(
        `INSERT INTO refund_transactions(business_id,return_case_id,amount_minor,
          currency_code,method,status,idempotency_key)
          VALUES($1,$2,$3,$4,'CASH',$5,$6)`,
        [businessId, returnCaseId, amount, currency, status, key],
      );
    }

    const oldSaleId = await sale("older-refund-sale", branchId, "GHS", "2025-01-01T00:00:00Z");
    const oldCaseId = await caseFor(oldSaleId, "old-return", branchId);
    await refund(oldCaseId, "pending-old", 1200, "PENDING");
    await refund(oldCaseId, "settled-old", 400, "SUCCEEDED");
    await refund(oldCaseId, "failed-old", 250, "FAILED");
    for (let i = 0; i < 52; i++) await sale(`newer-${i}`, branchId);
    const recent = await app.inject({
      method: "GET", headers,
      url: `/v1/sales?businessId=${businessId}&branchId=${branchId}&limit=50`,
    });
    expect(recent.statusCode).toBe(200);
    expect(recent.json().sales).toHaveLength(50);
    expect(recent.json().sales.some((entry: { id: string }) => entry.id === oldSaleId)).toBe(false);

    const recentSaleId = await sale("current-refund-sale", branchId);
    await refund(await caseFor(recentSaleId, "current-return", branchId), "pending-current", 700, "PENDING");
    const anotherBranchSale = await sale("secondary-sale", otherBranchId);
    await refund(await caseFor(anotherBranchSale, "secondary-return", otherBranchId), "pending-elsewhere", 2100, "PENDING");
    const usdSale = await sale("usd-sale", branchId, "USD");
    await refund(await caseFor(usdSale, "usd-return", branchId, "USD"), "usd-failed", 10000, "FAILED", "USD");

    const response = await app.inject({
      method: "GET", headers,
      url: `/v1/refunds/branch-summary?businessId=${businessId}&branchId=${branchId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json()).toMatchObject({
      scope: "BRANCH_ALL_TIME",
      balances: [
        { currencyCode: "GHS", pendingCount: 2, pendingMinor: 1900,
          settledCount: 1, settledMinor: 400, failedCount: 1, failedMinor: 250 },
        { currencyCode: "USD", pendingCount: 0, pendingMinor: 0,
          settledCount: 0, settledMinor: 0, failedCount: 1, failedMinor: 10000 },
      ],
    });
    const unauthorized = await app.inject({
      method: "GET",
      url: `/v1/refunds/branch-summary?businessId=${businessId}&branchId=${branchId}`,
    });
    expect(unauthorized.statusCode).toBe(401);
  });
});
