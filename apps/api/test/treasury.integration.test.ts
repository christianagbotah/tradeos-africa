import { randomUUID } from 'node:crypto';
import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPool,withTransaction } from '../src/db.js';
import { recordCashbookEntry } from '../src/commerce/cashbook.js';
import { applyTreasuryMutation } from '../src/commerce/treasury.js';
process.env.DATABASE_URL ??= 'postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci';
const pool=createPool(),app=buildApp(pool);
beforeAll(()=>app.ready());beforeEach(async()=>{await pool.query('TRUNCATE app_users,businesses CASCADE');});afterAll(async()=>{await app.close();await pool.end();});
async function fixture(){
 const registration=await app.inject({method:'POST',url:'/v1/auth/register',payload:{displayName:'Treasury Owner',email:'treasury@test.example',password:'TradeOS-Test-1234',platform:'WEB',deviceKey:'treasury-device',appVersion:'test'}});expect(registration.statusCode).toBe(201);
 const headers={authorization:`Bearer ${registration.json().session.accessToken}`};
 const onboard=await app.inject({method:'POST',url:'/v1/onboarding/business',headers,payload:{name:'Treasury',businessType:'RETAIL_HARDWARE',branchName:'Main'}});expect(onboard.statusCode).toBe(201);
 const businessId=onboard.json().business.id,branchId=onboard.json().branch.id;
 const actor=(await pool.query('SELECT staff_id FROM business_memberships WHERE business_id=$1',[businessId])).rows[0].staff_id;
 const accounts=(await app.inject({method:'GET',url:`/v1/money-accounts?businessId=${businessId}`,headers})).json().accounts;
 const cash=accounts.find((a:{method:string})=>a.method==='CASH').id,bank=accounts.find((a:{method:string})=>a.method==='BANK').id;
 const context={businessId,branchId,clientMutationId:'direct',occurredAt:'2026-01-01T12:00:00Z'};
 const sync=async(key:string,type:string,payload:unknown,branch=branchId)=>{const r=await app.inject({method:'POST',url:'/v1/sync',headers,payload:{mutations:[{clientId:'treasury-device',clientMutationId:key,businessId,branchId:branch,mutationType:type,occurredAt:context.occurredAt,payload}]}});return {http:r.statusCode,...r.json().mutationResults?.[0]};};
 const entry={...context,sourceId:randomUUID(),sourceType:'TEST',entryType:'OPENING_BALANCE' as const,method:'CASH' as const,currencyCode:'GHS',actorStaffId:actor,amountDeltaMinor:1000,idempotencyKey:'opening'};
 return {businessId,branchId,actor,headers,accounts,cash,bank,context,sync,entry};
}
describe('treasury accounts, transfers and reconciliation',()=>{
 it('seeds new branches, resolves defaults, routes explicit accounts, rejects invalid accounts and includes account in strict idempotency',async()=>{
  const f=await fixture();expect(f.accounts).toHaveLength(5);
  await withTransaction(pool,c=>recordCashbookEntry(c,f.entry));expect((await pool.query('SELECT money_account_id FROM cashbook_entries')).rows[0].money_account_id).toBe(f.cash);
  const created=await app.inject({method:'POST',url:'/v1/money-accounts',headers:f.headers,payload:{businessId:f.businessId,name:'Reserve drawer',method:'CASH',kind:'CASH_DRAWER'}});expect(created.statusCode).toBe(201);const reserve=created.json().account.id;
  expect((await app.inject({method:'PATCH',url:'/v1/money-accounts',headers:f.headers,payload:{businessId:f.businessId,accountId:reserve,name:'Renamed reserve'}})).json().account.name).toBe('Renamed reserve');
  await withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,moneyAccountId:reserve,idempotencyKey:'reserve'}));
  await expect(withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,moneyAccountId:reserve}))).rejects.toThrow('conflicts');
  for(const account of [f.bank,randomUUID()])await expect(withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,moneyAccountId:account,idempotencyKey:randomUUID()}))).rejects.toThrow();
  await expect(withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,currencyCode:'USD',idempotencyKey:'wrong-currency'}))).rejects.toThrow();
  await pool.query('UPDATE money_accounts SET active=false WHERE id=$1',[reserve]);await expect(withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,moneyAccountId:reserve,idempotencyKey:'inactive'}))).rejects.toThrow();
  const other=(await pool.query(`INSERT INTO businesses(name,business_type) VALUES('Other','RETAIL_HARDWARE') RETURNING id`)).rows[0].id;
  const foreign=(await pool.query(`INSERT INTO money_accounts(business_id,name,method,kind,currency_code) VALUES($1,'Foreign','CASH','CASH_DRAWER','GHS') RETURNING id`,[other])).rows[0].id;
  await expect(withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,moneyAccountId:foreign,idempotencyKey:'foreign'}))).rejects.toThrow();
  const br=(await pool.query(`INSERT INTO branches(business_id,name,code) VALUES($1,'Second','SECOND') RETURNING id`,[f.businessId])).rows[0].id;
  expect(Number((await pool.query('SELECT COUNT(*) FROM money_account_defaults WHERE branch_id=$1',[br])).rows[0].count)).toBe(5);
  const otherCash=(await pool.query(`SELECT id FROM money_accounts WHERE branch_id=$1 AND method='CASH'`,[br])).rows[0].id;await expect(withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,moneyAccountId:otherCash,idempotencyKey:'scope'}))).rejects.toThrow();
  const categories=(await pool.query('SELECT id FROM expense_categories WHERE business_id=$1 LIMIT 1',[f.businessId])).rows[0].id;
  expect((await f.sync('expense','EXPENSE_CREATE',{categoryId:categories,amountMinor:10,method:'CASH',description:'Test',moneyAccountId:f.cash,actorStaffId:randomUUID()})).status).toBe('APPLIED');expect((await pool.query('SELECT money_account_id,actor_staff_id FROM expenses')).rows[0]).toEqual({money_account_id:f.cash,actor_staff_id:f.actor});
 });
 it('transfers atomically with net zero, protects concurrent overspend, replays once and honors allow_negative',async()=>{
  const f=await fixture();await withTransaction(pool,c=>recordCashbookEntry(c,f.entry));
  const payload={sourceAccountId:f.cash,destinationAccountId:f.bank,amountMinor:700,actorStaffId:f.actor};
  const results=await Promise.all(['one','two'].map(key=>applyTreasuryMutation(pool,{...f.context,clientMutationId:key},payload,'MONEY_TRANSFER_CREATE').then(()=>true,()=>false)));expect(results.sort()).toEqual([false,true]);
  expect((await pool.query('SELECT SUM(amount_delta_minor) AS total FROM cashbook_entries')).rows[0].total).toBe('1000');
  const successful=(await pool.query('SELECT client_mutation_id FROM money_transfers')).rows[0].client_mutation_id;
  expect((await applyTreasuryMutation(pool,{...f.context,clientMutationId:successful},payload,'MONEY_TRANSFER_CREATE')).idempotentReplay).toBe(true);
  expect(Number((await pool.query('SELECT COUNT(*) FROM cashbook_entries')).rows[0].count)).toBe(3);
  await pool.query('UPDATE money_accounts SET allow_negative=true WHERE id=$1',[f.cash]);expect((await f.sync('negative','MONEY_TRANSFER_CREATE',{...payload,actorStaffId:randomUUID()})).status).toBe('APPLIED');
  expect((await pool.query('SELECT SUM(amount_delta_minor) AS balance FROM cashbook_entries WHERE money_account_id=$1',[f.cash])).rows[0].balance).toBe('-400');
  expect((await pool.query('SELECT DISTINCT actor_staff_id FROM money_transfers')).rows).toEqual([{actor_staff_id:f.actor}]);
  expect((await f.sync('same','MONEY_TRANSFER_CREATE',{...payload,destinationAccountId:f.cash})).status).toBe('REJECTED');
 });
 it('snapshots as of period end, leaves variance unadjusted and resolves exact difference once with authoritative actors',async()=>{
  const f=await fixture();await withTransaction(pool,c=>recordCashbookEntry(c,f.entry));await withTransaction(pool,c=>recordCashbookEntry(c,{...f.entry,idempotencyKey:'later',occurredAt:'2026-02-01T00:00:00Z',amountDeltaMinor:500}));
  const payload={moneyAccountId:f.cash,type:'CASH_COUNT',periodStart:'2026-01-15',periodEnd:'2026-01-31',observedBalanceMinor:1000,actorStaffId:randomUUID()};
  const statement=await f.sync('statement','MONEY_RECONCILIATION_CREATE',{...payload,moneyAccountId:f.bank,type:'STATEMENT',observedBalanceMinor:25});expect(statement.result.status).toBe('VARIANCE');expect(statement.result.expectedBalanceMinor).toBe(0);
  const matched=await f.sync('matched','MONEY_RECONCILIATION_CREATE',payload);expect(matched.result.status).toBe('MATCHED');expect(matched.result.expectedBalanceMinor).toBe(1000);
  const variance=await f.sync('variance','MONEY_RECONCILIATION_CREATE',{...payload,observedBalanceMinor:900});expect(variance.result.differenceMinor).toBe(-100);expect((await pool.query('SELECT COUNT(*) FROM cashbook_adjustments')).rows[0].count).toBe('0');
  expect((await f.sync('no-note','MONEY_RECONCILIATION_RESOLVE',{reconciliationId:variance.result.id})).status).toBe('REJECTED');
  for(const key of ['resolve','resolve']){const result=await f.sync(key,'MONEY_RECONCILIATION_RESOLVE',{reconciliationId:variance.result.id,note:'Count verified',actorStaffId:randomUUID()});expect(result.status,JSON.stringify(result)).toBe('APPLIED');}
  expect((await f.sync('resolve-again','MONEY_RECONCILIATION_RESOLVE',{reconciliationId:variance.result.id,note:'Again'})).status).toBe('REJECTED');
  expect((await pool.query('SELECT amount_delta_minor,money_account_id,actor_staff_id FROM cashbook_adjustments')).rows).toEqual([{amount_delta_minor:'-100',money_account_id:f.cash,actor_staff_id:f.actor}]);expect((await pool.query(`SELECT status FROM money_reconciliations WHERE id=$1`,[variance.result.id])).rows[0].status).toBe('RESOLVED');
  await pool.query(`UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1`,[f.businessId]);
  expect((await f.sync('cashier','MONEY_RECONCILIATION_CREATE',{...payload,actorRole:'OWNER'})).status).toBe('APPLIED');
  expect((await f.sync('cashier-bank','MONEY_RECONCILIATION_CREATE',{...payload,moneyAccountId:f.bank,type:'STATEMENT',actorRole:'OWNER'})).status).toBe('REJECTED');
  expect((await f.sync('cashier-resolve','MONEY_RECONCILIATION_RESOLVE',{reconciliationId:variance.result.id,note:'No'})).http).toBe(403);
  expect((await f.sync('cashier-transfer','MONEY_TRANSFER_CREATE',{sourceAccountId:f.cash,destinationAccountId:f.bank,amountMinor:1})).http).toBe(403);
  const read=await app.inject({method:'GET',url:`/v1/money-accounts?businessId=${f.businessId}&branchId=${f.branchId}`,headers:f.headers});expect(read.statusCode).toBe(200);expect(read.json().accounts.every((a:{branchId:string})=>a.branchId===f.branchId)).toBe(true);
  expect((await app.inject({method:'GET',url:`/v1/money-accounts?businessId=${randomUUID()}&branchId=${f.branchId}`,headers:f.headers})).statusCode).toBe(403);
 });
});

