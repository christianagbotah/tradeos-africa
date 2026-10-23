import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import {
  BusinessEntityIntelligenceError,
  getBusinessEntityIntelligence,
} from "../src/business-intelligence/entity-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `entity_ai_test_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const B1 = "81000000-0000-4000-8000-000000000001";
const B2 = "82000000-0000-4000-8000-000000000001";
const BR1 = "81000000-0000-4000-8000-000000000002";
const BR1B = "81000000-0000-4000-8000-000000000003";
const BR2 = "82000000-0000-4000-8000-000000000002";
const STAFF1 = "81000000-0000-4000-8000-000000000010";
const ITEM1 = "81000000-0000-4000-8000-000000000020";
const ITEM2 = "82000000-0000-4000-8000-000000000020";
const CUSTOMER1 = "81000000-0000-4000-8000-000000000030";
const CUSTOMER2 = "82000000-0000-4000-8000-000000000030";
const SUPPLIER1 = "81000000-0000-4000-8000-000000000040";
const SALE1 = "81000000-0000-4000-8000-000000000050";
const PURCHASE1 = "81000000-0000-4000-8000-000000000060";
const PURCHASE_LINE1 = "81000000-0000-4000-8000-000000000061";
const NOW = new Date("2026-10-23T12:00:00.000Z");

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses CASCADE");
  await seedFixture();
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("business entity intelligence", () => {
  it("returns branch-scoped catalog evidence, matching attention, and role-gated sales value", async () => {
    const owner = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "OWNER", entityType: "CATALOG_ITEM", entityId: ITEM1, now: NOW,
    });
    expect(owner.entity).toEqual({ entityType: "CATALOG_ITEM", entityId: ITEM1, label: "Widget" });
    expect(value(owner, "availableQuantity")).toBe("5.00000000");
    expect(value(owner, "quarantineQuantity")).toBe("2.00000000");
    expect(value(owner, "soldQuantity30d")).toBe("2.00000000");
    expect(value(owner, "netRevenueMinor30d")).toBe("5000");
    expect(metadata(owner, "netRevenueMinor30d")).toEqual({ kind: "money_minor", currencyCode: "GHS" });
    expect(owner.attentionItems).toHaveLength(1);
    expect(owner.attentionItems[0]?.ruleCode).toBe("STOCKOUT_RISK");
    expect(owner.recommendations.every((item) => !/submit|pay|receive|adjust/i.test(item.suggestedActionType ?? ""))).toBe(true);

    const inventory = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "INVENTORY", entityType: "CATALOG_ITEM", entityId: ITEM1, now: NOW,
    });
    expect(labels(inventory)).not.toContain("netRevenueMinor30d");
    expect(labels(inventory)).toContain("soldQuantity30d");
  });

  it("subtracts completed return reversals from item net revenue evidence", async () => {
    const saleLine = await pool.query<{ id: string }>(
      `SELECT id FROM sale_lines WHERE business_id=$1 AND sale_id=$2 AND item_id=$3 LIMIT 1`,
      [B1, SALE1, ITEM1],
    );
    const returnCase = await pool.query<{ id: string }>(
      `INSERT INTO return_cases(
         business_id,branch_id,original_sale_id,customer_id,initiated_by_staff_id,status,reason,refund_method,currency_code,
         net_revenue_reversal_minor,refund_total_minor,cogs_reversal_minor,client_mutation_id,created_at,completed_at
       ) VALUES($1,$2,$3,$4,$5,'COMPLETED','Customer return','CASH','GHS',2000,2000,800,'entity-return-1',$6,$6) RETURNING id`,
      [B1, BR1, SALE1, CUSTOMER1, STAFF1, NOW],
    );
    await pool.query(
      `INSERT INTO return_lines(return_case_id,original_sale_line_id,quantity,disposition,net_revenue_reversal_minor,cogs_reversal_minor)
       VALUES($1,$2,0.8,'RESTOCK',2000,800)`,
      [returnCase.rows[0]!.id, saleLine.rows[0]!.id],
    );
    await pool.query(`UPDATE sales SET status='PARTIALLY_REFUNDED' WHERE id=$1`, [SALE1]);

    const owner = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "OWNER", entityType: "CATALOG_ITEM", entityId: ITEM1, now: NOW,
    });

    expect(value(owner, "netRevenueMinor30d")).toBe("3000");
  });

  it("returns customer credit evidence only to financial roles and never leaks contact values", async () => {
    const owner = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "OWNER", entityType: "CUSTOMER", entityId: CUSTOMER1, now: NOW,
    });
    expect(owner.entity.label).toBe("Customer One");
    expect(value(owner, "hasPhone")).toBe(true);
    expect(value(owner, "hasEmail")).toBe(true);
    expect(value(owner, "openBalanceMinor")).toBe("2500");
    expect(value(owner, "creditLimitMinor")).toBe("10000");
    expect(metadata(owner, "creditLimitMinor")).toEqual({ kind: "money_minor", currencyCode: "GHS" });
    expect(metadata(owner, "openBalanceMinor")).toEqual({ kind: "money_minor", currencyCode: "GHS" });
    expect(owner.evidence.some((item) => item.value === "0244000000" || item.value === "customer@example.test")).toBe(false);

    const sales = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "SALES", entityType: "CUSTOMER", entityId: CUSTOMER1, now: NOW,
    });
    expect(labels(sales)).toEqual(expect.arrayContaining(["customerName", "isActive", "hasPhone", "hasEmail"]));
    expect(labels(sales)).not.toEqual(expect.arrayContaining(["openBalanceMinor", "creditLimitMinor", "oldestDueAt"]));
  });

  it("returns supplier operational history to inventory roles but payable amounts only to financial roles", async () => {
    const owner = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "ACCOUNTANT", entityType: "SUPPLIER", entityId: SUPPLIER1, now: NOW,
    });
    expect(value(owner, "openPayableMinor")).toBe("6000");
    expect(metadata(owner, "openPayableMinor")).toEqual({ kind: "money_minor", currencyCode: "GHS" });
    expect(metadata(owner, "recentPurchaseTotalMinor30d")).toEqual({ kind: "money_minor", currencyCode: "GHS" });
    expect(value(owner, "recentPurchaseCount30d")).toBe(1);

    const inventory = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "INVENTORY", entityType: "SUPPLIER", entityId: SUPPLIER1, now: NOW,
    });
    expect(value(inventory, "recentPurchaseCount30d")).toBe(1);
    expect(labels(inventory)).not.toContain("openPayableMinor");
    expect(labels(inventory)).not.toContain("recentPurchaseTotalMinor30d");
  });

  it("enforces purchase branch scope and filters purchase totals for non-financial roles", async () => {
    const owner = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "MANAGER", entityType: "PURCHASE", entityId: PURCHASE1, now: NOW,
    });
    expect(owner.entity.label).toContain("Supplier One");
    expect(value(owner, "lineCount")).toBe(1);
    expect(value(owner, "totalMinor")).toBe("8000");
    expect(metadata(owner, "totalMinor")).toEqual({ kind: "money_minor", currencyCode: "GHS" });

    const inventory = await getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1, role: "INVENTORY", entityType: "PURCHASE", entityId: PURCHASE1, now: NOW,
    });
    expect(labels(inventory)).not.toContain("totalMinor");

    await expect(getBusinessEntityIntelligence(pool, {
      businessId: B1, branchId: BR1B, role: "OWNER", entityType: "PURCHASE", entityId: PURCHASE1, now: NOW,
    })).rejects.toMatchObject<Partial<BusinessEntityIntelligenceError>>({ statusCode: 404, code: "ENTITY_NOT_FOUND" });
  });

  it("returns the same safe not-found error for unknown and out-of-tenant entity ids", async () => {
    for (const entityId of [CUSTOMER2, "81000000-0000-4000-8000-000000000099"]) {
      await expect(getBusinessEntityIntelligence(pool, {
        businessId: B1, branchId: BR1, role: "OWNER", entityType: "CUSTOMER", entityId, now: NOW,
      })).rejects.toMatchObject<Partial<BusinessEntityIntelligenceError>>({ statusCode: 404, code: "ENTITY_NOT_FOUND" });
    }
  });
});

