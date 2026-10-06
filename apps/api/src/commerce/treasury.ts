import { withTransaction, type DatabasePool } from '../db.js';
import { CashbookError, recordCashbookEntry, type CashMethod } from './cashbook.js';
import { addSignedMinor, signedMinor } from './valuation.js';
import type { SaleMutationContext } from './sales.js';
export interface TreasuryPayload { sourceAccountId?:string; destinationAccountId?:string; moneyAccountId?:string; amountMinor?:number; type?:string; periodStart?:string; periodEnd?:string; observedBalanceMinor?:number; reconciliationId?:string; note?:string; actorStaffId?:string; actorRole?:string }
export async function applyTreasuryMutation(pool:DatabasePool, context:SaleMutationContext, payload:TreasuryPayload, mutationType:string) {
 if (!payload || typeof payload !== 'object' || !payload.actorStaffId || (payload.note !== undefined && (typeof payload.note !== 'string' || payload.note.length>1000))) throw new CashbookError('Invalid treasury payload');
 return withTransaction(pool, async client => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${context.businessId}:${context.clientMutationId}`]);
  if (!(await client.query(`SELECT br.id FROM branches br JOIN staff s ON s.business_id=br.business_id WHERE br.id=$1 AND br.business_id=$2 AND br.is_active AND s.id=$3 AND s.is_active`,[context.branchId,context.businessId,payload.actorStaffId])).rowCount) throw new CashbookError('Active branch and actor required');
  if (mutationType==='MONEY_RECONCILIATION_RESOLVE') {
   if (!payload.note?.trim()) throw new CashbookError('Resolution note required');
   const r=(await client.query(`SELECT * FROM money_reconciliations WHERE business_id=$1 AND id=$2 FOR UPDATE`,[context.businessId,payload.reconciliationId])).rows[0];
   if (!r) throw new CashbookError('Reconciliation not found');
   if(r.status==='RESOLVED' && r.resolution_client_mutation_id===context.clientMutationId) return {id:r.id,adjustmentId:r.resolution_adjustment_id,idempotentReplay:true};
   if(r.status==='RESOLVED') throw new CashbookError('Reconciliation is already resolved','RECONCILIATION_ALREADY_RESOLVED',409);
   if(r.status!=='VARIANCE') throw new CashbookError('Only a variance can be resolved');
   const a=(await client.query(`SELECT * FROM money_accounts WHERE business_id=$1 AND id=$2 AND active FOR UPDATE`,[context.businessId,r.money_account_id])).rows[0];
   if(!a) throw new CashbookError('Active reconciliation account required');
   const delta=signedMinor(Number(r.difference_minor));
   const adjustment=(await client.query(`INSERT INTO cashbook_adjustments(business_id,branch_id,money_account_id,currency_code,method,actor_staff_id,client_mutation_id,occurred_at,reason,note,amount_delta_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CORRECTION',$9,$10) RETURNING id`,[context.businessId,a.branch_id ?? r.branch_id,a.id,a.currency_code,a.method,payload.actorStaffId,`reconciliation:${r.id}`,context.occurredAt,payload.note.trim(),delta])).rows[0];
   await recordCashbookEntry(client,{...context,branchId:a.branch_id ?? r.branch_id,moneyAccountId:a.id,currencyCode:a.currency_code,method:a.method,amountDeltaMinor:delta,entryType:'ADJUSTMENT',sourceType:'CASHBOOK_ADJUSTMENT',sourceId:adjustment.id,actorStaffId:payload.actorStaffId,idempotencyKey:`adjustment:${adjustment.id}`});
   await client.query(`UPDATE money_reconciliations SET status='RESOLVED',resolution_adjustment_id=$2,resolved_by_staff_id=$3,resolved_at=$4,resolution_note=$5,resolution_client_mutation_id=$6 WHERE id=$1`,[r.id,adjustment.id,payload.actorStaffId,context.occurredAt,payload.note.trim(),context.clientMutationId]);
   const event=JSON.stringify({reconciliationId:r.id,adjustmentId:adjustment.id,differenceMinor:delta,note:payload.note.trim()});
   await writeTreasuryEvent(client,context,payload.actorStaffId!,'MONEY_RECONCILIATION_RESOLVED','MONEY_RECONCILIATION',r.id,event,r.branch_id);
   return {id:r.id,adjustmentId:adjustment.id,idempotentReplay:false};
  }
  const transfer=mutationType==='MONEY_TRANSFER_CREATE';
  const table=transfer?'money_transfers':'money_reconciliations';
  const prior=(await client.query(`SELECT * FROM ${table} WHERE business_id=$1 AND client_mutation_id=$2`,[context.businessId,context.clientMutationId])).rows[0];
  if(prior) { if(transfer ? prior.branch_id!==context.branchId : prior.money_account_id!==payload.moneyAccountId) throw new CashbookError('Replay branch differs'); return {id:prior.id,idempotentReplay:true}; }
  const ids=transfer?[payload.sourceAccountId,payload.destinationAccountId]:[payload.moneyAccountId];
  if(ids.some(id=>typeof id!=='string'||! /^[0-9a-f-]{36}$/i.test(id)) || (transfer && ids[0]===ids[1])) throw new CashbookError('Distinct valid accounts required');
  const accounts=(await client.query(`SELECT * FROM money_accounts WHERE business_id=$1 AND id=ANY($2::uuid[]) AND active ORDER BY id FOR UPDATE`,[context.businessId,ids])).rows;
  if(accounts.length!==ids.length) throw new CashbookError('Active business accounts required');
  if(transfer) {
   const source=accounts.find(a=>a.id===ids[0])!,destination=accounts.find(a=>a.id===ids[1])!;
   if(!Number.isSafeInteger(payload.amountMinor)||payload.amountMinor!<=0||source.currency_code!==destination.currency_code) throw new CashbookError('Positive amount and same currency required');
   const balance=signedMinor(Number((await client.query(`SELECT COALESCE(SUM(amount_delta_minor),0) AS balance FROM cashbook_entries WHERE business_id=$1 AND money_account_id=$2`,[context.businessId,source.id])).rows[0].balance));
   if(!source.allow_negative && addSignedMinor(balance,-payload.amountMinor!)<0) throw new CashbookError('Insufficient source account balance');
   const row=(await client.query(`INSERT INTO money_transfers(business_id,branch_id,source_account_id,destination_account_id,amount_minor,currency_code,actor_staff_id,note,client_mutation_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[context.businessId,context.branchId,source.id,destination.id,payload.amountMinor,source.currency_code,payload.actorStaffId,payload.note ?? null,context.clientMutationId,context.occurredAt])).rows[0];
   for(const [a,sign,type] of [[source,-1,'TRANSFER_OUT'],[destination,1,'TRANSFER_IN']] as const) await recordCashbookEntry(client,{...context,branchId:a.branch_id ?? context.branchId,moneyAccountId:a.id,currencyCode:a.currency_code,method:a.method as CashMethod,amountDeltaMinor:sign*payload.amountMinor!,entryType:type,sourceType:'MONEY_TRANSFER',sourceId:row.id,actorStaffId:payload.actorStaffId,idempotencyKey:`transfer:${row.id}:${type}`});
   const event=JSON.stringify({sourceAccountId:source.id,destinationAccountId:destination.id,amountMinor:payload.amountMinor,currencyCode:source.currency_code});
   await writeTreasuryEvent(client,context,payload.actorStaffId!,'MONEY_TRANSFER_CREATED','MONEY_TRANSFER',row.id,event);
   return {id:row.id,idempotentReplay:false};
  }
  const a=accounts[0]!;
  if(!['CASH_COUNT','STATEMENT'].includes(payload.type ?? '')||!Number.isSafeInteger(payload.observedBalanceMinor)||!payload.periodStart||!payload.periodEnd||Number.isNaN(Date.parse(payload.periodStart))||Number.isNaN(Date.parse(payload.periodEnd))||Date.parse(payload.periodStart)>Date.parse(payload.periodEnd)) throw new CashbookError('Invalid reconciliation period or balance');
  if(payload.type==='CASH_COUNT' && (!Number.isSafeInteger(payload.observedBalanceMinor) || payload.observedBalanceMinor! < 0)) throw new CashbookError('Cash count cannot be negative');
  if(payload.type==='CASH_COUNT' && (a.method!=='CASH'||a.kind!=='CASH_DRAWER')) throw new CashbookError('Cash counts require a cash drawer');
  if(payload.actorRole==='CASHIER' && (a.branch_id!==context.branchId || a.method!=='CASH'||payload.type!=='CASH_COUNT')) throw new CashbookError('Cashier may count only current branch cash drawers');
  const expected=signedMinor(Number((await client.query(`SELECT COALESCE(SUM(amount_delta_minor),0) AS balance FROM cashbook_entries WHERE business_id=$1 AND money_account_id=$2 AND occurred_at<=$3`,[context.businessId,a.id,payload.periodEnd])).rows[0].balance));
  const difference=addSignedMinor(payload.observedBalanceMinor!,-expected);
  const row=(await client.query(`INSERT INTO money_reconciliations(business_id,branch_id,money_account_id,type,period_start,period_end,expected_balance_minor,observed_balance_minor,status,actor_staff_id,note,client_mutation_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[context.businessId,a.branch_id ?? context.branchId,a.id,payload.type,payload.periodStart,payload.periodEnd,expected,payload.observedBalanceMinor,difference===0?'MATCHED':'VARIANCE',payload.actorStaffId,payload.note ?? null,context.clientMutationId,context.occurredAt])).rows[0];
  const event=JSON.stringify({moneyAccountId:a.id,type:payload.type,periodStart:payload.periodStart,periodEnd:payload.periodEnd,expectedBalanceMinor:expected,observedBalanceMinor:payload.observedBalanceMinor,differenceMinor:difference,status:row.status});
  await writeTreasuryEvent(client,context,payload.actorStaffId!,'MONEY_RECONCILIATION_CREATED','MONEY_RECONCILIATION',row.id,event,row.branch_id);
  return {id:row.id,expectedBalanceMinor:expected,differenceMinor:difference,status:row.status,idempotentReplay:false};
 });
}


async function writeTreasuryEvent(client: import('../db.js').DatabaseClient, context: SaleMutationContext, actorStaffId: string, eventType: string, entityType: string, entityId: string, payload: string, branchId = context.branchId): Promise<void> {
 await client.query(`INSERT INTO audit_events(business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[context.businessId,branchId,actorStaffId,eventType,entityType,entityId,context.clientMutationId,payload,context.occurredAt]);
 await client.query(`INSERT INTO outbox_events(business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[context.businessId,branchId,entityType,entityId,eventType,payload,context.occurredAt]);
}