it('migration 0010 assigns every historical cashbook, expense and adjustment to its branch default',async()=>{
 const {readFile}=await import('node:fs/promises');const client=await pool.connect();const schema=`treasury_history_${randomUUID().replaceAll('-','')}`;
 try{
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
  const {readdir}=await import('node:fs/promises');const directory=new URL('../../../packages/db/migrations/',import.meta.url);
  const migrations=(await readdir(directory)).filter(f=>f.endsWith('.sql')).sort();
  for(const file of migrations.filter(f=>f<'0010'))await client.query(await readFile(new URL(file,directory),'utf8'));
  const b=(await client.query(`INSERT INTO businesses(name,business_type) VALUES('Historic','RETAIL_HARDWARE') RETURNING id`)).rows[0].id;
  const br=(await client.query(`INSERT INTO branches(business_id,name,code) VALUES($1,'Historic','MAIN') RETURNING id`,[b])).rows[0].id;
  const actor=(await client.query(`INSERT INTO staff(business_id,display_name,role) VALUES($1,'Actor','OWNER') RETURNING id`,[b])).rows[0].id;
  const category=(await client.query(`SELECT id FROM expense_categories WHERE business_id=$1 LIMIT 1`,[b])).rows[0].id;
  await client.query(`INSERT INTO cashbook_entries(business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,actor_staff_id,idempotency_key,occurred_at) VALUES($1,$2,-10,'GHS','CASH','EXPENSE','TEST',$3,$4,'historic',now())`,[b,br,randomUUID(),actor]);
  await client.query(`INSERT INTO expenses(business_id,branch_id,category_id,amount_minor,currency_code,method,actor_staff_id,client_mutation_id,occurred_at) VALUES($1,$2,$3,10,'GHS','CASH',$4,'historic',now())`,[b,br,category,actor]);
  await client.query(`INSERT INTO cashbook_adjustments(business_id,branch_id,reason,note,amount_delta_minor,currency_code,method,actor_staff_id,client_mutation_id,occurred_at) VALUES($1,$2,'CORRECTION','Historical',10,'GHS','CASH',$3,'historic',now())`,[b,br,actor]);
  await client.query(await readFile(new URL('0010_money_accounts_reconciliation.sql',directory),'utf8'));
  const mapping=(await client.query(`SELECT money_account_id FROM money_account_defaults WHERE branch_id=$1 AND method='CASH'`,[br])).rows[0].money_account_id;
  for(const table of ['cashbook_entries','expenses','cashbook_adjustments'])expect((await client.query(`SELECT money_account_id FROM ${table}`)).rows).toEqual([{money_account_id:mapping}]);
 }finally{await client.query('ROLLBACK');await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();}
});

