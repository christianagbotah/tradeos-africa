import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool, withTransaction } from "../src/db.js";
import { applyCashbookMutation, recordCashbookEntry } from "../src/commerce/cashbook.js";

// This suite truncates fixtures: use only a disposable local/CI PostgreSQL database.
process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function fixture() {
  const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { displayName: "Cashbook Owner", email: "cashbook@tradeos.test", password: "TradeOS-Test-1234", platform: "WEB", deviceKey: "cashbook-device", appVersion: "test" } });
  expect(registration.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };
  const onboard = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers, payload: { name: "Cashbook Shop", businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(onboard.statusCode).toBe(201);
  const businessId = onboard.json().business.id, branchId = onboard.json().branch.id;
  const actor = (await pool.query(`SELECT staff_id FROM business_memberships WHERE business_id=$1`, [businessId])).rows[0].staff_id;
  const categories = await app.inject({ method: "GET", url: `/v1/expense-categories?businessId=${businessId}`, headers });
  expect(categories.statusCode).toBe(200);
  expect(categories.json().categories).toHaveLength(11);
  const categoryId = categories.json().categories[0].id;
  const request = (key: string, type: string, payload: unknown, branch = branchId) => app.inject({ method: "POST", url: "/v1/sync", headers, payload: { mutations: [{ clientId: "cashbook-device", clientMutationId: key, businessId, branchId: branch, mutationType: type, occurredAt: "2026-01-01T12:00:00Z", payload }] } });
  const sync = async (key: string, type: string, payload: unknown, branch = branchId) => {
    const response = await request(key, type, payload, branch);
    expect(response.statusCode).toBe(200);
    return response.json().mutationResults[0];
  };
  const expense = { categoryId, amountMinor: 250, method: "CASH" as const, description: "Transport", actorStaffId: randomUUID() };
  return { businessId, branchId, actor, headers, categoryId, sync, request, expense };
}

