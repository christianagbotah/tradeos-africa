import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
let cashSequence = 0;

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); cashSequence = 0; });
afterAll(async () => { await app.close(); await pool.end(); });

type Tenant = { token: string; userId: string; businessId: string; branchId: string };

describe("deterministic business attention", () => {
  it("creates evidence-backed low-data attention once and updates it on reevaluation", async () => {
    const tenant = await createTenant("attention-owner@tradeos.test", "Attention Shop");
    const headers = authHeaders(tenant.token);

    const first = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "manual:first" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        ruleCode: "LOW_DATA_CONFIDENCE",
        state: "OPEN",
      }),
    ]));

    const lowData = first.json().items.find((item: { ruleCode: string }) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowData.sourceKey).toBe(`low-data:${tenant.branchId}`);
    expect(lowData.evidence.length).toBeGreaterThan(0);

    const second = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "manual:second" },
    });
    expect(second.statusCode).toBe(200);
    const lowDataAgain = second.json().items.find((item: { ruleCode: string }) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowDataAgain.id).toBe(lowData.id);

    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM business_attention_items
       WHERE business_id=$1 AND branch_id=$2 AND rule_code='LOW_DATA_CONFIDENCE' AND state='OPEN'`,
      [tenant.businessId, tenant.branchId],
    );
    expect(count.rows[0]?.count).toBe("1");

    const listed = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.some((item: { id: string }) => item.id === lowData.id)).toBe(true);
  });

  it("raises CRITICAL cash pressure from the canonical forecast and resolves it when cash recovers", async () => {
    const tenant = await createTenant("attention-cash-critical@tradeos.test", "Cash Critical");
    const headers = authHeaders(tenant.token);
    await insertCash(tenant.businessId, tenant.branchId, -500, "OWNER_WITHDRAWAL");

    const first = await app.inject({
      method: "POST", url: "/v1/intelligence/attention/evaluate", headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "cash:critical" },
    });
    expect(first.statusCode).toBe(200);
    const pressure = first.json().items.find((item: { ruleCode: string }) => item.ruleCode === "CASH_PRESSURE_FORECAST");
    expect(pressure).toMatchObject({ severity: "CRITICAL", state: "OPEN", sourceKey: `cash-pressure:${tenant.branchId}` });
    expect(pressure.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "openingCashMinor", value: -500, metadata: { kind: "money_minor", currencyCode: "GHS" } }),
      expect.objectContaining({ label: "firstNegativeCashDate" }),
      expect.objectContaining({ label: "confidenceLevel", value: "LOW" }),
      expect.objectContaining({ label: "historyDaysAvailable", value: 0 }),
    ]));

    await insertCash(tenant.businessId, tenant.branchId, 1000, "OWNER_INJECTION");
    const recovered = await app.inject({
      method: "POST", url: "/v1/intelligence/attention/evaluate", headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "cash:recovered" },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().items.some((item: { ruleCode: string }) => item.ruleCode === "CASH_PRESSURE_FORECAST")).toBe(false);
    const resolved = await pool.query<{ state: string }>(
      `SELECT state FROM business_attention_items WHERE business_id=$1 AND branch_id=$2 AND rule_code='CASH_PRESSURE_FORECAST' ORDER BY updated_at DESC LIMIT 1`,
      [tenant.businessId, tenant.branchId],
    );
    expect(resolved.rows[0]?.state).toBe("RESOLVED");
  });

  it("raises HIGH cash pressure when a future supplier obligation turns cash negative after day three", async () => {
    const tenant = await createTenant("attention-cash-high@tradeos.test", "Cash High");
    await insertCash(tenant.businessId, tenant.branchId, 1000, "OWNER_INJECTION");
    await insertFutureSupplierObligation(tenant, 2000, 5);

    const response = await app.inject({
      method: "POST", url: "/v1/intelligence/attention/evaluate", headers: authHeaders(tenant.token),
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "cash:future" },
    });
    expect(response.statusCode).toBe(200);
    const pressure = response.json().items.find((item: { ruleCode: string }) => item.ruleCode === "CASH_PRESSURE_FORECAST");
    expect(pressure).toMatchObject({ severity: "HIGH", state: "OPEN" });
    expect(pressure.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "lowestProjectedCashMinor", value: -1000 }),
      expect.objectContaining({ label: "totalContractualOutflowsMinor", value: 2000 }),
    ]));
  });

  it("keeps cash pressure branch-scoped", async () => {
    const tenant = await createTenant("attention-cash-branch@tradeos.test", "Cash Branch");
    const second = await pool.query<{ id: string }>(
      `INSERT INTO branches(business_id,name,code,timezone,is_active) VALUES($1,'Second','SECOND','Africa/Accra',true) RETURNING id`,
      [tenant.businessId],
    );
    const secondBranchId = second.rows[0]!.id;
    await insertCash(tenant.businessId, secondBranchId, -700, "OWNER_WITHDRAWAL");

    const main = await app.inject({
      method: "POST", url: "/v1/intelligence/attention/evaluate", headers: authHeaders(tenant.token),
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "cash:main" },
    });
    expect(main.statusCode).toBe(200);
    expect(main.json().items.some((item: { ruleCode: string }) => item.ruleCode === "CASH_PRESSURE_FORECAST")).toBe(false);

    const secondResponse = await app.inject({
      method: "POST", url: "/v1/intelligence/attention/evaluate", headers: authHeaders(tenant.token),
      payload: { businessId: tenant.businessId, branchId: secondBranchId, correlationId: "cash:second" },
    });
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CASH_PRESSURE_FORECAST", branchId: secondBranchId, severity: "CRITICAL" }),
    ]));
  });

  it("rejects forged tenant scopes before returning or evaluating attention", async () => {
    const tenantA = await createTenant("attention-a@tradeos.test", "Tenant A");
    const tenantB = await createTenant("attention-b@tradeos.test", "Tenant B");
    const headersA = authHeaders(tenantA.token);

    const readOther = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenantB.businessId}&branchId=${tenantB.branchId}`,
      headers: headersA,
    });
    expect(readOther.statusCode).toBe(403);
    expect(readOther.json().error).toBe("BUSINESS_ACCESS_DENIED");

    const evaluateOther = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers: headersA,
      payload: { businessId: tenantB.businessId, branchId: tenantB.branchId, correlationId: "forged" },
    });
    expect(evaluateOther.statusCode).toBe(403);
    expect(evaluateOther.json().error).toBe("BUSINESS_ACCESS_DENIED");
  });

  it("allows operational attention reads for STAFF but hides financial rules and blocks manual evaluation", async () => {
    const tenant = await createTenant("attention-staff@tradeos.test", "Staff Shop");
    const headers = authHeaders(tenant.token);

    await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "owner-seed" },
    });

    await pool.query(
      `INSERT INTO business_attention_items(
         business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES
         ($1,$2,'receivables:overdue','RECEIVABLES_OVERDUE','HIGH','OPEN','Overdue receivables','Customers owe overdue balances','[]'),
         ($1,$2,'stockout:item-demo','STOCKOUT_RISK','HIGH','OPEN','Stockout risk','Demo stock risk','[]')`,
      [tenant.businessId, tenant.branchId],
    );

    await pool.query(
      `UPDATE business_memberships
       SET role='STAFF'
       WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
      [tenant.businessId, tenant.userId],
    );

    const list = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    const ruleCodes = list.json().items.map((item: { ruleCode: string }) => item.ruleCode);
    expect(ruleCodes).toContain("STOCKOUT_RISK");
    expect(ruleCodes).toContain("LOW_DATA_CONFIDENCE");
    expect(ruleCodes).not.toContain("RECEIVABLES_OVERDUE");
    expect(ruleCodes).not.toContain("PAYABLES_OVERDUE");
    expect(ruleCodes).not.toContain("CASH_PRESSURE_FORECAST");
    expect(ruleCodes).not.toContain("MARGIN_PRESSURE");

    const evaluate = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "staff-forbidden" },
    });
    expect(evaluate.statusCode).toBe(403);
    expect(evaluate.json().error).toBe("ROLE_FORBIDDEN");
  });
});

async function createTenant(email: string, name: string): Promise<Tenant> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: name,
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `device-${email}`,
      appVersion: "test",
    },
  });
  expect(registration.statusCode).toBe(201);
  const body = registration.json();
  const token = body.session.accessToken as string;
  const userId = body.user.id as string;

  const onboard = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: authHeaders(token),
    payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(onboard.statusCode).toBe(201);
  return {
    token,
    userId,
    businessId: onboard.json().business.id,
    branchId: onboard.json().branch.id,
  };
}


async function insertCash(businessId: string, branchId: string, amountMinor: number, entryType: "OWNER_INJECTION" | "OWNER_WITHDRAWAL") {
  cashSequence += 1;
  const account = await pool.query<{ id: string }>(
    `SELECT id FROM money_accounts WHERE business_id=$1 AND branch_id=$2 AND method='CASH' AND active=true ORDER BY created_at,id LIMIT 1`,
    [businessId, branchId],
  );
  expect(account.rows[0]?.id).toBeTruthy();
  await pool.query(
    `INSERT INTO cashbook_entries(
       business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,idempotency_key,occurred_at,money_account_id
     ) VALUES($1,$2,$3,'GHS','CASH',$4,'ATTENTION_TEST',gen_random_uuid(),$5,now()-interval '1 day',$6)`,
    [businessId, branchId, amountMinor, entryType, `attention-cash-${cashSequence}`, account.rows[0]!.id],
  );
}

async function insertFutureSupplierObligation(tenant: Tenant, amountMinor: number, dueInDays: number) {
  const access = await pool.query<{ staff_id: string }>(
    `SELECT staff_id FROM business_memberships WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
    [tenant.businessId, tenant.userId],
  );
  const supplier = await pool.query<{ id: string }>(
    `INSERT INTO suppliers(business_id,name,payment_terms_days,is_active) VALUES($1,'Cash Forecast Supplier',$2,true) RETURNING id`,
    [tenant.businessId, dueInDays],
  );
  const purchase = await pool.query<{ id: string }>(
    `INSERT INTO purchases(
       business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,settlement_method,total_minor,client_mutation_id,received_at
     ) VALUES($1,$2,$3,$4,'RECEIVED','GHS','SUPPLIER_CREDIT',$5,gen_random_uuid()::text,now()) RETURNING id`,
    [tenant.businessId, tenant.branchId, supplier.rows[0]!.id, access.rows[0]!.staff_id, amountMinor],
  );
  await pool.query(
    `INSERT INTO supplier_credit_obligations(
       business_id,branch_id,supplier_id,purchase_id,currency_code,original_minor,open_minor,issued_at,due_at
     ) VALUES($1,$2,$3,$4,'GHS',$5,$5,now(),now()+make_interval(days=>$6))`,
    [tenant.businessId, tenant.branchId, supplier.rows[0]!.id, purchase.rows[0]!.id, amountMinor, dueInDays],
  );
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