it('routes commerce receipts, payments and recoveries explicitly and refunds the original receipt account after defaults change',async()=>{
 const f=await fixture();
 const cash=(await pool.query(`INSERT INTO money_accounts(business_id,branch_id,name,method,kind,currency_code) VALUES($1,$2,'Till two','CASH','CASH_DRAWER','GHS') RETURNING id`,[f.businessId,f.branchId])).rows[0].id;
 const api=async(url:string,payload:unknown)=>{const r=await app.inject({method:'POST',url,headers:f.headers,payload});expect(r.statusCode,JSON.stringify(r.json())).toBe(201);return r.json();};
 const supplierId=(await api('/v1/suppliers',{businessId:f.businessId,name:'Supplier'})).supplier.id;
 const customerId=(await api('/v1/customers',{businessId:f.businessId,name:'Customer',creditLimitMinor:10000})).customer.id;
 const itemId=(await api('/v1/catalog/items',{businessId:f.businessId,name:'Item',kind:'PRODUCT',trackStock:true,stockUnitCode:'each',units:[{code:'each',label:'Each',canStock:true,canPurchase:true,canSell:true,defaultSalePriceMinor:1000}]})).item.id;
 const purchase=await f.sync('purchase','PURCHASE_RECEIVE_CREATE',{supplierId,settlementMethod:'CASH',moneyAccountId:cash,lines:[{itemId,purchaseUnitCode:'each',quantity:3,unitCostMinor:300}]});expect(purchase.status).toBe('APPLIED');
 const sale=await f.sync('sale','SALE_CREATE',{customerId,lines:[{itemId,saleUnitCode:'each',quantity:1}],payments:[{method:'CASH',amountMinor:1000,moneyAccountId:cash}]});expect(sale.status).toBe('APPLIED');
 const payment=await f.sync('customer','CUSTOMER_PAYMENT_CREATE',{customerId,amountMinor:400,method:'CASH',moneyAccountId:cash});expect(payment.status).toBe('APPLIED');
 expect((await f.sync('credit-purchase','PURCHASE_RECEIVE_CREATE',{supplierId,settlementMethod:'SUPPLIER_CREDIT',lines:[{itemId,purchaseUnitCode:'each',quantity:1,unitCostMinor:300}]})).status).toBe('APPLIED');
 expect((await f.sync('supplier','SUPPLIER_PAYMENT_CREATE',{supplierId,amountMinor:100,method:'CASH',moneyAccountId:cash})).status).toBe('APPLIED');
 const line=(await pool.query('SELECT id FROM sale_lines WHERE sale_id=$1',[sale.result.saleId])).rows[0].id;
 await pool.query(`UPDATE money_account_defaults SET money_account_id=$3 WHERE business_id=$1 AND branch_id=$2 AND method='CASH'`,[f.businessId,f.branchId,f.cash]);
 expect((await f.sync('refund','RETURN_CREATE',{originalSaleId:sale.result.saleId,reason:'Returned',refundMethod:'ORIGINAL_METHOD',lines:[{saleLineId:line,quantity:1,disposition:'RESTOCK'}]})).status).toBe('APPLIED');
 const purchaseLine=(await pool.query('SELECT id FROM purchase_lines WHERE purchase_id=$1',[purchase.result.purchaseId])).rows[0].id;
 expect((await f.sync('recovery','PURCHASE_RETURN_CREATE',{originalPurchaseId:purchase.result.purchaseId,supplierId,recoveryMethod:'CASH',moneyAccountId:cash,lines:[{purchaseLineId:purchaseLine,quantity:1,sourceLocation:'AVAILABLE'}]})).status).toBe('APPLIED');
 const rows=(await pool.query('SELECT entry_type,money_account_id FROM cashbook_entries')).rows;expect(rows).toHaveLength(6);expect(rows.every(r=>r.money_account_id===cash)).toBe(true);
 expect((await f.sync('credit-account','SALE_CREATE',{customerId,lines:[{itemId,saleUnitCode:'each',quantity:1}],payments:[{method:'CUSTOMER_CREDIT',amountMinor:1000,moneyAccountId:cash}]})).status).toBe('REJECTED');
 const foreign=(await pool.query(`INSERT INTO businesses(name,business_type) VALUES('Foreign','RETAIL_HARDWARE') RETURNING id`)).rows[0].id;
 const foreignAccount=(await pool.query(`INSERT INTO money_accounts(business_id,name,method,kind,currency_code) VALUES($1,'Foreign','CASH','CASH_DRAWER','GHS') RETURNING id`,[foreign])).rows[0].id;
 expect((await f.sync('foreign-transfer','MONEY_TRANSFER_CREATE',{sourceAccountId:cash,destinationAccountId:foreignAccount,amountMinor:1})).status).toBe('REJECTED');
 expect((await f.sync('foreign-reconcile','MONEY_RECONCILIATION_CREATE',{moneyAccountId:foreignAccount,type:'STATEMENT',periodStart:'2026-01-01',periodEnd:'2026-01-31',observedBalanceMinor:0})).status).toBe('REJECTED');
});