function labels(result: { evidence: Array<{ label?: string | null }> }) {
  return result.evidence.map((item) => item.label).filter((value): value is string => typeof value === "string");
}
function value(result: { evidence: Array<{ label?: string | null; value?: unknown }> }, label: string) {
  return result.evidence.find((item) => item.label === label)?.value;
}
function metadata(result: { evidence: Array<{ label?: string | null; metadata?: Record<string, unknown> }> }, label: string) {
  return result.evidence.find((item) => item.label === label)?.metadata;
}

async function seedFixture() {
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES
    ($1,'Tenant One','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),
    ($2,'Tenant Two','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`, [B1,B2]);
  await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES
    ($1,$2,'Main','MAIN','Africa/Accra',true),($3,$2,'Second','SECOND','Africa/Accra',true),($4,$5,'Other','MAIN','Africa/Accra',true)`, [BR1,B1,BR1B,BR2,B2]);
  await pool.query(`INSERT INTO staff(id,business_id,display_name,role,is_active) VALUES($1,$2,'Owner','OWNER',true)`, [STAFF1,B1]);
  await pool.query(`INSERT INTO catalog_items(id,business_id,sku,name,kind,stock_unit_code,track_stock,is_active) VALUES
    ($1,$2,'W-1','Widget','PRODUCT','EA',true,true),($3,$4,'O-1','Other item','PRODUCT','EA',true,true)`, [ITEM1,B1,ITEM2,B2]);
  await pool.query(`INSERT INTO customers(id,business_id,name,phone,email,credit_limit_minor,credit_terms_days,is_active) VALUES
    ($1,$2,'Customer One','0244000000','customer@example.test',10000,30,true),($3,$4,'Other Customer',null,null,0,0,true)`, [CUSTOMER1,B1,CUSTOMER2,B2]);
  await pool.query(`INSERT INTO suppliers(id,business_id,name,phone,email,address,payment_terms_days,is_active) VALUES
    ($1,$2,'Supplier One','0200000000','supplier@example.test','Accra',14,true)`, [SUPPLIER1,B1]);
  await pool.query(`INSERT INTO inventory_movements(business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at) VALUES
    ($1,$2,$3,'EA',5,'AVAILABLE','OPENING_BALANCE','TEST',$4,$5,'entity-stock-1',$6),
    ($1,$2,$3,'EA',2,'QUARANTINE','ADJUSTMENT','TEST',$4,$5,'entity-stock-2',$6)`, [B1,BR1,ITEM1,SALE1,STAFF1,NOW]);
  await pool.query(`INSERT INTO sales(id,business_id,branch_id,customer_id,cashier_staff_id,status,currency_code,subtotal_net_minor,total_minor,client_mutation_id,opened_at,completed_at) VALUES
    ($1,$2,$3,$4,$5,'COMPLETED','GHS',5000,5000,'entity-sale-1',$6,$6)`, [SALE1,B1,BR1,CUSTOMER1,STAFF1,NOW]);
  await pool.query(`INSERT INTO sale_lines(sale_id,business_id,item_id,item_name_snapshot,item_kind,quantity,sale_unit_code,stock_quantity,stock_unit_code,unit_net_minor,line_net_minor,line_total_minor,unit_cost_minor,line_cost_minor) VALUES
    ($1,$2,$3,'Widget','PRODUCT',2,'EA',2,'EA',2500,5000,5000,1000,2000)`, [SALE1,B1,ITEM1]);
  await pool.query(`INSERT INTO customer_credit_obligations(business_id,branch_id,customer_id,sale_id,currency_code,original_minor,open_minor,issued_at,due_at) VALUES
    ($1,$2,$3,$4,'GHS',4000,2500,$5,$6)`, [B1,BR1,CUSTOMER1,SALE1,new Date(NOW.getTime()-10*86400000),new Date(NOW.getTime()-2*86400000)]);
  await pool.query(`INSERT INTO customer_account_entries(business_id,branch_id,customer_id,currency_code,entry_type,balance_delta_minor,source_type,source_id,actor_staff_id,idempotency_key,occurred_at) VALUES
    ($1,$2,$3,'GHS','CREDIT_SALE',2500,'SALE',$4,$5,'entity-account-1',$6)`, [B1,BR1,CUSTOMER1,SALE1,STAFF1,NOW]);
  await pool.query(`INSERT INTO purchases(id,business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,settlement_method,supplier_reference,total_minor,client_mutation_id,received_at) VALUES
    ($1,$2,$3,$4,$5,'RECEIVED','GHS','SUPPLIER_CREDIT','SUP-REF',8000,'entity-purchase-1',$6)`, [PURCHASE1,B1,BR1,SUPPLIER1,STAFF1,NOW]);
  await pool.query(`INSERT INTO purchase_lines(id,purchase_id,business_id,item_id,item_name_snapshot,purchase_unit_code,purchase_quantity,stock_unit_code,stock_quantity,unit_cost_minor,line_cost_minor) VALUES
    ($1,$2,$3,$4,'Widget','EA',4,'EA',4,2000,8000)`, [PURCHASE_LINE1,PURCHASE1,B1,ITEM1]);
  await pool.query(`INSERT INTO supplier_payable_ledger(business_id,branch_id,supplier_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,client_mutation_id,occurred_at) VALUES
    ($1,$2,$3,'GHS',8000,'SUPPLIER_CREDIT','PURCHASE',$4,$5,'entity-payable-1',$6)`, [B1,BR1,SUPPLIER1,PURCHASE1,STAFF1,NOW]);
  await pool.query(`INSERT INTO supplier_credit_obligations(business_id,branch_id,supplier_id,purchase_id,currency_code,original_minor,open_minor,issued_at,due_at) VALUES
    ($1,$2,$3,$4,'GHS',8000,6000,$5,$6)`, [B1,BR1,SUPPLIER1,PURCHASE1,new Date(NOW.getTime()-10*86400000),new Date(NOW.getTime()-2*86400000)]);
  await pool.query(`INSERT INTO business_attention_items(business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at) VALUES
    ($1,$2,'entity-item-attention','STOCKOUT_RISK','HIGH','OPEN','Widget needs review','Review stock evidence',$3::jsonb,$4,$4),
    ($1,$2,'other-item-attention','SLOW_STOCK','LOW','OPEN','Other item','Should not match',$5::jsonb,$4,$4)`, [B1,BR1,JSON.stringify([{source:'inventory_movements',entityType:'CATALOG_ITEM',entityId:ITEM1,label:'availableQuantity',value:'5'}]),NOW,JSON.stringify([{source:'inventory_movements',entityType:'CATALOG_ITEM',entityId:'81000000-0000-4000-8000-000000000098',label:'availableQuantity',value:'1'}])]);
}
