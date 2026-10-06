import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
let sequence = 0;

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); sequence = 0; });
afterAll(async () => { await app.close(); await pool.end(); });

describe("cash forecast report", () => {
  it("returns a flat LOW-confidence forecast and validates horizon, branch and report roles", async () => {
    const owner = await register("forecast-empty@tradeos.test", "forecast-empty-device");
    const business = await createBusiness(owner.accessToken, "Empty Forecast");

    const response = await forecast(owner.accessToken, business.businessId, business.branchId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      businessId: business.businessId,
      branchId: business.branchId,
      timezone: "Africa/Accra",
      currencyCode: "GHS",
      horizonDays: 30,
      summary: { openingCashMinor: 0, projectedClosingCashMinor: 0, firstNegativeCashDate: null },
      confidence: { level: "LOW", historyDaysAvailable: 0, sameWeekdayCoverageDays: 0, openCustomerObligationCount: 0, openSupplierObligationCount: 0 },
    });
    expect(response.json().days).toHaveLength(30);
    expect(response.json().days.every((day: { openingCashMinor: number; closingCashMinor: number; baselineMethod: string }) => day.openingCashMinor === 0 && day.closingCashMinor === 0 && day.baselineMethod === "NONE")).toBe(true);

    expect((await forecast(owner.accessToken, business.businessId, business.branchId, 1)).statusCode).toBe(200);
    expect((await forecast(owner.accessToken, business.businessId, business.branchId, 30)).statusCode).toBe(200);
    for (const days of ["0", "31", "1.5", "abc"]) {
      expect((await app.inject({ method:"GET", url:`/v1/reports/cash-forecast?businessId=${business.businessId}&branchId=${business.branchId}&days=${days}`, headers:bearer(owner.accessToken) })).statusCode).toBe(400);
    }
    expect((await app.inject({ method:"GET", url:`/v1/reports/cash-forecast?businessId=bad&branchId=${business.branchId}`, headers:bearer(owner.accessToken) })).statusCode).toBe(400);
    expect((await app.inject({ method:"GET", url:`/v1/reports/cash-forecast?businessId=${business.businessId}&branchId=bad`, headers:bearer(owner.accessToken) })).statusCode).toBe(400);
    expect((await forecast(owner.accessToken, business.businessId, "00000000-0000-4000-8000-000000000000", 3)).statusCode).toBe(404);

    await pool.query(`UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1`, [business.businessId]);
    expect((await forecast(owner.accessToken, business.businessId, business.branchId, 3)).statusCode).toBe(403);
    await pool.query(`UPDATE business_memberships SET role='OWNER' WHERE business_id=$1`, [business.businessId]);
    await pool.query(`UPDATE businesses SET status='SUSPENDED' WHERE id=$1`, [business.businessId]);
    expect((await forecast(owner.accessToken, business.businessId, business.branchId, 3)).statusCode).toBe(403);
  });

  it("opens from authoritative cash and excludes capital/manual/current-day movements from the behavioral baseline", async () => {
    const owner = await register("forecast-history@tradeos.test", "forecast-history-device");
    const business = await createBusiness(owner.accessToken, "History Forecast");
    const today = await localToday("Africa/Accra");
    const accountId = await cashAccount(business.businessId, business.branchId);

    await seedOperatingHistory(business.businessId, business.branchId, accountId, addDays(today, -28), addDays(today, -1), 100, 40);
    await insertCash(business.businessId, business.branchId, accountId, 500, "OPENING_BALANCE", `${addDays(today,-20)}T08:00:00.000Z`);
    await insertCash(business.businessId, business.branchId, accountId, 1000, "OWNER_INJECTION", `${addDays(today,-10)}T08:00:00.000Z`);
    await insertCash(business.businessId, business.branchId, accountId, -200, "OWNER_WITHDRAWAL", `${addDays(today,-9)}T08:00:00.000Z`);
    await insertCash(business.businessId, business.branchId, accountId, -100, "ADJUSTMENT", `${addDays(today,-8)}T08:00:00.000Z`);
    await insertCash(business.businessId, business.branchId, accountId, 999, "SALE_RECEIPT", `${today}T12:00:00.000Z`);

    const response = await forecast(owner.accessToken, business.businessId, business.branchId, 1);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.openingCashMinor).toBe(2880);
    expect(body.confidence).toMatchObject({ level:"MEDIUM", historyDaysAvailable:28, sameWeekdayCoverageDays:4 });
    expect(body.days[0]).toMatchObject({
      openingCashMinor:2880,
      baselineInflowsMinor:100,
      baselineOutflowsMinor:40,
      baselineMethod:"WEEKDAY_MEDIAN",
      closingCashMinor:2940,
    });
  });

  it("uses the overall median with fourteen completed days and reports projected negative cash", async () => {
    const owner = await register("forecast-overall@tradeos.test", "forecast-overall-device");
    const business = await createBusiness(owner.accessToken, "Overall Forecast");
    const today = await localToday("Africa/Accra");
    const accountId = await cashAccount(business.businessId, business.branchId);
    await seedOperatingHistory(business.businessId, business.branchId, accountId, addDays(today, -14), addDays(today, -1), 100, 40);
    await insertCash(business.businessId, business.branchId, accountId, -1000, "OWNER_WITHDRAWAL", `${addDays(today,-1)}T15:00:00.000Z`);

    const response = await forecast(owner.accessToken, business.businessId, business.branchId, 2);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.confidence).toMatchObject({ level:"MEDIUM",historyDaysAvailable:14,sameWeekdayCoverageDays:2 });
    expect(body.days.map((day:{baselineMethod:string;baselineInflowsMinor:number;baselineOutflowsMinor:number}) => [day.baselineMethod,day.baselineInflowsMinor,day.baselineOutflowsMinor])).toEqual([
      ["OVERALL_MEDIAN",100,40],
      ["OVERALL_MEDIAN",100,40],
    ]);
    expect(body.summary).toMatchObject({ openingCashMinor:-160,firstNegativeCashDate:today,lowestProjectedCashMinor:-100,lowestProjectedCashDate:today,projectedClosingCashMinor:-40 });
  });

  it("projects reduced open obligations, rolls overdue balances to day one and chains balances exactly", async () => {
    const owner = await register("forecast-obligations@tradeos.test", "forecast-obligation-device");
    const business = await createBusiness(owner.accessToken, "Obligation Forecast");
    const today = await localToday("Africa/Accra");
    const service5000 = await createService(owner.accessToken, business.businessId, "Forecast Service 5000", 5000);
    const service1000 = await createService(owner.accessToken, business.businessId, "Forecast Service 1000", 1000);
    const product = await createProduct(owner.accessToken, business.businessId);

    const futureCustomer = await createCustomer(owner.accessToken, business.businessId, "Future Customer", 20_000, 10);
    expect((await sync(owner.accessToken, "forecast-obligation-device", "future-sale", business, "SALE_CREATE", `${addDays(today,-5)}T10:00:00.000Z`, { customerId:futureCustomer,paymentMethod:"CUSTOMER_CREDIT",lines:[{itemId:service5000,quantity:1,saleUnitCode:"service"}] })).status).toBe("APPLIED");
    expect((await sync(owner.accessToken, "forecast-obligation-device", "future-customer-payment", business, "CUSTOMER_PAYMENT_CREATE", `${addDays(today,-1)}T10:00:00.000Z`, { customerId:futureCustomer,amountMinor:2000,method:"CASH" })).status).toBe("APPLIED");

    const overdueCustomer = await createCustomer(owner.accessToken, business.businessId, "Overdue Customer", 20_000, 0);
    expect((await sync(owner.accessToken, "forecast-obligation-device", "overdue-sale", business, "SALE_CREATE", `${addDays(today,-2)}T10:00:00.000Z`, { customerId:overdueCustomer,paymentMethod:"CUSTOMER_CREDIT",lines:[{itemId:service1000,quantity:1,saleUnitCode:"service"}] })).status).toBe("APPLIED");

    const futureSupplier = await createSupplier(owner.accessToken, business.businessId, "Future Supplier", 10);
    expect((await sync(owner.accessToken, "forecast-obligation-device", "future-purchase", business, "PURCHASE_RECEIVE_CREATE", `${addDays(today,-5)}T11:00:00.000Z`, { supplierId:futureSupplier,settlementMethod:"SUPPLIER_CREDIT",lines:[{itemId:product,purchaseUnitCode:"piece",quantity:1,unitCostMinor:2000}] })).status).toBe("APPLIED");
    expect((await sync(owner.accessToken, "forecast-obligation-device", "future-supplier-payment", business, "SUPPLIER_PAYMENT_CREATE", `${addDays(today,-1)}T11:00:00.000Z`, { supplierId:futureSupplier,amountMinor:500,method:"CASH" })).status).toBe("APPLIED");

    const overdueSupplier = await createSupplier(owner.accessToken, business.businessId, "Overdue Supplier", 0);
    expect((await sync(owner.accessToken, "forecast-obligation-device", "overdue-purchase", business, "PURCHASE_RECEIVE_CREATE", `${addDays(today,-2)}T11:00:00.000Z`, { supplierId:overdueSupplier,settlementMethod:"SUPPLIER_CREDIT",lines:[{itemId:product,purchaseUnitCode:"piece",quantity:1,unitCostMinor:700}] })).status).toBe("APPLIED");

    const response = await forecast(owner.accessToken, business.businessId, business.branchId, 10);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toMatchObject({
      openingCashMinor:1500,
      totalContractualInflowsMinor:4000,
      totalContractualOutflowsMinor:2200,
      overdueReceivablesMinor:1000,
      overduePayablesMinor:700,
    });
    expect(body.confidence).toMatchObject({ openCustomerObligationCount:2,openSupplierObligationCount:2,level:"LOW" });
    expect(body.days[0]).toMatchObject({ contractualInflowsMinor:1000,overdueContractualInflowsMinor:1000,contractualOutflowsMinor:700,overdueContractualOutflowsMinor:700 });
    const dueDay = body.days.find((day: {date:string}) => day.date === addDays(today,5));
    expect(dueDay).toMatchObject({ contractualInflowsMinor:3000,contractualOutflowsMinor:1500,customerObligationCount:1,supplierObligationCount:1 });
    for (let index=1; index<body.days.length; index += 1) expect(body.days[index].openingCashMinor).toBe(body.days[index-1].closingCashMinor);
  });

  it("keeps branch cash isolated while whole-business forecasts aggregate active branches", async () => {
    const owner = await register("forecast-branches@tradeos.test", "forecast-branch-device");
    const business = await createBusiness(owner.accessToken, "Branch Forecast");
    const second = await pool.query<{id:string}>(`INSERT INTO branches (business_id,name,code,timezone) VALUES ($1,'Second','SECOND','Africa/Accra') RETURNING id`,[business.businessId]);
    const secondBranchId = second.rows[0]!.id;
    const today = await localToday("Africa/Accra");
    await insertCash(business.businessId,business.branchId,await cashAccount(business.businessId,business.branchId),100,"SALE_RECEIPT",`${addDays(today,-1)}T09:00:00.000Z`);
    await insertCash(business.businessId,secondBranchId,await cashAccount(business.businessId,secondBranchId),200,"SALE_RECEIPT",`${addDays(today,-1)}T09:00:00.000Z`);

    const branch = await forecast(owner.accessToken,business.businessId,business.branchId,1);
    const all = await forecast(owner.accessToken,business.businessId,null,1);
    expect(branch.statusCode).toBe(200); expect(all.statusCode).toBe(200);
    expect(branch.json().summary.openingCashMinor).toBe(100);
    expect(all.json().summary.openingCashMinor).toBe(300);
  });

  it("uses branch-local calendar dates and excludes obligations exactly at the horizon end", async () => {
    const owner = await register("forecast-timezone@tradeos.test", "forecast-timezone-device");
    const business = await createBusiness(owner.accessToken, "Timezone Forecast");
    await pool.query(`UPDATE branches SET timezone='Pacific/Kiritimati' WHERE id=$1`,[business.branchId]);
    const localStart = await localToday("Pacific/Kiritimati");
    const service = await createService(owner.accessToken,business.businessId,"Timezone Service",1000);
    const insideCustomer = await createCustomer(owner.accessToken,business.businessId,"Inside Customer",5000,30);
    const boundaryCustomer = await createCustomer(owner.accessToken,business.businessId,"Boundary Customer",5000,30);
    const occurredAt = `${addDays(await localToday("Africa/Accra"),-5)}T00:00:00.000Z`;
    expect((await sync(owner.accessToken,"forecast-timezone-device","inside-sale",business,"SALE_CREATE",occurredAt,{customerId:insideCustomer,paymentMethod:"CUSTOMER_CREDIT",lines:[{itemId:service,quantity:1,saleUnitCode:"service"}]})).status).toBe("APPLIED");
    expect((await sync(owner.accessToken,"forecast-timezone-device","boundary-sale",business,"SALE_CREATE",occurredAt,{customerId:boundaryCustomer,paymentMethod:"CUSTOMER_CREDIT",lines:[{itemId:service,quantity:1,saleUnitCode:"service"}]})).status).toBe("APPLIED");
    await pool.query(`UPDATE customer_credit_obligations SET due_at=((($2::date + 1) + time '00:30') AT TIME ZONE 'Pacific/Kiritimati') WHERE business_id=$1 AND customer_id=$3`,[business.businessId,localStart,insideCustomer]);
    await pool.query(`UPDATE customer_credit_obligations SET due_at=((($2::date + 3) + time '00:00') AT TIME ZONE 'Pacific/Kiritimati') WHERE business_id=$1 AND customer_id=$3`,[business.businessId,localStart,boundaryCustomer]);

    const response = await forecast(owner.accessToken,business.businessId,business.branchId,3);
    expect(response.statusCode).toBe(200);
    const body=response.json();
    expect(body.timezone).toBe("Pacific/Kiritimati");
    expect(body.days.map((day:{date:string})=>day.date)).toEqual([localStart,addDays(localStart,1),addDays(localStart,2)]);
    expect(body.days[1]).toMatchObject({contractualInflowsMinor:1000,customerObligationCount:1});
    expect(body.summary.totalContractualInflowsMinor).toBe(1000);
    expect(body.confidence.openCustomerObligationCount).toBe(2);
  });

  it("maps unsafe bigint cash to REPORT_OVERFLOW instead of returning imprecise money", async () => {
    const owner = await register("forecast-overflow@tradeos.test", "forecast-overflow-device");
    const business = await createBusiness(owner.accessToken,"Overflow Forecast");
    const today=await localToday("Africa/Accra");
    await insertCash(business.businessId,business.branchId,await cashAccount(business.businessId,business.branchId),"9007199254740992","OWNER_INJECTION",`${addDays(today,-1)}T09:00:00.000Z`);
    const response=await forecast(owner.accessToken,business.businessId,business.branchId,1);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({error:"REPORT_OVERFLOW"});
  });
});