it('permits business-wide defaults, restricts account/default writes by role and isolates cashier branch reconciliations',async()=>{
 const f=await fixture();const second=(await pool.query(`INSERT INTO branches(business_id,name,code) VALUES($1,'Second','SECOND') RETURNING id`,[f.businessId])).rows[0].id;
 const secondCash=(await pool.query(`SELECT id FROM money_accounts WHERE branch_id=$1 AND method='CASH'`,[second])).rows[0].id;
 const create=await app.inject({method:'POST',url:'/v1/money-accounts',headers:f.headers,payload:{businessId:f.businessId,name:'Shared reserve',method:'CASH',kind:'CASH_DRAWER'}});expect(create.statusCode).toBe(201);const shared=create.json().account.id;
 const mapping=await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:shared}});expect(mapping.statusCode).toBe(200);
 await withTransaction(pool,c=>recordCashbookEntry(c,f.entry));expect((await pool.query('SELECT money_account_id FROM cashbook_entries')).rows[0].money_account_id).toBe(shared);
 expect((await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:secondCash}})).statusCode).toBe(400);
 const reconciliation={moneyAccountId:secondCash,type:'CASH_COUNT',periodStart:'2026-01-01',periodEnd:'2026-01-31',observedBalanceMinor:0};
 expect((await f.sync('other-branch','MONEY_RECONCILIATION_CREATE',reconciliation,second)).status).toBe('APPLIED');
 await pool.query(`UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1`,[f.businessId]);
 expect((await f.sync('wrong-branch','MONEY_RECONCILIATION_CREATE',reconciliation)).status).toBe('REJECTED');
 expect((await f.sync('shared-count','MONEY_RECONCILIATION_CREATE',{...reconciliation,moneyAccountId:shared})).status).toBe('REJECTED');
 const reads=await app.inject({method:'GET',url:`/v1/money-reconciliations?businessId=${f.businessId}&branchId=${f.branchId}`,headers:f.headers});expect(reads.statusCode).toBe(200);expect(reads.json().reconciliations).toEqual([]);
 for(const role of ['CASHIER','VIEWER','SALES','STAFF']){await pool.query('UPDATE business_memberships SET role=$2 WHERE business_id=$1',[f.businessId,role]);expect((await app.inject({method:'POST',url:'/v1/money-accounts',headers:f.headers,payload:{businessId:f.businessId,name:'Denied',method:'CASH',kind:'CASH_DRAWER'}})).statusCode).toBe(403);expect((await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:shared}})).statusCode).toBe(403);}
});