describe("unified cashbook and expenses", () => {
  it("posts once with authoritative actors, validates money and tenant references, and rolls back all financial effects", async () => {
    const f = await fixture();
    expect((await f.sync("expense", "EXPENSE_CREATE", f.expense)).status).toBe("APPLIED");
    expect((await f.sync("expense", "EXPENSE_CREATE", f.expense)).status).toBe("APPLIED");
    const context = { businessId: f.businessId, branchId: f.branchId, clientMutationId: "expense", occurredAt: "2026-01-01T12:00:00Z" };
    expect((await applyCashbookMutation(pool, context, { ...f.expense, actorStaffId: f.actor }, false)).idempotentReplay).toBe(true);
    expect((await pool.query(`SELECT actor_staff_id,amount_minor FROM expenses`)).rows).toEqual([{ actor_staff_id: f.actor, amount_minor: "250" }]);
    expect((await pool.query(`SELECT actor_staff_id,amount_delta_minor FROM cashbook_entries`)).rows).toEqual([{ actor_staff_id: f.actor, amount_delta_minor: "-250" }]);
    for (const [index, patch] of [{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.5 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { method: "CUSTOMER_CREDIT" }, { categoryId: randomUUID() }, { currencyCode: "USD" }, { description: {}, payee: "" }].entries()) {
      expect((await f.sync(`invalid-${index}`, "EXPENSE_CREATE", { ...f.expense, ...patch })).status).toBe("REJECTED");
    }
    expect((await f.sync("bad-branch", "EXPENSE_CREATE", f.expense, randomUUID())).status).toBe("REJECTED");
    await pool.query(`UPDATE expense_categories SET is_active=false WHERE id=$1`, [f.categoryId]);
    expect((await f.sync("inactive", "EXPENSE_CREATE", f.expense)).status).toBe("REJECTED");
    await pool.query(`UPDATE expense_categories SET is_active=true WHERE id=$1`, [f.categoryId]);
    // Force a failure after expense and ledger insertion to prove transaction rollback.
    await pool.query(`CREATE FUNCTION test_reject_cashbook_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='EXPENSE_CREATED' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER test_cashbook_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_reject_cashbook_audit()`);
    try { expect((await f.sync("rollback", "EXPENSE_CREATE", f.expense)).status).toBe("REJECTED"); }
    finally { await pool.query(`DROP TRIGGER test_cashbook_audit ON audit_events`); await pool.query(`DROP FUNCTION test_reject_cashbook_audit()`); }
    expect(Number((await pool.query(`SELECT COUNT(*) FROM expenses`)).rows[0].count)).toBe(1);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM cashbook_entries`)).rows[0].count)).toBe(1);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM outbox_events WHERE event_type='EXPENSE_CREATED'`)).rows[0].count)).toBe(1);
    const entry = (await pool.query(`SELECT * FROM cashbook_entries`)).rows[0];
    const movement = { businessId: f.businessId, branchId: f.branchId, currencyCode: "GHS", method: "CASH" as const, amountDeltaMinor: -250, entryType: "EXPENSE" as const, sourceType: "EXPENSE", sourceId: entry.source_id, actorStaffId: entry.actor_staff_id, idempotencyKey: entry.idempotency_key, occurredAt: context.occurredAt };
    await withTransaction(pool, c => recordCashbookEntry(c, movement));
    await expect(withTransaction(pool, c => recordCashbookEntry(c, { ...movement, amountDeltaMinor: -251 }))).rejects.toThrow("conflicts");
    const otherBusiness = (await pool.query(`INSERT INTO businesses(name,business_type) VALUES ('Other','RETAIL_HARDWARE') RETURNING id`)).rows[0].id;
    const otherCategory = (await pool.query(`SELECT id FROM expense_categories WHERE business_id=$1 LIMIT 1`, [otherBusiness])).rows[0].id;
    expect((await f.sync("foreign-category", "EXPENSE_CREATE", { ...f.expense, categoryId: otherCategory })).status).toBe("REJECTED");
  });

  it("gates roles and category routes, records signed adjustments, and filters totals independently of page size", async () => {
    const f = await fixture();
    const adjustment = { amountDeltaMinor: 1000, reason: "OPENING_BALANCE", note: "Starting cash", method: "CASH", actorStaffId: randomUUID() };
    for (const [index, patch] of [{ amountDeltaMinor: -1 }, { reason: "OWNER_WITHDRAWAL" }, { reason: "CORRECTION", note: "" }, { reason: "UNKNOWN" }, { method: "SUPPLIER_CREDIT" }].entries()) expect((await f.sync(`invalid-adjust-${index}`, "CASHBOOK_ADJUSTMENT_CREATE", { ...adjustment, ...patch })).status).toBe("REJECTED");
    for (const role of ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]) {
      await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1`, [f.businessId, role]);
      expect((await f.sync(`adjust-${role}`, "CASHBOOK_ADJUSTMENT_CREATE", adjustment)).status).toBe("APPLIED");
    }
    expect((await f.sync("withdrawal", "CASHBOOK_ADJUSTMENT_CREATE", { ...adjustment, reason: "OWNER_WITHDRAWAL", amountDeltaMinor: -500 })).status).toBe("APPLIED");
    expect((await f.sync("correction", "CASHBOOK_ADJUSTMENT_CREATE", { ...adjustment, reason: "CORRECTION", amountDeltaMinor: -100 })).status).toBe("APPLIED");
    expect((await f.sync("injection", "CASHBOOK_ADJUSTMENT_CREATE", { ...adjustment, reason: "OWNER_INJECTION", amountDeltaMinor: 200, method: "BANK" })).status).toBe("APPLIED");
    const url = `/v1/cashbook?businessId=${f.businessId}&branchId=${f.branchId}`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/cashbook?businessId=${randomUUID()}&branchId=${f.branchId}`, headers: f.headers })).statusCode).toBe(403);
    const filtered = await app.inject({ method: "GET", url: `${url}&method=CASH&limit=1&from=2026-01-01&to=2026-01-02`, headers: f.headers });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().entries).toHaveLength(1);
    expect(filtered.json().totals).toEqual([{ method: "CASH", currencyCode: "GHS", balanceMinor: 3400, inflowMinor: 4000, outflowMinor: 600 }]);
    expect((await app.inject({ method: "GET", url: `${url}&from=2027-01-01`, headers: f.headers })).json().entries).toEqual([]);
    for (const suffix of ["&method=CREDIT_NOTE", "&from=garbage", "&limit=0", "&from=2027-01-01&to=2026-01-01"]) expect((await app.inject({ method: "GET", url: url + suffix, headers: f.headers })).statusCode).toBe(400);
    const category = await app.inject({ method: "POST", url: "/v1/expense-categories", headers: f.headers, payload: { businessId: f.businessId, name: "Insurance" } });
    expect(category.statusCode).toBe(201);
    expect((await app.inject({ method: "PATCH", url: `/v1/expense-categories/${category.json().category.id}`, headers: f.headers, payload: { businessId: f.businessId, active: false } })).json().category.active).toBe(false);
    await pool.query(`UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1`, [f.businessId]);
    expect((await f.sync("cashier-expense", "EXPENSE_CREATE", f.expense)).status).toBe("APPLIED");
    expect((await f.request("cashier-adjust", "CASHBOOK_ADJUSTMENT_CREATE", adjustment)).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/expense-categories", headers: f.headers, payload: { businessId: f.businessId, name: "Denied" } })).statusCode).toBe(403);
    for (const role of ["SALES", "INVENTORY", "STAFF", "VIEWER"]) {
      await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1`, [f.businessId, role]);
      expect((await f.request(`expense-${role}`, "EXPENSE_CREATE", f.expense)).statusCode).toBe(403);
      expect((await f.request(`adjust-${role}`, "CASHBOOK_ADJUSTMENT_CREATE", adjustment)).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url, headers: f.headers })).statusCode).toBe(200);
    expect((await pool.query(`SELECT DISTINCT actor_staff_id FROM cashbook_entries`)).rows).toEqual([{ actor_staff_id: f.actor }]);
  });

});
