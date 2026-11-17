import {randomBytes} from "node:crypto";
import type {DatabasePool,DatabaseClient} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {gatewayFor,gatewaySupported} from "./catalog.js";
import {selectedGateway} from "./service.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Queryable=Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">;
type AttemptRow={
  id:string;business_id:string;branch_id:string;sale_id:string;
  payment_id:string;provider_code:"PAYSTACK"|"FLUTTERWAVE";
  environment:"TEST";client_request_id:string;client_reference:string;
  expected_amount_minor:string;currency_code:string;payment_method:"MOMO"|"CARD";
  state:"PREPARED"|"CANCELLED"|"REVIEW_REQUIRED";
  merchant_connection_revision:number;created_at:Date;updated_at:Date;
};
type SaleRow={
  id:string;branch_id:string;status:string;total_minor:string;currency_code:string;
};
type PaymentRow={id:string;branch_id:string;status:string;amount_minor:string;
  currency_code:string;method:string};
function requireUUID(value:unknown):asserts value is string{
  if(typeof value!=="string"||!UUID.test(value))throw new AuthError(
    "Valid payment identifiers are required.",400,"GATEWAY_ATTEMPT_ID_INVALID");
}
function attemptView(row:AttemptRow){
  return {
    attemptId:row.id,businessId:row.business_id,branchId:row.branch_id,
    saleId:row.sale_id,paymentId:row.payment_id,
    providerCode:row.provider_code,environment:row.environment,
    clientReference:row.client_reference,
    expectedAmountMinor:row.expected_amount_minor,currencyCode:row.currency_code,
    paymentMethod:row.payment_method,state:row.state,
    createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),
  };
}
const ATTEMPT_COLUMNS="id,business_id,branch_id,sale_id,payment_id,provider_code,"+
  "environment,client_request_id,client_reference,expected_amount_minor::text,"+
  "currency_code,payment_method,state,merchant_connection_revision,created_at,updated_at";

/**
 * Internal-only preparation for future provider sandboxes. Does not call
 * Paystack/Flutterwave or perform cashbook, tax, inventory or receipt changes.
 * No HTTP route exposes this mutation in this release.
 */