async function register(email:string,deviceKey:string){
  const response=await app.inject({method:"POST",url:"/v1/auth/register",payload:{displayName:"Forecast Owner",email,password:"TradeOS-Test-1234",platform:"WEB",deviceKey,appVersion:"test"}});
  expect(response.statusCode).toBe(201); return response.json<{session:{accessToken:string}}>().session;
}
async function createBusiness(accessToken:string,name:string){
  const response=await app.inject({method:"POST",url:"/v1/onboarding/business",headers:bearer(accessToken),payload:{name,businessType:"SERVICES",branchName:"Main"}});
  expect(response.statusCode).toBe(201); const body=response.json<{business:{id:string};branch:{id:string}}>(); return {businessId:body.business.id,branchId:body.branch.id};
}
async function createService(accessToken:string,businessId:string,name:string,priceMinor:number){
  const response=await app.inject({method:"POST",url:"/v1/catalog/items",headers:bearer(accessToken),payload:{businessId,name,kind:"SERVICE",units:[{code:"service",label:"Service",canSell:true,defaultSalePriceMinor:priceMinor}]}});
  expect(response.statusCode).toBe(201); return response.json<{item:{id:string}}>().item.id;
}
async function createProduct(accessToken:string,businessId:string){
  const response=await app.inject({method:"POST",url:"/v1/catalog/items",headers:bearer(accessToken),payload:{businessId,name:"Forecast Product",kind:"PRODUCT",trackStock:true,stockUnitCode:"piece",units:[{code:"piece",label:"Piece",canStock:true,canPurchase:true,canSell:true,defaultSalePriceMinor:3000}]}});
  expect(response.statusCode).toBe(201); return response.json<{item:{id:string}}>().item.id;
}
async function createCustomer(accessToken:string,businessId:string,name:string,creditLimitMinor:number,creditTermsDays:number){
  const response=await app.inject({method:"POST",url:"/v1/customers",headers:bearer(accessToken),payload:{businessId,name,creditLimitMinor,creditTermsDays}});
  expect(response.statusCode).toBe(201); return response.json<{customer:{id:string}}>().customer.id;
}
async function createSupplier(accessToken:string,businessId:string,name:string,paymentTermsDays:number){
  const response=await app.inject({method:"POST",url:"/v1/suppliers",headers:bearer(accessToken),payload:{businessId,name,paymentTermsDays}});
  expect(response.statusCode).toBe(201); return response.json<{supplier:{id:string}}>().supplier.id;
}
async function sync(accessToken:string,clientId:string,clientMutationId:string,business:{businessId:string;branchId:string},mutationType:string,occurredAt:string,payload:unknown){
  const response=await app.inject({method:"POST",url:"/v1/sync",headers:bearer(accessToken),payload:{mutations:[{clientId,clientMutationId,businessId:business.businessId,branchId:business.branchId,mutationType,occurredAt,payload}]}});
  expect(response.statusCode).toBe(200); return response.json<{mutationResults:Array<{status:string;errorCode?:string;result?:unknown}>}>().mutationResults[0]!;
}
function forecast(accessToken:string,businessId:string,branchId:string|null,days?:number){
  const query=new URLSearchParams({businessId}); if(branchId) query.set("branchId",branchId); if(days!==undefined) query.set("days",String(days));
  return app.inject({method:"GET",url:`/v1/reports/cash-forecast?${query}`,headers:bearer(accessToken)});
}
async function localToday(timezone:string){
  const result=await pool.query<{day:string}>(`SELECT (now() AT TIME ZONE $1)::date::text AS day`,[timezone]); return result.rows[0]!.day;
}
function addDays(date:string,days:number){ const [y,m,d]=date.split("-").map(Number); return new Date(Date.UTC(y!,m!-1,d!+days)).toISOString().slice(0,10); }
async function cashAccount(businessId:string,branchId:string){
  const result=await pool.query<{id:string}>(`SELECT id FROM money_accounts WHERE business_id=$1 AND branch_id=$2 AND method='CASH' AND active=true ORDER BY created_at,id LIMIT 1`,[businessId,branchId]);
  expect(result.rows[0]?.id).toBeTruthy(); return result.rows[0]!.id;
}
async function insertCash(businessId:string,branchId:string,moneyAccountId:string,amount:number|string,entryType:string,occurredAt:string){
  sequence += 1;
  await pool.query(`INSERT INTO cashbook_entries (business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,idempotency_key,occurred_at,money_account_id) VALUES ($1,$2,$3,'GHS','CASH',$4,'FORECAST_TEST',gen_random_uuid(),$5,$6,$7)`,[businessId,branchId,String(amount),entryType,`forecast-test-${sequence}`,occurredAt,moneyAccountId]);
}
async function seedOperatingHistory(businessId:string,branchId:string,moneyAccountId:string,fromDate:string,toDate:string,inflowMinor:number,outflowMinor:number){
  await pool.query(`
    INSERT INTO cashbook_entries (business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,idempotency_key,occurred_at,money_account_id)
    SELECT $1::uuid,$2::uuid,$3::bigint,'GHS','CASH','SALE_RECEIPT','FORECAST_TEST',gen_random_uuid(),'forecast-in-'||d::date::text,((d::date + time '10:00') AT TIME ZONE 'Africa/Accra'),$6::uuid
    FROM generate_series($4::date,$5::date,interval '1 day') d
    UNION ALL
    SELECT $1::uuid,$2::uuid,-$7::bigint,'GHS','CASH','EXPENSE','FORECAST_TEST',gen_random_uuid(),'forecast-out-'||d::date::text,((d::date + time '11:00') AT TIME ZONE 'Africa/Accra'),$6::uuid
    FROM generate_series($4::date,$5::date,interval '1 day') d
  `,[businessId,branchId,inflowMinor,fromDate,toDate,moneyAccountId,outflowMinor]);
}
function bearer(accessToken:string){ return {authorization:`Bearer ${accessToken}`}; }
