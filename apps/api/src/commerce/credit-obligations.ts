import type { DatabaseClient } from "../db.js";

const DAY_MS = 86_400_000;

export function dueAtFromTerms(occurredAt: string, termsDays: number): string {
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 3650) throw new Error("Credit terms days are invalid");
  const issued = Date.parse(occurredAt);
  if (!Number.isFinite(issued)) throw new Error("Credit obligation issue time is invalid");
  return new Date(issued + termsDays * DAY_MS).toISOString();
}

export async function createCustomerCreditObligation(client: DatabaseClient, input: {
  businessId: string; branchId: string; customerId: string; saleId: string; currencyCode: string;
  amountMinor: number; termsDays: number; occurredAt: string;
}): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return;
  await client.query(
    `INSERT INTO customer_credit_obligations
       (business_id,branch_id,customer_id,sale_id,currency_code,original_minor,open_minor,issued_at,due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
     ON CONFLICT (business_id,sale_id) DO NOTHING`,
    [input.businessId,input.branchId,input.customerId,input.saleId,input.currencyCode,input.amountMinor,input.occurredAt,dueAtFromTerms(input.occurredAt,input.termsDays)],
  );
}

export async function allocateCustomerPayment(client: DatabaseClient, input: {
  businessId: string; customerId: string; paymentId: string; amountMinor: number; occurredAt: string;
}): Promise<number> {
  return allocateCustomer(client,input.businessId,input.customerId,"PAYMENT",input.paymentId,input.amountMinor,input.occurredAt);
}

export async function reduceCustomerObligationForSale(client: DatabaseClient, input: {
  businessId: string; saleId: string; sourceId: string; amountMinor: number; occurredAt: string;
}): Promise<number> {
  if (input.amountMinor <= 0) return 0;
  const result = await client.query<{id:string;open_minor:string|number}>(
    `SELECT id,open_minor FROM customer_credit_obligations
     WHERE business_id=$1 AND sale_id=$2 FOR UPDATE`,[input.businessId,input.saleId],
  );
  const row=result.rows[0];
  if(!row) return 0;
  const amount=Math.min(input.amountMinor,Number(row.open_minor));
  if(amount<=0) return 0;
  await client.query(`UPDATE customer_credit_obligations SET open_minor=open_minor-$2 WHERE id=$1`,[row.id,amount]);
  await client.query(
    `INSERT INTO customer_credit_allocations (business_id,obligation_id,source_type,source_id,amount_minor,allocated_at)
     VALUES ($1,$2,'CREDIT_REFUND',$3,$4,$5) ON CONFLICT (obligation_id,source_type,source_id) DO NOTHING`,
    [input.businessId,row.id,input.sourceId,amount,input.occurredAt],
  );
  return amount;
}

async function allocateCustomer(client: DatabaseClient,businessId:string,customerId:string,sourceType:"PAYMENT",sourceId:string,amountMinor:number,occurredAt:string): Promise<number> {
  let remaining=amountMinor,allocated=0;
  if(!Number.isSafeInteger(amountMinor)||amountMinor<=0) return 0;
  const obligations=await client.query<{id:string;open_minor:string|number}>(
    `SELECT id,open_minor FROM customer_credit_obligations
     WHERE business_id=$1 AND customer_id=$2 AND open_minor>0
     ORDER BY due_at,issued_at,id FOR UPDATE`,[businessId,customerId],
  );
  for(const row of obligations.rows){
    if(remaining<=0) break;
    const amount=Math.min(remaining,Number(row.open_minor));
    if(amount<=0) continue;
    await client.query(`UPDATE customer_credit_obligations SET open_minor=open_minor-$2 WHERE id=$1`,[row.id,amount]);
    await client.query(
      `INSERT INTO customer_credit_allocations (business_id,obligation_id,source_type,source_id,amount_minor,allocated_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (obligation_id,source_type,source_id) DO NOTHING`,
      [businessId,row.id,sourceType,sourceId,amount,occurredAt],
    );
    remaining-=amount; allocated+=amount;
  }
  return allocated;
}

export async function createSupplierCreditObligation(client: DatabaseClient, input: {
  businessId:string; branchId:string; supplierId:string; purchaseId:string; currencyCode:string;
  amountMinor:number; termsDays:number; occurredAt:string;
}): Promise<void> {
  if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0) return;
  await client.query(
    `INSERT INTO supplier_credit_obligations
       (business_id,branch_id,supplier_id,purchase_id,currency_code,original_minor,open_minor,issued_at,due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
     ON CONFLICT (business_id,purchase_id) DO NOTHING`,
    [input.businessId,input.branchId,input.supplierId,input.purchaseId,input.currencyCode,input.amountMinor,input.occurredAt,dueAtFromTerms(input.occurredAt,input.termsDays)],
  );
}

export async function allocateSupplierPayment(client: DatabaseClient,input:{businessId:string;supplierId:string;paymentId:string;amountMinor:number;occurredAt:string}): Promise<number>{
  let remaining=input.amountMinor,allocated=0;
  if(!Number.isSafeInteger(remaining)||remaining<=0) return 0;
  const obligations=await client.query<{id:string;open_minor:string|number}>(
    `SELECT id,open_minor FROM supplier_credit_obligations
     WHERE business_id=$1 AND supplier_id=$2 AND open_minor>0
     ORDER BY due_at,issued_at,id FOR UPDATE`,[input.businessId,input.supplierId],
  );
  for(const row of obligations.rows){
    if(remaining<=0) break;
    const amount=Math.min(remaining,Number(row.open_minor));
    if(amount<=0) continue;
    await client.query(`UPDATE supplier_credit_obligations SET open_minor=open_minor-$2 WHERE id=$1`,[row.id,amount]);
    await client.query(
      `INSERT INTO supplier_credit_allocations (business_id,obligation_id,source_type,source_id,amount_minor,allocated_at)
       VALUES ($1,$2,'PAYMENT',$3,$4,$5) ON CONFLICT (obligation_id,source_type,source_id) DO NOTHING`,
      [input.businessId,row.id,input.paymentId,amount,input.occurredAt],
    );
    remaining-=amount;allocated+=amount;
  }
  return allocated;
}

export async function reduceSupplierObligationForPurchase(client: DatabaseClient,input:{businessId:string;purchaseId:string;sourceId:string;amountMinor:number;occurredAt:string}): Promise<number>{
  if(input.amountMinor<=0) return 0;
  const result=await client.query<{id:string;open_minor:string|number}>(
    `SELECT id,open_minor FROM supplier_credit_obligations WHERE business_id=$1 AND purchase_id=$2 FOR UPDATE`,[input.businessId,input.purchaseId],
  );
  const row=result.rows[0]; if(!row) return 0;
  const amount=Math.min(input.amountMinor,Number(row.open_minor)); if(amount<=0) return 0;
  await client.query(`UPDATE supplier_credit_obligations SET open_minor=open_minor-$2 WHERE id=$1`,[row.id,amount]);
  await client.query(
    `INSERT INTO supplier_credit_allocations (business_id,obligation_id,source_type,source_id,amount_minor,allocated_at)
     VALUES ($1,$2,'CREDIT_NOTE',$3,$4,$5) ON CONFLICT (obligation_id,source_type,source_id) DO NOTHING`,
    [input.businessId,row.id,input.sourceId,amount,input.occurredAt],
  );
  return amount;
}
