import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import { createBusinessEntityActionItem, BusinessEntityActionError } from "../src/business-intelligence/entity-action-service.js";
import { listBusinessActionItems } from "../src/business-intelligence/automation-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `entity_action_test_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const B1 = "83000000-0000-4000-8000-000000000001";
const B2 = "84000000-0000-4000-8000-000000000001";
const BR1 = "83000000-0000-4000-8000-000000000002";
const BR1B = "83000000-0000-4000-8000-000000000003";
const BR2 = "84000000-0000-4000-8000-000000000002";
const OWNER = "83000000-0000-4000-8000-000000000010";
const OWNER_STAFF = "83000000-0000-4000-8000-000000000011";
const VIEWER = "83000000-0000-4000-8000-000000000012";
const VIEWER_STAFF = "83000000-0000-4000-8000-000000000013";
const ACCOUNTANT = "83000000-0000-4000-8000-000000000014";
const ACCOUNTANT_STAFF = "83000000-0000-4000-8000-000000000015";
const ITEM1 = "83000000-0000-4000-8000-000000000020";
const CUSTOMER1 = "83000000-0000-4000-8000-000000000030";
const SUPPLIER1 = "83000000-0000-4000-8000-000000000040";
const PURCHASE1 = "83000000-0000-4000-8000-000000000050";
const FOREIGN_CUSTOMER = "84000000-0000-4000-8000-000000000030";
const NOW = new Date("2026-10-23T14:00:00.000Z");

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses,app_users CASCADE");
  await seedFixture();
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("entity intelligence safe action creation", () => {
  it("creates an evidence-backed reorder task with entity provenance, creator audit, self assignment, and due time", async () => {
    const result = await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "CATALOG_ITEM", entityId: ITEM1, now: NOW,
    });

    expect(result.created).toBe(true);
    expect(result.item).toMatchObject({
      businessId: B1,
      branchId: BR1,
      sourceEntityType: "CATALOG_ITEM",
      sourceEntityId: ITEM1,
      createdByUserId: OWNER,
      actionType: "CREATE_REORDER_REVIEW",
      assignedUserId: OWNER,
      assignedStaffId: OWNER_STAFF,
      status: "OPEN",
    });
    expect(result.item.sourceAttentionItemId).toBeTruthy();
    expect(result.item.dueAt).toBe("2026-10-24T14:00:00.000Z");
    expect(result.item.evidence.some((item) => item.entityType === "CATALOG_ITEM" && item.entityId === ITEM1)).toBe(true);
    expect(result.item.title).toContain("Widget");
  });

  it("is idempotent for active tasks, including concurrent requests, and permits a new task after completion", async () => {
    const input = { businessId: B1, branchId: BR1, entityType: "CUSTOMER" as const, entityId: CUSTOMER1, now: NOW };
    const [a, b] = await Promise.all([
      createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, input),
      createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, input),
    ]);
    expect(new Set([a.item.id, b.item.id]).size).toBe(1);
    expect([a.created, b.created].sort()).toEqual([false, true]);

    await pool.query(`UPDATE business_action_items SET status='DONE',completed_at=now() WHERE id=$1`, [a.item.id]);
    const reopened = await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, input);
    expect(reopened.created).toBe(true);
    expect(reopened.item.id).not.toBe(a.item.id);
  });

  it("denies roles without a server-owned safe action and rejects inactive membership", async () => {
    await expect(createBusinessEntityActionItem(pool, { userId: VIEWER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "CUSTOMER", entityId: CUSTOMER1, now: NOW,
    })).rejects.toMatchObject<Partial<BusinessEntityActionError>>({ statusCode: 403, code: "ENTITY_ACTION_FORBIDDEN" });

    await pool.query(`UPDATE business_memberships SET status='SUSPENDED' WHERE business_id=$1 AND user_id=$2`, [B1, OWNER]);
    await expect(createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "SUPPLIER", entityId: SUPPLIER1, now: NOW,
    })).rejects.toMatchObject<Partial<BusinessEntityActionError>>({ statusCode: 403, code: "ENTITY_ACTION_FORBIDDEN" });
  });

  it("preserves safe not-found semantics for foreign entities and wrong purchase branches", async () => {
    await expect(createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "CUSTOMER", entityId: FOREIGN_CUSTOMER, now: NOW,
    })).rejects.toMatchObject({ statusCode: 404, code: "ENTITY_NOT_FOUND" });

    await expect(createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1B, entityType: "PURCHASE", entityId: PURCHASE1, now: NOW,
    })).rejects.toMatchObject({ statusCode: 404, code: "ENTITY_NOT_FOUND" });
  });

  it("keeps lower-role action queues scoped to their assignments so financial evidence cannot leak", async () => {
    const ownerTask = await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "CUSTOMER", entityId: CUSTOMER1, now: NOW,
    });
    expect(ownerTask.item.evidence.some((item) => item.label === "creditLimitMinor")).toBe(true);

    const accountantItems = await listBusinessActionItems(pool, {
      userId: ACCOUNTANT, businessId: B1, role: "ACCOUNTANT", staffId: ACCOUNTANT_STAFF,
    }, BR1);
    expect(accountantItems.some((item) => item.id === ownerTask.item.id)).toBe(true);

    const viewerActor = { userId: VIEWER, businessId: B1, role: "VIEWER" as const, staffId: VIEWER_STAFF };
    const viewerBefore = await listBusinessActionItems(pool, viewerActor, BR1);
    expect(viewerBefore).toEqual([]);

    await pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,action_type,title,reason,evidence,assigned_user_id,assigned_staff_id,status
       ) VALUES($1,$2,'CREATE_FOLLOW_UP','Viewer task','Safe internal review','[]',$3,$4,'OPEN')`,
      [B1, BR1, VIEWER, VIEWER_STAFF],
    );
    const viewerAfter = await listBusinessActionItems(pool, viewerActor, BR1);
    expect(viewerAfter).toHaveLength(1);
    expect(viewerAfter[0]?.assignedUserId).toBe(VIEWER);
    expect(viewerAfter.some((item) => item.id === ownerTask.item.id)).toBe(false);

    const ownerItems = await listBusinessActionItems(pool, {
      userId: OWNER, businessId: B1, role: "OWNER", staffId: OWNER_STAFF,
    }, BR1);
    expect(ownerItems.some((item) => item.id === ownerTask.item.id)).toBe(true);
  });

  it("reapplies current entity permissions and financial evidence filtering after a creator role is downgraded", async () => {
    const supplierTask = await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "SUPPLIER", entityId: SUPPLIER1, now: NOW,
    });
    const customerTask = await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "CUSTOMER", entityId: CUSTOMER1, now: NOW,
    });
    expect(supplierTask.item.evidence.some((item) => item.label === "recentPurchaseTotalMinor30d")).toBe(true);
    expect(customerTask.item.evidence.some((item) => item.label === "creditLimitMinor")).toBe(true);

    await pool.query(`UPDATE business_memberships SET role='INVENTORY' WHERE business_id=$1 AND user_id=$2`, [B1, OWNER]);
    const inventoryQueue = await listBusinessActionItems(pool, {
      userId: OWNER, businessId: B1, role: "INVENTORY", staffId: OWNER_STAFF,
    }, BR1);

    const visibleSupplier = inventoryQueue.find((item) => item.id === supplierTask.item.id);
    expect(visibleSupplier).toBeTruthy();
    expect(visibleSupplier?.evidence.some((item) => item.label === "recentPurchaseTotalMinor30d")).toBe(false);
    expect(inventoryQueue.some((item) => item.id === customerTask.item.id)).toBe(false);
  });

  it("creates only an internal action item and leaves economic/access ledgers unchanged", async () => {
    const before = await invariantCounts();
    await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "SUPPLIER", entityId: SUPPLIER1, now: NOW,
    });
    const after = await invariantCounts();
    expect(after).toEqual(before);
    const actions = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM business_action_items WHERE business_id=$1`, [B1]);
    expect(actions.rows[0]?.count).toBe(1);
  });
});

