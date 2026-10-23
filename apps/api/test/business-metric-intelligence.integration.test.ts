import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import { getBusinessFinancialMetricIntelligence } from "../src/business-intelligence/metric-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `metric_intel_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const B1 = "85000000-0000-4000-8000-000000000001";
const B2 = "86000000-0000-4000-8000-000000000001";
const BR1 = "85000000-0000-4000-8000-000000000002";
const BR2 = "86000000-0000-4000-8000-000000000002";
const STAFF = "85000000-0000-4000-8000-000000000003";
const ITEM = "85000000-0000-4000-8000-000000000004";
const CUSTOMER = "85000000-0000-4000-8000-000000000005";
const SUPPLIER = "85000000-0000-4000-8000-000000000006";
const CURRENT_SALE = "85000000-0000-4000-8000-000000000010";
const PRIOR_SALE = "85000000-0000-4000-8000-000000000011";
const CURRENT_EXPENSE = "85000000-0000-4000-8000-000000000012";
const PRIOR_EXPENSE = "85000000-0000-4000-8000-000000000013";
const CATEGORY = "85000000-0000-4000-8000-000000000014";
const CURRENT = "2026-10-20T12:00:00.000Z";
const PRIOR = "2026-09-20T12:00:00.000Z";

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

describe("financial metric intelligence", () => {
  it("maps all nine allow-listed metrics to the canonical report and comparable prior values", async () => {
    const expected = {
      NET_REVENUE: [10000, 8000, 2000, 25],
      GROSS_PROFIT: [6000, 5000, 1000, 20],
      OPERATING_PROFIT: [5000, 4500, 500, 100 / 9],
      EXPENSES: [1000, 500, 500, 100],
      NET_CASH_MOVEMENT: [9000, 7500, 1500, 20],
      CASH_BALANCE: [16500, 7500, 9000, 120],
      RECEIVABLES: [3000, 2000, 1000, 50],
      PAYABLES: [2000, 1500, 500, 100 / 3],
    } as const;

    for (const [metricKey, values] of Object.entries(expected)) {
      const result = await getBusinessFinancialMetricIntelligence(pool, {
        businessId: B1,
        branchId: BR1,
        metricKey: metricKey as keyof typeof expected,
        range: "month",
      });
      expect(result.metric.metricKey).toBe(metricKey);
      expect(result.range).toBe("month");
      expect(result.currencyCode).toBe("GHS");
      expect(result.currentMinor).toBe(values[0]);
      expect(result.previousMinor).toBe(values[1]);
      expect(result.deltaMinor).toBe(values[2]);
      expect(result.changePercent).toBeCloseTo(values[3], 5);
      expect(result.evidence.some((item) => item.label === "currentMinor" && item.metadata?.kind === "money_minor")).toBe(true);
      expect(result.recommendations).toHaveLength(1);
      expect(result.askPrompt.length).toBeGreaterThan(10);
    }

    const inventory = await getBusinessFinancialMetricIntelligence(pool, {
      businessId: B1, branchId: BR1, metricKey: "INVENTORY_VALUE", range: "month",
    });
    expect(inventory.currentMinor).toBe(7000);
    expect(inventory.previousMinor).toBeNull();
    expect(inventory.deltaMinor).toBeNull();
    expect(inventory.changePercent).toBeNull();
    expect(inventory.summary).toMatch(/snapshot/i);
  });

  it("returns null percentage change when the comparable prior value is zero", async () => {
    await pool.query(`DELETE FROM sale_lines WHERE sale_id=$1`, [PRIOR_SALE]);
    await pool.query(`DELETE FROM sales WHERE id=$1`, [PRIOR_SALE]);
    const result = await getBusinessFinancialMetricIntelligence(pool, {
      businessId: B1, branchId: BR1, metricKey: "NET_REVENUE", range: "month",
    });
    expect(result.previousMinor).toBe(0);
    expect(result.deltaMinor).toBe(10000);
    expect(result.changePercent).toBeNull();
  });

  it("attaches only metric-relevant open attention", async () => {
    const receivables = await getBusinessFinancialMetricIntelligence(pool, {
      businessId: B1, branchId: BR1, metricKey: "RECEIVABLES", range: "month",
    });
    expect(receivables.attentionItems.map((item) => item.ruleCode)).toEqual(["RECEIVABLES_OVERDUE"]);

    const inventory = await getBusinessFinancialMetricIntelligence(pool, {
      businessId: B1, branchId: BR1, metricKey: "INVENTORY_VALUE", range: "month",
    });
    expect(inventory.attentionItems.map((item) => item.ruleCode).sort()).toEqual(["SLOW_STOCK", "STOCKOUT_RISK"]);
  });

  it("fails safely for a branch outside the business scope", async () => {
    await expect(getBusinessFinancialMetricIntelligence(pool, {
      businessId: B1, branchId: BR2, metricKey: "NET_REVENUE", range: "month",
    })).rejects.toMatchObject({ statusCode: 404, code: "BRANCH_NOT_FOUND" });
  });
});