export async function prepareTestGatewayAttempt(pool:DatabasePool,input:{
  businessId:string;saleId:string;clientRequestId:string;
}){
  requireUUID(input.businessId);requireUUID(input.saleId);
  requireUUID(input.clientRequestId);
  return withTransaction(pool,async tx=>{
    // Lock the canonical sale to serialize competing attempts for this sale,
    // including attempts with a different idempotency key.
    const sale=(await tx.query<SaleRow>(
      "SELECT id,branch_id,status,total_minor::text,currency_code "+
      "FROM sales WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [input.businessId,input.saleId])).rows[0];
    if(!sale)throw new AuthError("Sale was not found.",404,
      "GATEWAY_ATTEMPT_SALE_NOT_FOUND");
    const existing=(await tx.query<AttemptRow>(
      "SELECT "+ATTEMPT_COLUMNS+" FROM gateway_collection_attempts "+
      "WHERE business_id=$1 AND sale_id=$2 FOR UPDATE",
      [input.businessId,input.saleId])).rows[0];
    if(existing){
      if(existing.client_request_id===input.clientRequestId)
        return {attempt:attemptView(existing),replayed:true,charged:false};
      throw new AuthError(
        "A payment attempt already belongs to this sale. Verify or resolve "+
        "that attempt before changing provider or request.",409,
        "GATEWAY_ATTEMPT_ALREADY_EXISTS");
    }
    const provider=await selectedGateway(tx,input.businessId);
    if(provider!=="PAYSTACK"&&provider!=="FLUTTERWAVE")
      throw new AuthError("The selected gateway has no TEST attempt adapter.",
        409,"GATEWAY_ATTEMPT_PROVIDER_UNSUPPORTED");
    const market=(await tx.query<{country_code:string;currency_code:string}>(
      "SELECT country_code,currency_code FROM businesses WHERE id=$1",
      [input.businessId])).rows[0];
    if(!market||!gatewaySupported(gatewayFor(provider)!,
      market.country_code.trim(),market.currency_code.trim())||
      sale.currency_code!==market.currency_code.trim())
      throw new AuthError("Business currency/market is not eligible.",
        422,"GATEWAY_ATTEMPT_CURRENCY_INVALID");
    const connection=(await tx.query<{revision:number}>(
      "SELECT revision FROM business_gateway_connections "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment='TEST' "+
      "AND connection_status='PENDING_VERIFICATION' AND enabled=false",
      [input.businessId,provider])).rows[0];
    if(!connection)throw new AuthError(
      "A merchant-owned TEST connection is required before preparation.",
      409,"GATEWAY_ATTEMPT_CONNECTION_REQUIRED");
    const payments=await tx.query<PaymentRow>(
      "SELECT id,branch_id,status,amount_minor::text,currency_code,method "+
      "FROM payments WHERE business_id=$1 AND sale_id=$2 ORDER BY id FOR UPDATE",
      [input.businessId,input.saleId]);
    const p=payments.rows[0];
    const minor=Number(sale.total_minor);
    if(sale.status!=="OPEN"||!Number.isSafeInteger(minor)||minor<=0||
      payments.rows.length!==1||!p||p.status!=="PENDING"||
      !["MOMO","CARD"].includes(p.method)||p.branch_id!==sale.branch_id||
      p.currency_code!==sale.currency_code||p.amount_minor!==sale.total_minor)
      throw new AuthError(
        "Only a single canonical pending electronic payment may be prepared.",
        409,"GATEWAY_ATTEMPT_SALE_NOT_COLLECTIBLE");

    const reference="TSP-"+randomBytes(12).toString("hex");
    let row:AttemptRow;
    try{
      const created=await tx.query<AttemptRow>(
        "INSERT INTO gateway_collection_attempts "+
        "(business_id,branch_id,sale_id,payment_id,provider_code,environment,"+
        "merchant_connection_revision,client_request_id,client_reference,"+
        "expected_amount_minor,currency_code,payment_method) "+
        "VALUES($1,$2,$3,$4,$5,'TEST',$6,$7,$8,$9,$10,$11) RETURNING "+
        ATTEMPT_COLUMNS,
        [input.businessId,sale.branch_id,input.saleId,p.id,provider,
          connection.revision,input.clientRequestId,reference,sale.total_minor,
          sale.currency_code,p.method]);
      row=created.rows[0]!;
    }catch(error){
      if(typeof error==="object"&&error!==null&&
         "code" in error&&error.code==="23505")
        throw new AuthError("The client request or sale already has an attempt.",
          409,"GATEWAY_ATTEMPT_UNIQUE_CONFLICT");
      throw error;
    }
    await tx.query(
      "INSERT INTO gateway_collection_attempt_events "+
      "(attempt_id,business_id,event_type,note_code) "+
      "VALUES($1,$2,'PREPARED','NO_EXTERNAL_COLLECTION')",
      [row.id,input.businessId]);
    return {attempt:attemptView(row),replayed:false,charged:false};
  });
}

export async function listGatewayTestAttempts(pool:DatabasePool,input:{
  businessId:string;branchId?:string;limit?:number;
}){
  requireUUID(input.businessId);
  if(input.branchId)requireUUID(input.branchId);
  const limit=Math.min(100,Math.max(1,
    Number.isFinite(input.limit)?Math.trunc(input.limit!):25));
  const results=await pool.query<AttemptRow>(
    "SELECT "+ATTEMPT_COLUMNS+" FROM gateway_collection_attempts "+
    "WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2::uuid) "+
    "ORDER BY created_at DESC,id DESC LIMIT $3",
    [input.businessId,input.branchId??null,limit]);
  const summary=await pool.query<{
    prepared:string;cancelled:string;review_required:string;
  }>(
    "SELECT COUNT(*) FILTER(WHERE state='PREPARED')::text AS prepared,"+
    "COUNT(*) FILTER(WHERE state='CANCELLED')::text AS cancelled,"+
    "COUNT(*) FILTER(WHERE state='REVIEW_REQUIRED')::text AS review_required "+
    "FROM gateway_collection_attempts "+
    "WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2::uuid)",
    [input.businessId,input.branchId??null]);
  return {
    businessId:input.businessId,
    attempts:results.rows.map(attemptView),
    summary:{
      prepared:Number(summary.rows[0]?.prepared??0),
      cancelled:Number(summary.rows[0]?.cancelled??0),
      reviewRequired:Number(summary.rows[0]?.review_required??0),
    },
    collectionEnabled:false,
    notice:"TEST preparation only. No external provider charge, "+
      "receipt, inventory release or financial posting is possible here.",
  };
}

/**
 * Internal-only safety transition for prepared TEST attempts. Never calls
 * external provider endpoints and NEVER changes the canonical sale/payment.
 */
export async function closeTestGatewayAttempt(pool:DatabasePool,input:{
  businessId:string;attemptId:string;decision:"CANCELLED"|"REVIEW_REQUIRED";
  reasonCode:string;
}){
  requireUUID(input.businessId);requireUUID(input.attemptId);
  if(!["CANCELLED","REVIEW_REQUIRED"].includes(input.decision)||
    !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reasonCode)){
    throw new AuthError("A supported review decision and reason are required.",
      400,"GATEWAY_ATTEMPT_REVIEW_INVALID");
  }
  return withTransaction(pool,async tx=>{
    const current=(await tx.query<AttemptRow>(
      "SELECT "+ATTEMPT_COLUMNS+" FROM gateway_collection_attempts "+
      "WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [input.businessId,input.attemptId])).rows[0];
    if(!current)throw new AuthError("Attempt not found.",404,
      "GATEWAY_ATTEMPT_NOT_FOUND");
    if(current.state===input.decision)
      return {attempt:attemptView(current),replayed:true,charged:false};
    if(current.state!=="PREPARED")throw new AuthError(
      "This attempt has already been closed. Review it before changing state.",
      409,"GATEWAY_ATTEMPT_ALREADY_CLOSED");
    const row=(await tx.query<AttemptRow>(
      "UPDATE gateway_collection_attempts SET state=$3,updated_at=now() "+
      "WHERE business_id=$1 AND id=$2 AND state='PREPARED' RETURNING "+
      ATTEMPT_COLUMNS,
      [input.businessId,input.attemptId,input.decision])).rows[0]!;
    await tx.query(
      "INSERT INTO gateway_collection_attempt_events "+
      "(attempt_id,business_id,event_type,note_code) VALUES($1,$2,$3,$4)",
      [row.id,input.businessId,input.decision==="CANCELLED"?
        "CANCELLED":"FLAGGED_FOR_REVIEW",input.reasonCode]);
    return {attempt:attemptView(row),replayed:false,charged:false};
  });
}
