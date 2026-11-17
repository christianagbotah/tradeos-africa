import {createHash} from "node:crypto";
import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";

export type HubtelNotificationHint=
  "SUCCESS_CLAIM"|"FAILED_CLAIM"|"REFUNDED_CLAIM"|"UNKNOWN_CLAIM";
const REFERENCE=/^TSP-[a-f0-9]{24}$/;
const MAX_HINTS_PER_ATTEMPT=12;
const MAX_RAW_JSON_BYTES=4096;
type Attempt={id:string;business_id:string;client_reference:string};
type Body=Record<string,unknown>;

/** Opt-in only. No "enabled by default" path for public callback ingestion. */
export function hubtelNotificationInboxEnabled(){
  return process.env.TRADEOS_HUBTEL_NOTIFICATION_INBOX_ENABLED==="true";
}
function object(value:unknown):Body|null{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)?
    value as Body:null;
}
function readReference(value:Body):string|null{
  const child=object(value.data)??object(value.Data);
  const ref=value.clientReference??value.ClientReference??
    child?.clientReference??child?.ClientReference;
  return typeof ref==="string"&&REFERENCE.test(ref)?ref:null;
}
function statusHint(value:Body):HubtelNotificationHint{
  const code=value.responseCode??value.ResponseCode;
  const status=value.status??value.Status;
  if(status==="Refunded"||status==="REFUNDED")return "REFUNDED_CLAIM";
  if(code==="0000"&&(status==="Success"||status==="Successful"))
    return "SUCCESS_CLAIM";
  if(code==="2001"||status==="Failed"||status==="FAILED")
    return "FAILED_CLAIM";
  return "UNKNOWN_CLAIM";
}
function sanitized(value:unknown):{
  reference:string;digest:string;hint:HubtelNotificationHint;
}|null{
  const root=object(value);
  if(!root)return null;
  const reference=readReference(root);
  if(!reference)return null;
  let raw:string;
  try{raw=JSON.stringify(root);}catch{return null;}
  if(!raw||Buffer.byteLength(raw,"utf8")>MAX_RAW_JSON_BYTES)return null;
  // Store only the digest and coarse, UNTRUSTED status claim; never raw
  // names, customer phones, amounts, cards or provider credentials.
  return {
    reference,digest:createHash("sha256").update(raw).digest("hex"),
    hint:statusHint(root),
  };
}

/**
 * Accept untrusted notification hints only for an existing TradeOS POS
 * checkout reference. Never treats a callback as finality or calls a
 * checkout/status/refund/payout API. A verified server-side status check
 * remains mandatory before any payment, stock or cashbook mutation.
 */
export async function recordUntrustedHubtelNotification(
  pool:DatabasePool,body:unknown,
):Promise<"IGNORED"|"STORED"|"DUPLICATE"|"LIMIT_REACHED">{
  if(!hubtelNotificationInboxEnabled())return "IGNORED";
  const parsed=sanitized(body);
  if(!parsed)return "IGNORED";
  return withTransaction(pool,async client=>{
    const attempt=(await client.query<Attempt>(
      "SELECT id,business_id,client_reference "+
      "FROM hubtel_sale_checkout_attempts "+
      "WHERE client_reference=$1 FOR UPDATE",
      [parsed.reference])).rows[0];
    if(!attempt)return "IGNORED" as const;
    // Duplicated notifications do not consume the bounded per-sale quota.
    const existing=(await client.query<{id:string}>(
      "SELECT id FROM hubtel_pos_notification_inbox "+
      "WHERE attempt_id=$1 AND notification_digest=$2",
      [attempt.id,parsed.digest])).rows[0];
    if(existing)return "DUPLICATE" as const;
    const count=(await client.query<{amount:number}>(
      "SELECT count(*)::integer AS amount FROM hubtel_pos_notification_inbox "+
      "WHERE attempt_id=$1",[attempt.id])).rows[0]?.amount??0;
    if(count>=MAX_HINTS_PER_ATTEMPT)return "LIMIT_REACHED" as const;
    const wrote=(await client.query<{id:string}>(
      "INSERT INTO hubtel_pos_notification_inbox "+
      "(attempt_id,business_id,client_reference,notification_digest,"+
      "status_hint,trust_level) "+
      "VALUES($1,$2,$3,$4,$5,'UNTRUSTED') "+
      "ON CONFLICT(attempt_id,notification_digest) DO NOTHING RETURNING id",
      [attempt.id,attempt.business_id,attempt.client_reference,
        parsed.digest,parsed.hint])).rows[0];
    return wrote?"STORED" as const:"DUPLICATE" as const;
  });
}