async function seedFixture(): Promise<void> {
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES
    ($1,'Metric Shop','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),
    ($2,'Foreign Shop','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`, [B1, B2]);
  await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES
    ($1,$2,'Main','MAIN','Africa/Accra',true),($3,$4,'Foreign','MAIN','Africa/Accra',true)`, [BR1, B1, BR2, B2]);
  await pool.query(`INSERT INTO staff(id,business_id,display_name,role,is_active) VALUES($1,$2,'Owner','OWNER',true)`, [STAFF, B1]);
  const cashAccountId = (await pool.query<{ money_account_id: string }>(
    `SELECT money_account_id FROM money_account_defaults WHERE business_id=$1 AND branch_id=$2 AND method='CASH'`,
    [B1, BR1],
  )).rows[0]!.money_account_id;
  await pool.query(`INSERT INTO catalog_items(id,business_id,sku,name,kind,stock_unit_code,track_stock,is_active) VALUES($1,$2,'M-1','Metric Item','PRODUCT','EA',true,true)`, [ITEM, B1]);
  await pool.query(`INSERT INTO customers(id,business_id,name,is_active) VALUES($1,$2,'Metric Customer',true)`, [CUSTOMER, B1]);
  await pool.query(`INSERT INTO suppliers(id,business_id,name,is_active) VALUES($1,$2,'Metric Supplier',true)`, [SUPPLIER, B1]);
  await pool.query(`INSERT INTO expense_categories(id,business_id,name,is_active,is_system) VALUES($1,$2,'Metric Expense',true,false)`, [CATEGORY, B1]);

  await pool.query(`INSERT INTO sales(id,business_id,branch_id,status,currency_code,subtotal_net_minor,tax_minor,total_minor,client_mutation_id,completed_at) VALUES
    ($1,$3,$4,'COMPLETED','GHS',10000,0,10000,'metric-current-sale',$5),
    ($2,$3,$4,'COMPLETED','GHS',8000,0,8000,'metric-prior-sale',$6)`, [CURRENT_SALE, PRIOR_SALE, B1, BR1, CURRENT, PRIOR]);
  await pool.query(`INSERT INTO sale_lines(sale_id,business_id,item_id,item_name_snapshot,item_kind,quantity,sale_unit_code,stock_quantity,stock_unit_code,unit_net_minor,unit_cost_minor,line_net_minor,line_tax_minor,line_total_minor,line_cost_minor) VALUES
    ($1,$3,$4,'Metric Item','PRODUCT',1,'EA',1,'EA',10000,4000,10000,0,10000,4000),
    ($2,$3,$4,'Metric Item','PRODUCT',1,'EA',1,'EA',8000,3000,8000,0,8000,3000)`, [CURRENT_SALE, PRIOR_SALE, B1, ITEM]);
  await pool.query(`INSERT INTO expenses(id,business_id,branch_id,category_id,status,amount_minor,currency_code,method,actor_staff_id,client_mutation_id,occurred_at,money_account_id) VALUES
    ($1,$3,$4,$5,'POSTED',1000,'GHS','CASH',$6,'metric-current-expense',$7,$9),
    ($2,$3,$4,$5,'POSTED',500,'GHS','CASH',$6,'metric-prior-expense',$8,$9)`, [CURRENT_EXPENSE, PRIOR_EXPENSE, B1, BR1, CATEGORY, STAFF, CURRENT, PRIOR, cashAccountId]);
  await pool.query(`INSERT INTO cashbook_entries(business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,actor_staff_id,idempotency_key,occurred_at,money_account_id) VALUES
    ($1,$2,10000,'GHS','CASH','SALE_RECEIPT','SALE',$3,$4,'metric-cash-current-sale',$5,$10),
    ($1,$2,-1000,'GHS','CASH','EXPENSE','EXPENSE',$6,$4,'metric-cash-current-expense',$5,$10),
    ($1,$2,8000,'GHS','CASH','SALE_RECEIPT','SALE',$7,$4,'metric-cash-prior-sale',$8,$10),
    ($1,$2,-500,'GHS','CASH','EXPENSE','EXPENSE',$9,$4,'metric-cash-prior-expense',$8,$10)`, [B1, BR1, CURRENT_SALE, STAFF, CURRENT, CURRENT_EXPENSE, PRIOR_SALE, PRIOR, PRIOR_EXPENSE, cashAccountId]);
  await pool.query(`INSERT INTO customer_account_entries(business_id,branch_id,customer_id,currency_code,entry_type,balance_delta_minor,source_type,source_id,actor_staff_id,idempotency_key,occurred_at) VALUES
    ($1,$2,$3,'GHS','CREDIT_SALE',2000,'SALE',$4,$5,'metric-rec-prior',$6),
    ($1,$2,$3,'GHS','CREDIT_SALE',1000,'SALE',$7,$5,'metric-rec-current',$8)`, [B1, BR1, CUSTOMER, PRIOR_SALE, STAFF, PRIOR, CURRENT_SALE, CURRENT]);
  await pool.query(`INSERT INTO supplier_payable_ledger(business_id,branch_id,supplier_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,client_mutation_id,occurred_at) VALUES
    ($1,$2,$3,'GHS',1500,'SUPPLIER_CREDIT','PURCHASE',$4,$5,'metric-pay-prior',$6),
    ($1,$2,$3,'GHS',500,'SUPPLIER_CREDIT','PURCHASE',$7,$5,'metric-pay-current',$8)`, [B1, BR1, SUPPLIER, PRIOR_SALE, STAFF, PRIOR, CURRENT_SALE, CURRENT]);
  await pool.query(`INSERT INTO inventory_valuations(business_id,branch_id,item_id,location_type,quantity,value_minor) VALUES
    ($1,$2,$3,'AVAILABLE',5,6000),($1,$2,$3,'QUARANTINE',1,1000)`, [B1, BR1, ITEM]);

  const attention = [
    ["sales", "SALES_DROP"], ["margin", "MARGIN_PRESSURE"], ["cash", "CASH_PRESSURE_FORECAST"],
    ["receivables", "RECEIVABLES_OVERDUE"], ["payables", "PAYABLES_OVERDUE"],
    ["stockout", "STOCKOUT_RISK"], ["slow", "SLOW_STOCK"], ["unrelated", "LOW_DATA_CONFIDENCE"],
  ];
  for (const [source, rule] of attention) {
    await pool.query(`INSERT INTO business_attention_items(business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence) VALUES
      ($1,$2,$3,$4,'HIGH','OPEN',$4,$4,'[]'::jsonb)`, [B1, BR1, `metric:${source}`, rule]);
  }
}