async function invariantCounts() {
  const result = await pool.query<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM sales) AS sales,
    (SELECT count(*)::int FROM payments) AS payments,
    (SELECT count(*)::int FROM return_cases) AS returns,
    (SELECT count(*)::int FROM purchases) AS purchases,
    (SELECT count(*)::int FROM inventory_movements) AS inventory,
    (SELECT count(*)::int FROM cashbook_entries) AS cashbook,
    (SELECT count(*)::int FROM business_memberships) AS memberships,
    (SELECT count(*)::int FROM staff) AS staff`);
  return result.rows[0]!;
}

async function seedFixture() {
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES
    ($1,'Entity Actions','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),
    ($2,'Foreign Tenant','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`, [B1, B2]);
  await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES
    ($1,$2,'Main','MAIN','Africa/Accra',true),($3,$2,'Second','SECOND','Africa/Accra',true),($4,$5,'Foreign','MAIN','Africa/Accra',true)`,
    [BR1,B1,BR1B,BR2,B2]);
  await pool.query(`INSERT INTO app_users(id,display_name,email,password_hash,status) VALUES
    ($1,'Owner','entity-owner@test.local','hash','ACTIVE'),
    ($2,'Viewer','entity-viewer@test.local','hash','ACTIVE'),
    ($3,'Accountant','entity-accountant@test.local','hash','ACTIVE')`, [OWNER,VIEWER,ACCOUNTANT]);
  await pool.query(`INSERT INTO staff(id,business_id,display_name,role,is_active) VALUES
    ($1,$2,'Owner','OWNER',true),($3,$2,'Viewer','VIEWER',true),($4,$2,'Accountant','ACCOUNTANT',true)`, [OWNER_STAFF,B1,VIEWER_STAFF,ACCOUNTANT_STAFF]);
  await pool.query(`INSERT INTO business_memberships(business_id,user_id,staff_id,role,status,created_by_user_id) VALUES
    ($1,$2,$3,'OWNER','ACTIVE',$2),
    ($1,$4,$5,'VIEWER','ACTIVE',$2),
    ($1,$6,$7,'ACCOUNTANT','ACTIVE',$2)`, [B1,OWNER,OWNER_STAFF,VIEWER,VIEWER_STAFF,ACCOUNTANT,ACCOUNTANT_STAFF]);
  await pool.query(`INSERT INTO catalog_items(id,business_id,sku,name,kind,stock_unit_code,track_stock,is_active) VALUES
    ($1,$2,'W-1','Widget','PRODUCT','EA',true,true)`, [ITEM1,B1]);
  await pool.query(`INSERT INTO customers(id,business_id,name,credit_limit_minor,credit_terms_days,is_active) VALUES
    ($1,$2,'Customer One',10000,30,true),($3,$4,'Foreign Customer',0,0,true)`, [CUSTOMER1,B1,FOREIGN_CUSTOMER,B2]);
  await pool.query(`INSERT INTO suppliers(id,business_id,name,payment_terms_days,is_active) VALUES($1,$2,'Supplier One',14,true)`, [SUPPLIER1,B1]);
  await pool.query(`INSERT INTO purchases(id,business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,settlement_method,total_minor,client_mutation_id,received_at) VALUES
    ($1,$2,$3,$4,$5,'RECEIVED','GHS','CASH',8000,'entity-action-purchase',$6)`, [PURCHASE1,B1,BR1,SUPPLIER1,OWNER_STAFF,NOW]);
  await pool.query(`INSERT INTO business_attention_items(business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at) VALUES
    ($1,$2,'entity-action-item','STOCKOUT_RISK','HIGH','OPEN','Widget stock review','Widget may run out soon',$3::jsonb,$4,$4)`,
    [B1,BR1,JSON.stringify([{source:'inventory_movements',entityType:'CATALOG_ITEM',entityId:ITEM1,label:'availableQuantity',value:'0'}]),NOW]);
}