it('protects money-account and default lifecycle with optimistic revisions and audit history',async()=>{
 const f=await fixture();
 const accountsResponse=await app.inject({method:'GET',url:`/v1/money-accounts?businessId=${f.businessId}&branchId=${f.branchId}`,headers:f.headers});
 expect(accountsResponse.statusCode).toBe(200);
 const initialAccounts=accountsResponse.json().accounts;
 const initialCash=initialAccounts.find((a:{id:string})=>a.id===f.cash);
 expect(Date.parse(initialCash.updatedAt)).not.toBeNaN();
 const defaultsResponse=await app.inject({method:'GET',url:`/v1/money-account-defaults?businessId=${f.businessId}&branchId=${f.branchId}`,headers:f.headers});
 expect(defaultsResponse.statusCode).toBe(200);
 const cashDefault=defaultsResponse.json().defaults.find((d:{method:string})=>d.method==='CASH');
 expect(cashDefault.moneyAccountId).toBe(f.cash);
 expect(Date.parse(cashDefault.updatedAt)).not.toBeNaN();

 await withTransaction(pool,c=>recordCashbookEntry(c,f.entry));
 const createdResponse=await app.inject({method:'POST',url:'/v1/money-accounts',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,name:'Reserve drawer',method:'CASH',kind:'CASH_DRAWER'}});
 expect(createdResponse.statusCode).toBe(201);
 const reserve=createdResponse.json().account;
 expect(Date.parse(reserve.updatedAt)).not.toBeNaN();

 const missingRevision=await app.inject({method:'PATCH',url:`/v1/money-accounts/${reserve.id}`,headers:f.headers,payload:{businessId:f.businessId,name:'Missing revision'}});
 expect(missingRevision.statusCode).toBe(400);
 expect(missingRevision.json().error).toBe('REVISION_REQUIRED');

 const renamedResponse=await app.inject({method:'PATCH',url:`/v1/money-accounts/${reserve.id}`,headers:f.headers,payload:{businessId:f.businessId,expectedUpdatedAt:reserve.updatedAt,name:'Reserve till'}});
 expect(renamedResponse.statusCode).toBe(200);
 const renamed=renamedResponse.json().account;
 expect(renamed.name).toBe('Reserve till');

 const staleAccount=await app.inject({method:'PATCH',url:`/v1/money-accounts/${reserve.id}`,headers:f.headers,payload:{businessId:f.businessId,expectedUpdatedAt:reserve.updatedAt,name:'Stale reserve'}});
 expect(staleAccount.statusCode).toBe(409);
 expect(staleAccount.json().error).toBe('STALE_VERSION');

 const defaultBlocked=await app.inject({method:'PATCH',url:`/v1/money-accounts/${f.cash}`,headers:f.headers,payload:{businessId:f.businessId,expectedUpdatedAt:initialCash.updatedAt,active:false}});
 expect(defaultBlocked.statusCode).toBe(409);
 expect(defaultBlocked.json().error).toBe('ACCOUNT_IS_DEFAULT');

 const missingDefaultRevision=await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:reserve.id}});
 expect(missingDefaultRevision.statusCode).toBe(400);
 expect(missingDefaultRevision.json().error).toBe('REVISION_REQUIRED');

 const replacedDefault=await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:reserve.id,expectedUpdatedAt:cashDefault.updatedAt}});
 expect(replacedDefault.statusCode).toBe(200);
 expect(replacedDefault.json()).toMatchObject({branchId:f.branchId,method:'CASH',moneyAccountId:reserve.id});
 expect(Date.parse(replacedDefault.json().updatedAt)).not.toBeNaN();

 const staleDefault=await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:f.cash,expectedUpdatedAt:cashDefault.updatedAt}});
 expect(staleDefault.statusCode).toBe(409);
 expect(staleDefault.json().error).toBe('STALE_VERSION');

 const deactivatedResponse=await app.inject({method:'PATCH',url:`/v1/money-accounts/${f.cash}`,headers:f.headers,payload:{businessId:f.businessId,expectedUpdatedAt:initialCash.updatedAt,active:false}});
 expect(deactivatedResponse.statusCode).toBe(200);
 const deactivated=deactivatedResponse.json().account;
 expect(deactivated.active).toBe(false);
 expect(deactivated.balanceMinor).toBe(1000);

 const afterDeactivate=await app.inject({method:'GET',url:`/v1/money-accounts?businessId=${f.businessId}&branchId=${f.branchId}`,headers:f.headers});
 expect(afterDeactivate.json().accounts.find((a:{id:string})=>a.id===f.cash)).toMatchObject({active:false,balanceMinor:1000});

 const reactivatedResponse=await app.inject({method:'PATCH',url:`/v1/money-accounts/${f.cash}`,headers:f.headers,payload:{businessId:f.businessId,expectedUpdatedAt:deactivated.updatedAt,active:true}});
 expect(reactivatedResponse.statusCode).toBe(200);
 expect(reactivatedResponse.json().account.active).toBe(true);

 await pool.query(`UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1`,[f.businessId]);
 const deniedPatch=await app.inject({method:'PATCH',url:`/v1/money-accounts/${reserve.id}`,headers:f.headers,payload:{businessId:f.businessId,expectedUpdatedAt:renamed.updatedAt,name:'Denied'}});
 expect(deniedPatch.statusCode).toBe(403);
 const currentDefaults=await app.inject({method:'GET',url:`/v1/money-account-defaults?businessId=${f.businessId}&branchId=${f.branchId}`,headers:f.headers});
 const currentCashDefault=currentDefaults.json().defaults.find((d:{method:string})=>d.method==='CASH');
 const deniedDefault=await app.inject({method:'PUT',url:'/v1/money-account-defaults',headers:f.headers,payload:{businessId:f.businessId,branchId:f.branchId,method:'CASH',moneyAccountId:f.cash,expectedUpdatedAt:currentCashDefault.updatedAt}});
 expect(deniedDefault.statusCode).toBe(403);

 const audits=await pool.query<{event_type:string;payload:{changes?:Record<string,{before:unknown;after:unknown}>}}>(`SELECT event_type,payload FROM audit_events WHERE business_id=$1 AND event_type IN ('MONEY_ACCOUNT_DEACTIVATED','MONEY_ACCOUNT_REACTIVATED','MONEY_ACCOUNT_DEFAULT_CHANGED') ORDER BY occurred_at,id`,[f.businessId]);
 expect(audits.rows.some(row=>row.event_type==='MONEY_ACCOUNT_DEACTIVATED')).toBe(true);
 expect(audits.rows.some(row=>row.event_type==='MONEY_ACCOUNT_REACTIVATED')).toBe(true);
 expect(audits.rows.some(row=>row.event_type==='MONEY_ACCOUNT_DEFAULT_CHANGED')).toBe(true);
});
