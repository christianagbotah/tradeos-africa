import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { applyPurchaseReturnMutation } from "../src/commerce/purchase-returns.js";
process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("purchase returns", () => {
 it("returns original units from either location, values current cost and preserves signed supplier credit", async () => {
  const registration = await app.inject({method:"POST",url:"/v1/auth/register",payload:{displayName:"Buyer",email:"returns@tradeos.test",password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"return-device",appVersion:"test"}});
  expect(registration.statusCode).toBe(201);
  const headers = {authorization:`Bearer ${registration.json().session.accessToken}`};
  const onboard = await app.inject({method:"POST",url:"/v1/onboarding/business",headers,payload:{name:"Return Shop",businessType:"DRINKING_SPOT",branchName:"Main"}});
  expect(onboard.statusCode).toBe(201);
  const businessId = onboard.json().business.id, branchId = onboard.json().branch.id;
  const supplier = await app.inject({method:"POST",url:"/v1/suppliers",headers,payload:{businessId,name:"Bottle Supplier"}});
  expect(supplier.statusCode).toBe(201);
  const supplierId = supplier.json().supplier.id;
  const catalog = await app.inject({method:"POST",url:"/v1/catalog/items",headers,payload:{businessId,name:"Whisky",kind:"PRODUCT",trackStock:true,stockUnitCode:"ml",units:[{code:"ml",label:"ml",canStock:true},{code:"bottle",label:"Bottle",canPurchase:true,canSell:true,defaultSalePriceMinor:20000}],conversions:[{fromUnitCode:"bottle",toUnitCode:"ml",factor:750}]}});
  expect(catalog.statusCode).toBe(201);
  const itemId = catalog.json().item.id;
  const actor = (await pool.query(`SELECT staff_id FROM business_memberships WHERE business_id=$1`,[businessId])).rows[0].staff_id;
  const sync = async (id:string,type:string,payload:unknown,branch=branchId) => {
   const response = await app.inject({method:"POST",url:"/v1/sync",headers,payload:{mutations:[{clientId:"return-device",clientMutationId:id,businessId,branchId:branch,mutationType:type,occurredAt:new Date().toISOString(),payload}]}});
   expect(response.statusCode).toBe(200); return response.json().mutationResults[0];
  };
  const receive = async(id:string,quantity:number,cost:number,method="SUPPLIER_CREDIT")=>sync(id,"PURCHASE_RECEIVE_CREATE",{supplierId,settlementMethod:method,lines:[{itemId,purchaseUnitCode:"bottle",quantity,unitCostMinor:cost}]});
  const receipt = await receive("original",2,15000);
  expect(receipt.status).toBe("APPLIED");
  const purchaseId = receipt.result.purchaseId;
  const detail = async()=>app.inject({method:"GET",url:`/v1/purchases/${purchaseId}?businessId=${businessId}`,headers});
  const originalDetail = await detail();
  expect(originalDetail.statusCode).toBe(200);
  expect(originalDetail.json().lines[0]).toMatchObject({purchaseQuantity:2,stockQuantity:1500,returnedQuantity:0,remainingQuantity:2});
  const purchaseLineId = originalDetail.json().lines[0].id;
  const spoof = "00000000-0000-4000-8000-000000000000";
  const payload = {originalPurchaseId:purchaseId,supplierId,returnedByStaffId:spoof,recoveryMethod:"CREDIT_NOTE" as const,lines:[{purchaseLineId,quantity:0.5,sourceLocation:"AVAILABLE" as const}]};
  const returned = await sync("first-return","PURCHASE_RETURN_CREATE",payload);
  expect(returned.status).toBe("APPLIED");
  expect(returned.result).toMatchObject({supplierRecoveryMinor:7500,inventoryValueRemovedMinor:7500,purchasePriceVarianceMinor:0});
  expect((await sync("first-return","PURCHASE_RETURN_CREATE",payload)).status).toBe("APPLIED");
  const replay = await applyPurchaseReturnMutation(pool,{businessId,branchId,clientMutationId:"first-return",occurredAt:new Date().toISOString()},{...payload,returnedByStaffId:actor});
  expect(replay.idempotentReplay).toBe(true);
  expect(Number((await pool.query(`SELECT COUNT(*) FROM purchase_return_cases`)).rows[0].count)).toBe(1);
  const balance = async()=>Number((await pool.query(`SELECT COALESCE(SUM(balance_delta_minor),0) AS balance FROM supplier_payable_ledger WHERE supplier_id=$1`,[supplierId])).rows[0].balance);
  expect(await balance()).toBe(22500);
  const valuation = async(location:string)=>(await pool.query(`SELECT quantity,value_minor FROM inventory_valuations WHERE item_id=$1 AND location_type=$2`,[itemId,location])).rows[0];
  expect(await valuation("AVAILABLE")).toMatchObject({quantity:"1125.00000000",value_minor:"22500"});
  const firstLine = (await pool.query(`SELECT * FROM purchase_return_lines`)).rows[0];
  expect(firstLine).toMatchObject({purchase_quantity:"0.50000000",stock_quantity:"375.00000000",supplier_recovery_minor:"7500",inventory_value_removed_minor:"7500",purchase_price_variance_minor:"0"});
  expect((await pool.query(`SELECT returned_by_staff_id FROM purchase_return_cases`)).rows[0].returned_by_staff_id).toBe(actor);
  expect((await pool.query(`SELECT quantity_delta,actor_staff_id FROM inventory_movements WHERE reason='PURCHASE_RETURN'`)).rows[0]).toMatchObject({quantity_delta:"-375.00000000",actor_staff_id:actor});
  expect((await sync("over-original","PURCHASE_RETURN_CREATE",{...payload,lines:[{...payload.lines[0],quantity:2.1}]})).errorCode).toBe("PURCHASE_OVER_RETURN");
  expect((await sync("over-remaining","PURCHASE_RETURN_CREATE",{...payload,lines:[{...payload.lines[0],quantity:1.6}]})).errorCode).toBe("PURCHASE_OVER_RETURN");
  expect((await sync("wrong-branch","PURCHASE_RETURN_CREATE",payload,spoof)).status).toBe("REJECTED");
  expect((await sync("wrong-supplier","PURCHASE_RETURN_CREATE",{...payload,supplierId:spoof})).status).toBe("REJECTED");
  expect((await sync("no-quarantine","PURCHASE_RETURN_CREATE",{...payload,lines:[{...payload.lines[0],sourceLocation:"QUARANTINE"}]})).status).toBe("REJECTED");
  // Change moving average before creating quarantined stock via a customer return.
  const higherCost = await receive("higher-cost",1,30000,"CASH");
  expect(higherCost.status).toBe("APPLIED");
  const sale = await sync("sale","SALE_CREATE",{paymentMethod:"CASH",lines:[{itemId,saleUnitCode:"bottle",quantity:0.5}]});
  expect(sale.status).toBe("APPLIED");
  const saleLineId = (await pool.query(`SELECT id FROM sale_lines WHERE sale_id=$1`,[sale.result.saleId])).rows[0].id;
  expect((await sync("quarantine","RETURN_CREATE",{originalSaleId:sale.result.saleId,reason:"Return stock",refundMethod:"ORIGINAL_METHOD",lines:[{saleLineId,quantity:0.5,disposition:"QUARANTINE"}]})).status).toBe("APPLIED");
  await pool.query(`UPDATE item_unit_conversions SET factor=1000 WHERE item_id=$1 AND from_unit_code='bottle' AND to_unit_code='ml'`,[itemId]);
  const second = await sync("second-return","PURCHASE_RETURN_CREATE",{...payload,lines:[{...payload.lines[0],sourceLocation:"QUARANTINE"}]});
  expect(second.status).toBe("APPLIED");
  expect(second.result).toMatchObject({supplierRecoveryMinor:7500,inventoryValueRemovedMinor:10500,purchasePriceVarianceMinor:-3000});
  const secondLine=(await pool.query(`SELECT * FROM purchase_return_lines WHERE return_case_id=$1`,[second.result.returnCaseId])).rows[0];
  expect(secondLine).toMatchObject({source_location:"QUARANTINE",stock_quantity:"375.00000000",supplier_recovery_minor:"7500",inventory_value_removed_minor:"10500",purchase_price_variance_minor:"-3000"});
  expect(await valuation("QUARANTINE")).toMatchObject({quantity:"0.00000000",value_minor:"0"});
  expect(await balance()).toBe(15000);
  expect((await sync("pay","SUPPLIER_PAYMENT_CREATE",{supplierId,amountMinor:15000,method:"BANK"})).status).toBe("APPLIED");
  expect(await balance()).toBe(0);
  expect((await sync("third-return","PURCHASE_RETURN_CREATE",payload)).status).toBe("APPLIED");
  expect(await balance()).toBe(-7500);
  expect((await sync("negative-payment","SUPPLIER_PAYMENT_CREATE",{supplierId,amountMinor:1,method:"CASH"})).errorCode).toBe("SUPPLIER_OVERPAYMENT");
  expect((await sync("cash-return","PURCHASE_RETURN_CREATE",{...payload,recoveryMethod:"CASH"})).status).toBe("APPLIED");
  expect(await balance()).toBe(-7500);
  expect((await detail()).json().lines[0]).toMatchObject({returnedQuantity:2,remainingQuantity:0,returnedRecoveryMinor:30000});
  expect((await sync("exhausted","PURCHASE_RETURN_CREATE",payload)).errorCode).toBe("PURCHASE_OVER_RETURN");
  expect(await valuation("AVAILABLE")).toMatchObject({quantity:"750.00000000",value_minor:"21000"});
  expect(Number((await pool.query(`SELECT SUM(quantity_delta) AS quantity FROM inventory_movements WHERE item_id=$1`,[itemId])).rows[0].quantity)).toBe(750);
  const credit = await receive("signed-credit",3,1);
  expect(credit.status).toBe("APPLIED"); expect(await balance()).toBe(-7497);
  const tinyLine = (await pool.query(`SELECT id FROM purchase_lines WHERE purchase_id=$1`,[credit.result.purchaseId])).rows[0].id;
  // Rounded partial recoveries telescope to the exact original three minor units.
  const results=[];
  for (const [index,quantity] of [0.5,0.5,2].entries()) {
   const result=await sync(`rounded-${index}`,"PURCHASE_RETURN_CREATE",{...payload,originalPurchaseId:credit.result.purchaseId,recoveryMethod:"CASH",lines:[{purchaseLineId:tinyLine,quantity,sourceLocation:"AVAILABLE"}]});
   expect(result.status).toBe("APPLIED"); results.push(result.result.supplierRecoveryMinor);
  }
  expect(results).toEqual([1,0,2]); expect(await balance()).toBe(-7497);
  expect((await app.inject({method:"GET",url:`/v1/purchases/${purchaseId}?businessId=${businessId}`})).statusCode).toBe(401);
  expect((await app.inject({method:"GET",url:`/v1/purchases/${purchaseId}?businessId=${spoof}`,headers})).statusCode).toBe(403);
  const higherCostLine = (await pool.query(`SELECT id FROM purchase_lines WHERE purchase_id=$1`,[higherCost.result.purchaseId])).rows[0].id;
  const rolePayload = {...payload,originalPurchaseId:higherCost.result.purchaseId,recoveryMethod:"CASH",lines:[{purchaseLineId:higherCostLine,quantity:0.01,sourceLocation:"AVAILABLE"}]};
  for (const role of ["OWNER","ADMIN","MANAGER","INVENTORY","ACCOUNTANT"]) {
   await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1`,[businessId,role]);
   expect((await sync(`role-${role}`,"PURCHASE_RETURN_CREATE",rolePayload)).status).toBe("APPLIED");
  }
  await pool.query(`UPDATE business_memberships SET role='INVENTORY' WHERE business_id=$1`,[businessId]);
  const roleRequest = (type:string,id:string,body:unknown)=>app.inject({method:"POST",url:"/v1/sync",headers,payload:{mutations:[{clientId:"return-device",clientMutationId:id,businessId,branchId,mutationType:type,occurredAt:new Date().toISOString(),payload:body}]}});
  expect((await roleRequest("SUPPLIER_PAYMENT_CREATE","inventory-payment",{supplierId,amountMinor:1,method:"CASH"})).statusCode).toBe(403);
  await pool.query(`UPDATE business_memberships SET role='VIEWER' WHERE business_id=$1`,[businessId]);
  expect((await roleRequest("PURCHASE_RETURN_CREATE","viewer-return",rolePayload)).statusCode).toBe(403);
  await pool.query(`UPDATE business_memberships SET role='OWNER' WHERE business_id=$1`,[businessId]);
  const concurrentPayload={...rolePayload,lines:[{...rolePayload.lines[0],quantity:0.6}]};
  const concurrent=await Promise.all([sync("concurrent-return-1","PURCHASE_RETURN_CREATE",concurrentPayload),sync("concurrent-return-2","PURCHASE_RETURN_CREATE",concurrentPayload)]);
  expect(concurrent.map(result=>result.status).sort()).toEqual(["APPLIED","REJECTED"]);
  expect(concurrent.find(result=>result.status==="REJECTED").errorCode).toBe("PURCHASE_OVER_RETURN");

 });
});
