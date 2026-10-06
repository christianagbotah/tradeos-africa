import { afterAll,beforeAll,beforeEach,expect,it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { readFile } from 'node:fs/promises';
process.env.DATABASE_URL ??= 'postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci';
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query('TRUNCATE app_users,businesses CASCADE');});
afterAll(async()=>{await app.close();await pool.end();});
it('records only real money, preserves gross receipts, and backfills identical history idempotently',async()=>{
  const registered=await app.inject({method:'POST',url:'/v1/auth/register',payload:{displayName:'Owner',email:'cashbook-movements@tradeos.test',password:'TradeOS-Test-1234',platform:'WEB',deviceKey:'cashbook-movements',appVersion:'test'}});
  expect(registered.statusCode).toBe(201);
  const headers={authorization:`Bearer ${registered.json().session.accessToken}`};
  const onboard=await app.inject({method:'POST',url:'/v1/onboarding/business',headers,payload:{name:'Money Shop',businessType:'RETAIL_HARDWARE',branchName:'Main'}});
  expect(onboard.statusCode).toBe(201);
  const businessId=onboard.json().business.id,branchId=onboard.json().branch.id;
  const post=async(url:string,payload:unknown)=>{const r=await app.inject({method:'POST',url,headers,payload});expect(r.statusCode).toBe(201);return r.json();};
  const supplierId=(await post('/v1/suppliers',{businessId,name:'Supplier'})).supplier.id;
  const customerId=(await post('/v1/customers',{businessId,name:'Customer',creditLimitMinor:10000})).customer.id;
  const itemId=(await post('/v1/catalog/items',{businessId,name:'Item',kind:'PRODUCT',trackStock:true,stockUnitCode:'each',units:[{code:'each',label:'Each',canStock:true,canPurchase:true,canSell:true,defaultSalePriceMinor:1000}]})).item.id;
  const sync=async(id:string,type:string,payload:unknown)=>{
    const r=await app.inject({method:'POST',url:'/v1/sync',headers,payload:{mutations:[{businessId,branchId,clientId:'cashbook-movements',clientMutationId:id,mutationType:type,occurredAt:'2026-10-06T12:00:00Z',payload}]}});
    expect(r.statusCode).toBe(200);const result=r.json().mutationResults[0];expect(result.status,result.errorMessage).toBe('APPLIED');return result.result;
  };
  const entries=async()=> (await pool.query(`SELECT entry_type,amount_delta_minor,method,idempotency_key FROM cashbook_entries WHERE business_id=$1 ORDER BY idempotency_key`,[businessId])).rows;
  const receive=async(id:string,settlementMethod:string)=>sync(id,'PURCHASE_RECEIVE_CREATE',{supplierId,settlementMethod,lines:[{itemId,purchaseUnitCode:'each',quantity:4,unitCostMinor:300}]});
  const cashPurchase=await receive('cash-purchase','CASH');
  expect(await entries()).toHaveLength(1);
  const creditPurchase=await receive('credit-purchase','SUPPLIER_CREDIT');
  expect(await entries()).toHaveLength(1);
  await sync('supplier-payment','SUPPLIER_PAYMENT_CREATE',{supplierId,amountMinor:600,method:'BANK'});
  const sale=async(id:string,paymentMethod:string)=>sync(id,'SALE_CREATE',{customerId,paymentMethod,lines:[{itemId,saleUnitCode:'each',quantity:1}]});
  const cashSale=await sale('cash-sale','CASH');
  const beforeCredit=(await entries()).length;
  const creditSale=await sale('credit-sale','CUSTOMER_CREDIT');
  expect(await entries()).toHaveLength(beforeCredit);
  await sync('customer-payment','CUSTOMER_PAYMENT_CREATE',{customerId,amountMinor:400,method:'MOMO'});
  const refund=async(id:string,saleId:string)=>{
    const saleLineId=(await pool.query(`SELECT id FROM sale_lines WHERE sale_id=$1`,[saleId])).rows[0].id;
    await sync(id,'RETURN_CREATE',{originalSaleId:saleId,reason:'Returned',refundMethod:'ORIGINAL_METHOD',lines:[{saleLineId,quantity:1,disposition:'RESTOCK'}]});
  };
  await refund('cash-refund',cashSale.saleId);
  const beforeCreditRefund=(await entries()).length;
  await refund('credit-refund',creditSale.saleId);
  expect(await entries()).toHaveLength(beforeCreditRefund);
  const purchaseReturn=async(id:string,purchaseId:string,recoveryMethod:string)=>{
    const purchaseLineId=(await pool.query(`SELECT id FROM purchase_lines WHERE purchase_id=$1`,[purchaseId])).rows[0].id;
    await sync(id,'PURCHASE_RETURN_CREATE',{originalPurchaseId:purchaseId,supplierId,recoveryMethod,lines:[{purchaseLineId,quantity:1,sourceLocation:'AVAILABLE'}]});
  };
  await purchaseReturn('cash-recovery',cashPurchase.purchaseId,'CARD');
  const beforeCreditNote=(await entries()).length;
  await purchaseReturn('credit-note',creditPurchase.purchaseId,'CREDIT_NOTE');
  expect(await entries()).toHaveLength(beforeCreditNote);
  const rows=await entries();
  expect(rows.map(r=>[r.entry_type,Number(r.amount_delta_minor),r.method]).sort()).toEqual([
    ['PURCHASE_PAYMENT',-1200,'CASH'],['SUPPLIER_PAYMENT',-600,'BANK'],['SALE_RECEIPT',1000,'CASH'],['CUSTOMER_PAYMENT',400,'MOMO'],['SALE_REFUND',-1000,'CASH'],['PURCHASE_RETURN_RECOVERY',300,'CARD'],
  ].sort());
  const result=await app.inject({method:'GET',url:`/v1/cashbook?businessId=${businessId}&branchId=${branchId}`,headers});
  expect(result.statusCode).toBe(200);
  expect(result.json().summary).toMatchObject({inflowMinor:1700,outflowMinor:2800,netMinor:-1100,byMethod:{CASH:{inflowMinor:1000,outflowMinor:2200,netMinor:-1200},BANK:{inflowMinor:0,outflowMinor:600,netMinor:-600},MOMO:{inflowMinor:400,outflowMinor:0,netMinor:400},CARD:{inflowMinor:300,outflowMinor:0,netMinor:300}}});
  // Run the migration's backfill against source history after removing only derived entries.
  const migration=await readFile(new URL('../../../packages/db/migrations/0008_cashbook_expenses.sql',import.meta.url),'utf8');
  const backfill=migration.slice(migration.indexOf('INSERT INTO cashbook_entries')) .replace(/COMMIT;\s*$/,'')
    .replaceAll('idempotency_key,occurred_at)', 'idempotency_key,occurred_at,money_account_id)')
    .replaceAll('SELECT * FROM (SELECT', 'SELECT movement.*,d.money_account_id FROM (SELECT')
    .replaceAll(') movement WHERE method IN', ') movement JOIN money_account_defaults d ON d.business_id=movement.business_id AND d.branch_id=movement.branch_id AND d.method=movement.method WHERE movement.method IN');
  await pool.query('DELETE FROM cashbook_entries WHERE business_id=$1',[businessId]);
  for (let replay=0;replay<2;replay++) for (const statement of backfill.split(";").filter(sql=>sql.trim())) await pool.query(statement);
  expect(await entries()).toEqual(rows);
});
