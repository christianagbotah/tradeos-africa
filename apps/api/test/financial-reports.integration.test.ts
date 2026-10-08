import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("financial summary reports", () => {
  it("reconciles sales, returns, COGS, expenses, cash, credit, payables and inventory", async () => {
    const registration = await app.inject({ method:"POST", url:"/v1/auth/register", payload:{ displayName:"Report Owner", email:"reports@tradeos.test", password:"TradeOS-Test-1234", platform:"WEB", deviceKey:"report-device", appVersion:"test" } });
    expect(registration.statusCode).toBe(201);
    const token = registration.json().session.accessToken;
    const headers = { authorization:`Bearer ${token}` };
    const onboard = await app.inject({ method:"POST", url:"/v1/onboarding/business", headers, payload:{ name:"Report Shop", businessType:"RETAIL_HARDWARE", branchName:"Main" } });
    expect(onboard.statusCode).toBe(201);
    const businessId = onboard.json().business.id, branchId = onboard.json().branch.id;

    const supplierResponse = await app.inject({ method:"POST", url:"/v1/suppliers", headers, payload:{ businessId, name:"Main Supplier" } });
    expect(supplierResponse.statusCode).toBe(201);
    const supplierId = supplierResponse.json().supplier.id;
    const customerResponse = await app.inject({ method:"POST", url:"/v1/customers", headers, payload:{ businessId, name:"Credit Customer", creditLimitMinor:5000 } });
    expect(customerResponse.statusCode).toBe(201);
    const customerId = customerResponse.json().customer.id;
    const catalog = await app.inject({ method:"POST", url:"/v1/catalog/items", headers, payload:{ businessId, name:"Box Item", kind:"PRODUCT", trackStock:true, stockUnitCode:"piece", units:[{ code:"piece", label:"Piece", canStock:true, canPurchase:true, canSell:true, defaultSalePriceMinor:500 }] } });
    expect(catalog.statusCode).toBe(201);
    const itemId = catalog.json().item.id;
    const occurredAt = "2026-10-05T10:00:00.000Z";
    const sync = async (clientMutationId:string, mutationType:string, payload:unknown) => {
      const response = await app.inject({ method:"POST", url:"/v1/sync", headers, payload:{ mutations:[{ clientId:"report-device", clientMutationId, businessId, branchId, mutationType, occurredAt, payload }] } });
      expect(response.statusCode).toBe(200);
      return response.json().mutationResults[0];
    };

    expect((await sync("purchase-cash","PURCHASE_RECEIVE_CREATE",{ supplierId, settlementMethod:"CASH", lines:[{ itemId, purchaseUnitCode:"piece", quantity:10, unitCostMinor:200 }] })).status).toBe("APPLIED");
    const cashSale = await sync("sale-cash","SALE_CREATE",{ paymentMethod:"CASH", lines:[{ itemId, saleUnitCode:"piece", quantity:3 }] });
    expect(cashSale.status).toBe("APPLIED");
    const cashSaleLine = (await pool.query(`SELECT id FROM sale_lines WHERE sale_id=$1`,[cashSale.result.saleId])).rows[0].id;
    expect((await sync("return-one","RETURN_CREATE",{ originalSaleId:cashSale.result.saleId, reason:"One returned", refundMethod:"ORIGINAL_METHOD", lines:[{ saleLineId:cashSaleLine, quantity:1, disposition:"RESTOCK" }] })).status).toBe("APPLIED");
    expect((await sync("sale-credit","SALE_CREATE",{ customerId, paymentMethod:"CUSTOMER_CREDIT", lines:[{ itemId, saleUnitCode:"piece", quantity:1 }] })).status).toBe("APPLIED");
    expect((await sync("purchase-credit","PURCHASE_RECEIVE_CREATE",{ supplierId, settlementMethod:"SUPPLIER_CREDIT", lines:[{ itemId, purchaseUnitCode:"piece", quantity:2, unitCostMinor:200 }] })).status).toBe("APPLIED");
    const categoryId = (await pool.query(`SELECT id FROM expense_categories WHERE business_id=$1 ORDER BY name LIMIT 1`,[businessId])).rows[0].id;
    expect((await sync("expense-one","EXPENSE_CREATE",{ categoryId, amountMinor:100, method:"CASH", description:"Shop expense" })).status).toBe("APPLIED");

    const reportResponse = await app.inject({ method:"GET", url:`/v1/reports/financial-summary?businessId=${businessId}&branchId=${branchId}&from=2026-10-05T00:00:00.000Z&to=2026-10-06T00:00:00.000Z`, headers });
    expect(reportResponse.statusCode).toBe(200);
    const report = reportResponse.json();
    expect(report.currencyCode).toBe("GHS");
    expect(report.flow).toMatchObject({
      grossRevenueMinor:2000,
      returnsRevenueMinor:500,
      netRevenueMinor:1500,
      grossCogsMinor:800,
      cogsReversalMinor:200,
      netCogsMinor:600,
      grossProfitMinor:900,
      expenseMinor:100,
      operatingProfitMinor:800,
      grossSalesTotalMinor:2000,
      refundTotalMinor:500,
      salesCount:2,
      returnCount:1,
      averageNetSaleMinor:750,
      cashInflowMinor:1500,
      cashOutflowMinor:2600,
      netCashMovementMinor:-1100,
      operatingCashNetMinor:-1100,
    });
    expect(report.position).toMatchObject({
      cashBalanceMinor:-1100,
      receivablesMinor:500,
      customerCreditBalanceMinor:0,
      payablesMinor:400,
      supplierCreditBalanceMinor:0,
      inventoryValueMinor:1800,
      inventoryAvailableValueMinor:1800,
      inventoryQuarantineValueMinor:0,
    });
    expect(report.previousFlow).toMatchObject({ netRevenueMinor:0, grossProfitMinor:0, expenseMinor:0, operatingProfitMinor:0, salesCount:0, netCashMovementMinor:0 });
    expect(report.previousPosition).toMatchObject({ cashBalanceMinor:0, receivablesMinor:0, payablesMinor:0 });
    expect(report.comparison.netRevenueChangePercent).toBeNull();
    expect(report.daily).toHaveLength(1);
    expect(report.daily[0]).toMatchObject({ date:"2026-10-05", netRevenueMinor:1500, netCogsMinor:600, grossProfitMinor:900, expenseMinor:100, operatingProfitMinor:800, cashNetMinor:-1100, salesCount:2, returnCount:1 });
    expect(report.topItems[0]).toMatchObject({ itemId, itemName:"Box Item", unitCode:"piece", quantitySold:4, quantityReturned:1, netRevenueMinor:1500, netCogsMinor:600, grossProfitMinor:900 });
    expect(report.branches).toHaveLength(1);
    expect(report.branches[0]).toMatchObject({ branchId, netRevenueMinor:1500, netCogsMinor:600, grossProfitMinor:900, expenseMinor:100, operatingProfitMinor:800, cashNetMinor:-1100, receivablesMinor:500, payablesMinor:400, inventoryValueMinor:1800, salesCount:2, returnCount:1 });
    expect(report.health.algorithmVersion).toBe("health-v1");
    expect(report.health.score).not.toBeNull();
    expect(report.health.confidence).toBe("LOW");
    expect(report.health.dimensions).toHaveLength(5);
    expect(report.health.insights.map((item:{code:string})=>item.code)).toEqual(expect.arrayContaining(["NEGATIVE_OPERATING_CASH","PAYABLE_COVERAGE","HIGH_RETURNS"]));
    // This report window is intentionally historical while inventory valuation is a current snapshot.
    // Health must not blend today's stock value into historical working capital.
    expect(report.health.workingCapital).toMatchObject({ inventorySnapshotAligned:false, operatingWorkingCapitalMinor:null, inventoryMonths:null, cashAfterPayablesMinor:-1500, netTradeCreditMinor:100 });
    expect(["WATCH","PRESSURED"]).toContain(report.health.workingCapital.status);
    expect(report.health.actions.length).toBeGreaterThan(0);
    expect(report.health.actions.every((item:{href:string})=>item.href.startsWith("/") && !item.href.startsWith("#"))).toBe(true);
  });

  it("reports multi-unit product volume in one stock-equivalent unit", async () => {
    const registration = await app.inject({ method:"POST", url:"/v1/auth/register", payload:{ displayName:"Unit Report", email:"reports-units@tradeos.test", password:"TradeOS-Test-1234", platform:"WEB", deviceKey:"report-unit-device", appVersion:"test" } });
    const headers = { authorization:`Bearer ${registration.json().session.accessToken}` };
    const onboard = await app.inject({ method:"POST", url:"/v1/onboarding/business", headers, payload:{ name:"Drinks", businessType:"DRINKING_SPOT", branchName:"Main" } });
    const businessId=onboard.json().business.id, branchId=onboard.json().branch.id;
    const supplier=(await app.inject({method:"POST",url:"/v1/suppliers",headers,payload:{businessId,name:"Drinks Supplier"}})).json().supplier.id;
    const catalog=await app.inject({method:"POST",url:"/v1/catalog/items",headers,payload:{businessId,name:"Spirit",kind:"PRODUCT",trackStock:true,stockUnitCode:"ml",units:[{code:"ml",label:"ml",canStock:true},{code:"bottle",label:"Bottle",canPurchase:true,canSell:true,defaultSalePriceMinor:10000},{code:"glass",label:"Glass",canSell:true,defaultSalePriceMinor:1000}],conversions:[{fromUnitCode:"bottle",toUnitCode:"ml",factor:750},{fromUnitCode:"glass",toUnitCode:"ml",factor:50}]}});
    expect(catalog.statusCode).toBe(201);const itemId=catalog.json().item.id;
    const occurredAt="2026-10-05T11:00:00.000Z";
    const sync=async(id:string,type:string,payload:unknown)=>{const r=await app.inject({method:"POST",url:"/v1/sync",headers,payload:{mutations:[{clientId:"report-unit-device",clientMutationId:id,businessId,branchId,mutationType:type,occurredAt,payload}]}});expect(r.statusCode).toBe(200);return r.json().mutationResults[0];};
    expect((await sync("unit-purchase","PURCHASE_RECEIVE_CREATE",{supplierId:supplier,settlementMethod:"CASH",lines:[{itemId,purchaseUnitCode:"bottle",quantity:2,unitCostMinor:6000}]})).status).toBe("APPLIED");
    const sale=await sync("unit-sale","SALE_CREATE",{paymentMethod:"CASH",lines:[{itemId,saleUnitCode:"bottle",quantity:1},{itemId,saleUnitCode:"glass",quantity:2}]});
    expect(sale.status).toBe("APPLIED");
    const glassLine=(await pool.query(`SELECT id FROM sale_lines WHERE sale_id=$1 AND sale_unit_code='glass'`,[sale.result.saleId])).rows[0].id;
    expect((await sync("unit-return","RETURN_CREATE",{originalSaleId:sale.result.saleId,reason:"One glass returned",refundMethod:"ORIGINAL_METHOD",lines:[{saleLineId:glassLine,quantity:1,disposition:"RESTOCK"}]})).status).toBe("APPLIED");
    const report=await app.inject({method:"GET",url:`/v1/reports/financial-summary?businessId=${businessId}&branchId=${branchId}&from=2026-10-05T00:00:00Z&to=2026-10-06T00:00:00Z`,headers});
    expect(report.statusCode).toBe(200);
    expect(report.json().topItems[0]).toMatchObject({itemId,itemName:"Spirit",unitCode:"ml",quantitySold:850,quantityReturned:50,netRevenueMinor:11000});
  });

  it("includes supplier return valuation variance in operating profit", async () => {
    const registration=await app.inject({method:"POST",url:"/v1/auth/register",payload:{displayName:"Variance Owner",email:"reports-variance@tradeos.test",password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"report-variance-device",appVersion:"test"}});
    const headers={authorization:`Bearer ${registration.json().session.accessToken}`};
    const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",headers,payload:{name:"Variance Shop",businessType:"RETAIL_HARDWARE",branchName:"Main"}});
    const businessId=onboard.json().business.id,branchId=onboard.json().branch.id;
    const supplierId=(await app.inject({method:"POST",url:"/v1/suppliers",headers,payload:{businessId,name:"Variance Supplier"}})).json().supplier.id;
    const catalog=await app.inject({method:"POST",url:"/v1/catalog/items",headers,payload:{businessId,name:"Bearing",kind:"PRODUCT",trackStock:true,stockUnitCode:"piece",units:[{code:"piece",label:"Piece",canStock:true,canPurchase:true,canSell:true,defaultSalePriceMinor:500}]}});
    const itemId=catalog.json().item.id;const occurredAt="2026-10-05T12:00:00Z";
    const sync=async(id:string,type:string,payload:unknown)=>{const r=await app.inject({method:"POST",url:"/v1/sync",headers,payload:{mutations:[{clientId:"report-variance-device",clientMutationId:id,businessId,branchId,mutationType:type,occurredAt,payload}]}});expect(r.statusCode).toBe(200);return r.json().mutationResults[0];};
    const first=await sync("variance-p1","PURCHASE_RECEIVE_CREATE",{supplierId,settlementMethod:"SUPPLIER_CREDIT",lines:[{itemId,purchaseUnitCode:"piece",quantity:1,unitCostMinor:100}]});
    expect(first.status).toBe("APPLIED");
    expect((await sync("variance-p2","PURCHASE_RECEIVE_CREATE",{supplierId,settlementMethod:"SUPPLIER_CREDIT",lines:[{itemId,purchaseUnitCode:"piece",quantity:1,unitCostMinor:300}]})).status).toBe("APPLIED");
    const purchaseLineId=(await pool.query(`SELECT id FROM purchase_lines WHERE purchase_id=$1`,[first.result.purchaseId])).rows[0].id;
    const returned=await sync("variance-return","PURCHASE_RETURN_CREATE",{originalPurchaseId:first.result.purchaseId,supplierId,recoveryMethod:"CREDIT_NOTE",lines:[{purchaseLineId,quantity:1,sourceLocation:"AVAILABLE"}]});
    expect(returned.status).toBe("APPLIED");
    expect(returned.result.purchasePriceVarianceMinor).toBe(-100);
    const response=await app.inject({method:"GET",url:`/v1/reports/financial-summary?businessId=${businessId}&branchId=${branchId}&from=2026-10-05T00:00:00Z&to=2026-10-06T00:00:00Z`,headers});
    expect(response.statusCode).toBe(200);const report=response.json();
    expect(report.flow).toMatchObject({grossProfitMinor:0,expenseMinor:0,purchaseReturnVarianceMinor:-100,operatingProfitMinor:-100});
    expect(report.position).toMatchObject({payablesMinor:300,inventoryValueMinor:200,inventoryAvailableValueMinor:200});
    expect(report.daily[0]).toMatchObject({purchaseReturnVarianceMinor:-100,operatingProfitMinor:-100});
    expect(report.branches[0]).toMatchObject({purchaseReturnVarianceMinor:-100,operatingProfitMinor:-100,payablesMinor:300,inventoryValueMinor:200});
  });

  it("gates financial reports and validates business, branch and report ranges", async () => {
    const registration = await app.inject({ method:"POST", url:"/v1/auth/register", payload:{ displayName:"Report Gate", email:"reports-gate@tradeos.test", password:"TradeOS-Test-1234", platform:"WEB", deviceKey:"report-gate-device", appVersion:"test" } });
    const token = registration.json().session.accessToken;
    const headers = { authorization:`Bearer ${token}` };
    const onboard = await app.inject({ method:"POST", url:"/v1/onboarding/business", headers, payload:{ name:"Gate Shop", businessType:"OTHER", branchName:"Main" } });
    const businessId = onboard.json().business.id, branchId = onboard.json().branch.id;
    const good = `/v1/reports/financial-summary?businessId=${businessId}&branchId=${branchId}&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`;
    const emptyReportResponse=await app.inject({ method:"GET", url:good, headers });
    expect(emptyReportResponse.statusCode).toBe(200);
    expect(emptyReportResponse.json().health).toMatchObject({algorithmVersion:"health-v1",score:null,status:"INSUFFICIENT_DATA",confidence:"LOW"});
    expect((await app.inject({ method:"GET", url:`${good}&extra=ignored`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method:"GET", url:`/v1/reports/financial-summary?businessId=${businessId}&branchId=00000000-0000-4000-8000-000000000000&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method:"GET", url:`/v1/reports/financial-summary?businessId=${businessId}&from=bad&to=2026-10-02T00:00:00Z`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method:"GET", url:`/v1/reports/financial-summary?businessId=${businessId}&from=2026-10-03T00:00:00Z&to=2026-10-02T00:00:00Z`, headers })).statusCode).toBe(400);
    expect((await app.inject({ method:"GET", url:`/v1/reports/financial-summary?businessId=${businessId}&from=2025-01-01T00:00:00Z&to=2026-10-02T00:00:00Z`, headers })).statusCode).toBe(400);
    await pool.query(`UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1`,[businessId]);
    expect((await app.inject({ method:"GET", url:good, headers })).statusCode).toBe(403);
    await pool.query(`UPDATE business_memberships SET role='OWNER' WHERE business_id=$1`,[businessId]);
    await pool.query(`UPDATE businesses SET status='SUSPENDED' WHERE id=$1`,[businessId]);
    expect((await app.inject({ method:"GET", url:good, headers })).statusCode).toBe(403);
  });

  it("recognizes accepted returns before an external refund settles, without inventing cash outflow", async () => {
    const registration=await app.inject({method:"POST",url:"/v1/auth/register",payload:{displayName:"Pending Refund Owner",email:"reports-pending-refund@tradeos.test",password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"report-pending-device",appVersion:"test"}});
    const headers={authorization:`Bearer ${registration.json().session.accessToken}`};
    const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",headers,payload:{name:"Pending Refund Shop",businessType:"RETAIL_HARDWARE",branchName:"Main"}});
    const businessId=onboard.json().business.id,branchId=onboard.json().branch.id;
    const supplierId=(await app.inject({method:"POST",url:"/v1/suppliers",headers,payload:{businessId,name:"Supplier"}})).json().supplier.id;
    const catalog=await app.inject({method:"POST",url:"/v1/catalog/items",headers,payload:{businessId,name:"Returnable Item",kind:"PRODUCT",trackStock:true,stockUnitCode:"piece",units:[{code:"piece",label:"Piece",canStock:true,canPurchase:true,canSell:true,defaultSalePriceMinor:500}]}});
    const itemId=catalog.json().item.id;
    const occurredAt="2026-10-05T13:00:00Z";
    const sync=async(id:string,type:string,payload:unknown)=>{const r=await app.inject({method:"POST",url:"/v1/sync",headers,payload:{mutations:[{clientId:"report-pending-device",clientMutationId:id,businessId,branchId,mutationType:type,occurredAt,payload}]}});expect(r.statusCode).toBe(200);return r.json().mutationResults[0];};
    expect((await sync("pending-purchase","PURCHASE_RECEIVE_CREATE",{supplierId,settlementMethod:"CASH",lines:[{itemId,purchaseUnitCode:"piece",quantity:1,unitCostMinor:200}]})).status).toBe("APPLIED");
    const sale=await sync("pending-sale","SALE_CREATE",{paymentMethod:"MOMO",lines:[{itemId,saleUnitCode:"piece",quantity:1}]});
    expect(sale.status).toBe("APPLIED");
    const lineId=(await pool.query(`SELECT id FROM sale_lines WHERE sale_id=$1`,[sale.result.saleId])).rows[0].id;
    const returned=await sync("pending-return","RETURN_CREATE",{originalSaleId:sale.result.saleId,reason:"Accepted return",refundMethod:"ORIGINAL_METHOD",lines:[{saleLineId:lineId,quantity:1,disposition:"RESTOCK"}]});
    expect(returned.status).toBe("APPLIED");
    expect((await pool.query(`SELECT status FROM return_cases WHERE client_mutation_id='pending-return'`)).rows[0].status).toBe("PROCESSING");
    expect((await pool.query(`SELECT status FROM refund_transactions WHERE return_case_id=(SELECT id FROM return_cases WHERE client_mutation_id='pending-return')`)).rows[0].status).toBe("PENDING");
    const response=await app.inject({method:"GET",url:`/v1/reports/financial-summary?businessId=${businessId}&branchId=${branchId}&from=2026-10-05T00:00:00Z&to=2026-10-06T00:00:00Z`,headers});
    expect(response.statusCode).toBe(200);
    const report=response.json();
    expect(report.flow).toMatchObject({grossRevenueMinor:500,returnsRevenueMinor:500,netRevenueMinor:0,grossCogsMinor:200,cogsReversalMinor:200,netCogsMinor:0,grossProfitMinor:0,refundTotalMinor:500,returnCount:1,cashInflowMinor:500,cashOutflowMinor:200,netCashMovementMinor:300});
    expect(report.position).toMatchObject({cashBalanceMinor:300,inventoryValueMinor:200,inventoryAvailableValueMinor:200});
  });

});
