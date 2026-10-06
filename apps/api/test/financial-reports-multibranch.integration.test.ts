import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function register(email: string, deviceKey: string) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { displayName: "Report Owner", email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" } });
  expect(response.statusCode).toBe(201);
  return response.json().session.accessToken as string;
}
async function onboard(token: string, name: string) {
  const response = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: { authorization: `Bearer ${token}` }, payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(response.statusCode).toBe(201);
  return response.json() as { business: { id: string }; branch: { id: string } };
}

describe("financial reporting", () => {
  it("derives profit, cash, credit, inventory, branch and previous-period metrics from authoritative ledgers", async () => {
    const token = await register("report-owner@tradeos.test", "report-device");
    const { business, branch } = await onboard(token, "Report Shop");
    const businessId = business.id, mainBranchId = branch.id;
    const staffId = (await pool.query<{ staff_id: string }>(`SELECT staff_id FROM business_memberships WHERE business_id=$1 AND role='OWNER'`, [businessId])).rows[0]!.staff_id;
    const secondBranchId = (await pool.query<{ id: string }>(`INSERT INTO branches(business_id,name,code,timezone) VALUES($1,'Second','SECOND','Africa/Accra') RETURNING id`, [businessId])).rows[0]!.id;
    const itemId = (await pool.query<{ id: string }>(`INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock) VALUES($1,'Steel nail','PRODUCT','lb',true) RETURNING id`, [businessId])).rows[0]!.id;
    const customerOwes = (await pool.query<{ id: string }>(`INSERT INTO customers(business_id,name) VALUES($1,'Customer Owes') RETURNING id`, [businessId])).rows[0]!.id;
    const customerCredit = (await pool.query<{ id: string }>(`INSERT INTO customers(business_id,name) VALUES($1,'Customer Credit') RETURNING id`, [businessId])).rows[0]!.id;
    const supplierOwed = (await pool.query<{ id: string }>(`INSERT INTO suppliers(business_id,name) VALUES($1,'Supplier Owed') RETURNING id`, [businessId])).rows[0]!.id;
    const supplierCredit = (await pool.query<{ id: string }>(`INSERT INTO suppliers(business_id,name) VALUES($1,'Supplier Credit') RETURNING id`, [businessId])).rows[0]!.id;
    const categoryId = (await pool.query<{ id: string }>(`SELECT id FROM expense_categories WHERE business_id=$1 ORDER BY name LIMIT 1`, [businessId])).rows[0]!.id;
    const cashMain = (await pool.query<{ money_account_id: string }>(`SELECT money_account_id FROM money_account_defaults WHERE business_id=$1 AND branch_id=$2 AND method='CASH'`, [businessId, mainBranchId])).rows[0]!.money_account_id;
    const cashSecond = (await pool.query<{ money_account_id: string }>(`SELECT money_account_id FROM money_account_defaults WHERE business_id=$1 AND branch_id=$2 AND method='CASH'`, [businessId, secondBranchId])).rows[0]!.money_account_id;
    const sale = async (branchId: string, mutation: string, at: string, net: number, tax: number, cost: number) => {
      const saleId = (await pool.query<{ id: string }>(`INSERT INTO sales(business_id,branch_id,cashier_staff_id,status,currency_code,subtotal_net_minor,tax_minor,total_minor,client_mutation_id,opened_at,completed_at) VALUES($1,$2,$3,'COMPLETED','GHS',$4,$5,$6,$7,$8,$8) RETURNING id`, [businessId, branchId, staffId, net, tax, net + tax, mutation, at])).rows[0]!.id;
      await pool.query(`INSERT INTO sale_lines(sale_id,business_id,item_id,item_name_snapshot,item_kind,quantity,sale_unit_code,stock_quantity,stock_unit_code,unit_net_minor,unit_tax_minor,unit_cost_minor,line_net_minor,line_tax_minor,line_total_minor,line_cost_minor) VALUES($1,$2,$3,'Steel nail','PRODUCT',1,'lb',1,'lb',$4,$5,$6,$4,$5,$7,$6)`, [saleId, businessId, itemId, net, tax, cost, net + tax]);
      return saleId;
    };
    await sale(mainBranchId, "sale-prev", "2026-09-27T10:00:00Z", 5000, 500, 2000);
    const mainSaleId = await sale(mainBranchId, "sale-main", "2026-10-03T10:00:00Z", 10000, 1000, 4000);
    await sale(secondBranchId, "sale-second", "2026-10-04T11:00:00Z", 20000, 2000, 8000);
    const mainLineId = (await pool.query<{ id: string }>(`SELECT id FROM sale_lines WHERE sale_id=$1`, [mainSaleId])).rows[0]!.id;
    const returnId = (await pool.query<{ id: string }>(`INSERT INTO return_cases(business_id,branch_id,original_sale_id,initiated_by_staff_id,approved_by_staff_id,status,reason,refund_method,currency_code,net_revenue_reversal_minor,tax_reversal_minor,refund_total_minor,cogs_reversal_minor,discarded_cost_minor,client_mutation_id,created_at,completed_at) VALUES($1,$2,$3,$4,$4,'COMPLETED','Partial return','CASH','GHS',2000,200,2200,800,0,'return-main','2026-10-04T12:00:00Z','2026-10-04T12:00:00Z') RETURNING id`, [businessId, mainBranchId, mainSaleId, staffId])).rows[0]!.id;
    await pool.query(`INSERT INTO return_lines(return_case_id,original_sale_line_id,quantity,disposition,net_revenue_reversal_minor,tax_reversal_minor,cogs_reversal_minor,discarded_cost_minor) VALUES($1,$2,0.2,'RESTOCK',2000,200,800,0)`, [returnId, mainLineId]);

    const purchaseId = (await pool.query<{ id: string }>(`INSERT INTO purchases(business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,settlement_method,total_minor,client_mutation_id,received_at) VALUES($1,$2,$3,$4,'RECEIVED','GHS','CASH',10000,'purchase-report','2026-10-02T09:00:00Z') RETURNING id`, [businessId, mainBranchId, supplierOwed, staffId])).rows[0]!.id;
    await pool.query(`INSERT INTO purchase_return_cases(business_id,branch_id,supplier_id,original_purchase_id,returned_by_staff_id,currency_code,recovery_method,supplier_recovery_minor,inventory_value_removed_minor,purchase_price_variance_minor,client_mutation_id,occurred_at) VALUES($1,$2,$3,$4,$5,'GHS','CASH',1300,1000,300,'purchase-return-report','2026-10-05T09:00:00Z')`, [businessId, mainBranchId, supplierOwed, purchaseId, staffId]);

    await pool.query(`INSERT INTO expenses(business_id,branch_id,category_id,status,amount_minor,currency_code,method,actor_staff_id,client_mutation_id,occurred_at,money_account_id) VALUES
      ($1,$2,$3,'POSTED',1500,'GHS','CASH',$4,'expense-main','2026-10-05T10:00:00Z',$5),
      ($1,$6,$3,'POSTED',2000,'GHS','CASH',$4,'expense-second','2026-10-05T11:00:00Z',$7)`, [businessId, mainBranchId, categoryId, staffId, cashMain, secondBranchId, cashSecond]);

    const cash = async (branchId: string, accountId: string, amount: number, type: string, key: string, at: string) => {
      await pool.query(`INSERT INTO cashbook_entries(business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,actor_staff_id,idempotency_key,occurred_at,money_account_id) VALUES($1,$2,$3,'GHS','CASH',$4,'REPORT_FIXTURE',gen_random_uuid(),$5,$6,$7,$8)`, [businessId, branchId, amount, type, staffId, key, at, accountId]);
    };
    await cash(mainBranchId, cashMain, 5500, "SALE_RECEIPT", "cash-prev", "2026-09-27T10:00:00Z");
    await cash(mainBranchId, cashMain, 11000, "SALE_RECEIPT", "cash-main-sale", "2026-10-03T10:00:00Z");
    await cash(mainBranchId, cashMain, -2200, "SALE_REFUND", "cash-main-refund", "2026-10-04T12:00:00Z");
    await cash(mainBranchId, cashMain, -1500, "EXPENSE", "cash-main-expense", "2026-10-05T10:00:00Z");
    await cash(mainBranchId, cashMain, 5000, "OWNER_INJECTION", "cash-owner-injection", "2026-10-05T12:00:00Z");
    await cash(secondBranchId, cashSecond, 22000, "SALE_RECEIPT", "cash-second-sale", "2026-10-04T11:00:00Z");
    await cash(secondBranchId, cashSecond, -2000, "EXPENSE", "cash-second-expense", "2026-10-05T11:00:00Z");
    await pool.query(`INSERT INTO customer_account_entries(business_id,branch_id,customer_id,currency_code,entry_type,balance_delta_minor,source_type,source_id,actor_staff_id,idempotency_key,occurred_at) VALUES
      ($1,$2,$3,'GHS','CREDIT_SALE',3000,'REPORT_FIXTURE',gen_random_uuid(),$4,'customer-owes','2026-10-06T08:00:00Z'),
      ($1,$5,$6,'GHS','ADJUSTMENT',-1000,'REPORT_FIXTURE',gen_random_uuid(),$4,'customer-credit','2026-10-06T08:30:00Z')`, [businessId, mainBranchId, customerOwes, staffId, secondBranchId, customerCredit]);
    await pool.query(`INSERT INTO supplier_payable_ledger(business_id,branch_id,supplier_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,client_mutation_id,occurred_at) VALUES
      ($1,$2,$3,'GHS',4000,'SUPPLIER_CREDIT','PURCHASE',gen_random_uuid(),$4,'supplier-owed','2026-10-06T09:00:00Z'),
      ($1,$5,$6,'GHS',-500,'CREDIT_NOTE','RETURN',gen_random_uuid(),$4,'supplier-credit','2026-10-06T09:30:00Z')`, [businessId, mainBranchId, supplierOwed, staffId, secondBranchId, supplierCredit]);
    await pool.query(`INSERT INTO inventory_valuations(business_id,branch_id,item_id,location_type,quantity,value_minor) VALUES
      ($1,$2,$3,'AVAILABLE',10,7000),($1,$2,$3,'QUARANTINE',1,1000),($1,$4,$3,'AVAILABLE',20,12000)`, [businessId, mainBranchId, itemId, secondBranchId]);

    const headers = { authorization: `Bearer ${token}` };
    const all = await app.inject({ method: "GET", url: `/v1/reports/financial-summary?businessId=${businessId}&from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z`, headers });
    expect(all.statusCode).toBe(200);
    const report = all.json();
    expect(report.flow).toMatchObject({ grossRevenueMinor: 30000, returnsRevenueMinor: 2000, netRevenueMinor: 28000, grossTaxMinor: 3000, returnsTaxMinor: 200, netTaxMinor: 2800, grossCogsMinor: 12000, cogsReversalMinor: 800, netCogsMinor: 11200, grossProfitMinor: 16800, expenseMinor: 3500, purchaseReturnVarianceMinor: 300, operatingProfitMinor: 13600, grossSalesTotalMinor: 33000, refundTotalMinor: 2200, salesCount: 2, returnCount: 1, averageNetSaleMinor: 14000, cashInflowMinor: 38000, cashOutflowMinor: 5700, netCashMovementMinor: 32300, operatingCashNetMinor: 27300 });
    expect(report.previousFlow).toMatchObject({ netRevenueMinor: 5000, netCogsMinor: 2000, grossProfitMinor: 3000, operatingProfitMinor: 3000, salesCount: 1, netCashMovementMinor: 5500 });
    expect(report.comparison).toMatchObject({ netRevenueDeltaMinor: 23000, grossProfitDeltaMinor: 13800, expenseDeltaMinor: 3500, operatingProfitDeltaMinor: 10600, salesCountDelta: 1, netCashMovementDeltaMinor: 26800, netRevenueChangePercent: 460, grossProfitChangePercent: 460, operatingProfitChangePercent: 353.33 });
    expect(report.position).toMatchObject({ cashBalanceMinor: 37800, receivablesMinor: 3000, customerCreditBalanceMinor: 1000, payablesMinor: 4000, supplierCreditBalanceMinor: 500, inventoryValueMinor: 20000, inventoryAvailableValueMinor: 19000, inventoryQuarantineValueMinor: 1000 });
    expect(report.previousPosition).toMatchObject({ cashBalanceMinor: 5500, receivablesMinor: 0, payablesMinor: 0 });
    expect(report.daily).toHaveLength(7);
    expect(report.daily.find((row: { date: string }) => row.date === "2026-10-05")).toMatchObject({ expenseMinor: 3500, purchaseReturnVarianceMinor: 300, cashNetMinor: 1500 });
    expect(report.topItems[0]).toMatchObject({ itemId, itemName: "Steel nail", quantitySold: 2, quantityReturned: 0.2, netRevenueMinor: 28000, netCogsMinor: 11200, grossProfitMinor: 16800 });
    expect(report.branches).toHaveLength(2);
    expect(report.branches.find((row: { branchId: string }) => row.branchId === mainBranchId)).toMatchObject({ netRevenueMinor: 8000, netCogsMinor: 3200, grossProfitMinor: 4800, expenseMinor: 1500, purchaseReturnVarianceMinor: 300, operatingProfitMinor: 3600, cashNetMinor: 12300, receivablesMinor: 3000, payablesMinor: 4000, inventoryValueMinor: 8000 });
    expect(report.branches.find((row: { branchId: string }) => row.branchId === secondBranchId)).toMatchObject({ netRevenueMinor: 20000, netCogsMinor: 8000, grossProfitMinor: 12000, expenseMinor: 2000, operatingProfitMinor: 10000, cashNetMinor: 20000, inventoryValueMinor: 12000 });

    const scoped = await app.inject({ method: "GET", url: `/v1/reports/financial-summary?businessId=${businessId}&branchId=${mainBranchId}&from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z`, headers });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().flow).toMatchObject({ netRevenueMinor: 8000, grossProfitMinor: 4800, expenseMinor: 1500, operatingProfitMinor: 3600, salesCount: 1, returnCount: 1 });
    expect(scoped.json().branches).toHaveLength(1);

    const otherToken = await register("other-report-owner@tradeos.test", "other-report-device");
    const other = await onboard(otherToken, "Other Business");
    const forbidden = await app.inject({ method: "GET", url: `/v1/reports/financial-summary?businessId=${other.business.id}&from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z`, headers });
    expect(forbidden.statusCode).toBe(403);
    const foreignBranch = await app.inject({ method: "GET", url: `/v1/reports/financial-summary?businessId=${businessId}&branchId=${other.branch.id}&from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z`, headers });
    expect(foreignBranch.statusCode).toBe(404);
    const tooLong = await app.inject({ method: "GET", url: `/v1/reports/financial-summary?businessId=${businessId}&from=2025-01-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z`, headers });
    expect(tooLong.statusCode).toBe(400);
  });
});
