import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("refund settlement queue currency isolation", () => {
  it("keeps currency totals separate across filtered and paginated worklist results", async () => {
    const reg = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { displayName: "QA Reviewer", email: "refund-queue@tradeos.test",
        password: "QA-Refund-Testing-2026!", platform: "WEB",
        deviceKey: "refund-settlement-currency-test", appVersion: "test" },
    });
    expect(reg.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${reg.json().session.accessToken}` };
    const onboard = await app.inject({
      method: "POST", url: "/v1/onboarding/business", headers,
      payload: { name: "Multiple Currencies", businessType: "RETAIL_HARDWARE",
        branchName: "Main" },
    });
    expect(onboard.statusCode).toBe(201);
    const businessId: string = onboard.json().business.id;
    const branchId: string = onboard.json().branch.id;
    const otherBranchId = (await pool.query<{ id: string }>(
      `INSERT INTO branches(business_id,name,code) VALUES($1,'Other','OTHER') RETURNING id`,
      [businessId],
    )).rows[0]!.id;

    async function seed(key: string, branch: string, currency: string,
      status: string, amount: number, ageHours = 0) {
      const sale = await pool.query<{ id: string }>(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,
          subtotal_net_minor,total_minor,client_mutation_id)
         VALUES($1,$2,'COMPLETED',$3,20000,20000,$4) RETURNING id`,
        [businessId, branch, currency, `sale-${key}`],
      );
      const returned = await pool.query<{ id: string }>(
        `INSERT INTO return_cases(business_id,branch_id,original_sale_id,status,
          reason,refund_method,currency_code,refund_total_minor,client_mutation_id)
         VALUES($1,$2,$3,'COMPLETED','Test','CASH',$4,$5,$6) RETURNING id`,
        [businessId, branch, sale.rows[0]!.id, currency, amount, `return-${key}`],
      );
      await pool.query(
        `INSERT INTO refund_transactions(business_id,return_case_id,amount_minor,
          currency_code,method,status,idempotency_key,created_at)
         VALUES($1,$2,$3,$4,'CASH',$5,$6,NOW() - ($7::int * INTERVAL '1 hour'))`,
        [businessId, returned.rows[0]!.id, amount, currency, status, key, ageHours],
      );
    }

    await seed("p-gh", branchId, "GHS", "PENDING", 1200, 8 * 24);
    await seed("f-gh", branchId, "GHS", "FAILED", 400, 10 * 24);
    await seed("p-us", branchId, "USD", "PENDING", 2500, 30);
    await seed("s-gh", branchId, "GHS", "SUCCEEDED", 700);
    await seed("other", otherBranchId, "GHS", "PENDING", 9000, 20 * 24);

    const result = await app.inject({
      method: "GET", headers,
      url: `/v1/refunds/settlement-queue?businessId=${businessId}&branchId=${branchId}&status=PENDING&limit=1`,
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.json()).toMatchObject({
      summaryByCurrency: [
        { currencyCode: "GHS", pendingCount: 1, pendingMinor: 1200,
          failedCount: 1, failedMinor: 400,
          pending24hCount: 1, pending24hMinor: 1200,
          pending7dCount: 1, pending7dMinor: 1200 },
        { currencyCode: "USD", pendingCount: 1, pendingMinor: 2500,
          failedCount: 0, failedMinor: 0,
          pending24hCount: 1, pending24hMinor: 2500,
          pending7dCount: 0, pending7dMinor: 0 },
      ],
      hasMore: true,
    });
    expect(result.json().items).toHaveLength(1);
    expect(result.json()).not.toHaveProperty("summary");
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/v1/refunds/settlement-queue?businessId=${businessId}&branchId=${branchId}`,
    });
    expect(unauthenticated.statusCode).toBe(401);
  });
});
