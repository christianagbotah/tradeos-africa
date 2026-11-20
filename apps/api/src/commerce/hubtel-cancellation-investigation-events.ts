import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { posFail } from "./hubtel-pos-config.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE=/^[A-Za-z0-9][A-Za-z0-9 _.:/-]{5,159}$/;
const REPORTS=["NOT_APPLICABLE","UNPAID_REPORTED","PAID_REPORTED","INCONCLUSIVE"] as const;
const KINDS=["PROVIDER_CONTACTED","PROVIDER_REPLY_RECORDED",
  "CUSTOMER_FOLLOWUP","INTERNAL_NOTE"] as const;
export type InvestigationEventKind=typeof KINDS[number];
export type InvestigationProviderReport=typeof REPORTS[number];
type CaseRow={id:string;business_id:string;branch_id:string;};
type EventRow={
  id:string;investigation_id:string;business_id:string;branch_id:string;
  actor_user_id:string;client_request_id:string;
  event_kind:InvestigationEventKind;
  provider_report:InvestigationProviderReport;
  evidence_reference:string|null;note:string;created_at:Date;
};

function validId(value:string){
  if(!UUID.test(value))posFail("Invalid investigation or request identifier.",
    "HUBTEL_INVESTIGATION_EVENT_ID_INVALID",400);
}
function validNote(value:unknown):string {
  if(typeof value!=="string"||value.trim().length<20||value.trim().length>700||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    posFail("Provide a clear case update (20–700 characters).",
      "HUBTEL_INVESTIGATION_EVENT_NOTE_INVALID",400);
  return value.trim();
}
function normalizedInput(input:{
  eventKind:unknown;providerReport?:unknown;evidenceReference?:unknown;note:unknown;
}) {
  if(typeof input.eventKind!=="string"||
     !KINDS.includes(input.eventKind as InvestigationEventKind))
    posFail("Choose a supported investigation update.",
      "HUBTEL_INVESTIGATION_EVENT_KIND_INVALID",400);
  const kind=input.eventKind as InvestigationEventKind;
  const report=input.providerReport??"NOT_APPLICABLE";
  if(typeof report!=="string"||
     !REPORTS.includes(report as InvestigationProviderReport))
    posFail("Choose a supported provider-reported status.",
      "HUBTEL_INVESTIGATION_EVENT_REPORT_INVALID",400);
  const providerReport=report as InvestigationProviderReport;
  const reference=input.evidenceReference===undefined||
    input.evidenceReference===null||input.evidenceReference===""?
      null:input.evidenceReference;
  if(reference!==null && (typeof reference!=="string"||
      !REFERENCE.test(reference.trim())))
    posFail("Use an external provider support-case or document reference, not a URL or API credentials.",
      "HUBTEL_INVESTIGATION_EVENT_REFERENCE_INVALID",400);
  const evidenceReference=typeof reference==="string"?reference.trim():null;
  if(kind==="PROVIDER_REPLY_RECORDED") {
    if(!evidenceReference||providerReport==="NOT_APPLICABLE")
      posFail("Provider replies need an external support reference and a reported status.",
        "HUBTEL_INVESTIGATION_EVENT_PROVIDER_EVIDENCE_REQUIRED",400);
  } else if(providerReport!=="NOT_APPLICABLE") {
    posFail("Only provider replies can record provider-reported statuses.",
      "HUBTEL_INVESTIGATION_EVENT_PROVIDER_REPORT_UNTRUSTED",400);
  }
  return {eventKind:kind,providerReport,evidenceReference,note:validNote(input.note)};
}
function publicEvent(row:EventRow,idempotentReplay:boolean){
  return {
    eventId:row.id,investigationId:row.investigation_id,
    branchId:row.branch_id,actorUserId:row.actor_user_id,
    eventKind:row.event_kind,providerReport:row.provider_report,
    evidenceReference:row.evidence_reference,note:row.note,
    recordedAt:row.created_at.toISOString(),
    idempotentReplay,providerFinality:"NOT_ESTABLISHED" as const,
    canReleaseStock:false as const,
  };
}

/** Human-supplied support notes are NEVER trusted payment/finality evidence.
 * All side effects are an append-only note and an idempotent audit record.
 */
export async function appendHubtelCancellationInvestigationEvent(
  pool:DatabasePool,input:{
    businessId:string;investigationId:string;actorUserId:string;
    clientRequestId:string;eventKind:unknown;providerReport?:unknown;
    evidenceReference?:unknown;note:unknown;
  },
){
  [input.businessId,input.investigationId,input.actorUserId,
    input.clientRequestId].forEach(validId);
  const entry=normalizedInput(input);
  return withTransaction(pool,async(tx)=>{
    // Serializes note creation for the same case, without locking the payment
    // or changing an independently verified Hubtel sale.
    const investigation=(await tx.query<CaseRow>(
      "SELECT id,business_id,branch_id FROM hubtel_pos_cancellation_investigations "+
      "WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [input.investigationId,input.businessId],
    )).rows[0];
    if(!investigation)posFail("Investigation case was not found.",
      "HUBTEL_INVESTIGATION_EVENT_CASE_NOT_FOUND",404);
    const existing=(await tx.query<EventRow>(
      "SELECT * FROM hubtel_pos_cancellation_investigation_events "+
      "WHERE investigation_id=$1 AND client_request_id=$2",
      [investigation.id,input.clientRequestId],
    )).rows[0];
    if(existing){
      const same=existing.event_kind===entry.eventKind &&
        existing.provider_report===entry.providerReport &&
        existing.evidence_reference===entry.evidenceReference &&
        existing.note===entry.note;
      if(!same)posFail("This request ID was used for a different investigation update.",
        "HUBTEL_INVESTIGATION_EVENT_IDEMPOTENCY_CONFLICT",409);
      return {event:publicEvent(existing,true)};
    }
    const created=(await tx.query<EventRow>(
      "INSERT INTO hubtel_pos_cancellation_investigation_events("+
      "investigation_id,business_id,branch_id,actor_user_id,client_request_id,"+
      "event_kind,provider_report,evidence_reference,note) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [investigation.id,input.businessId,investigation.branch_id,
        input.actorUserId,input.clientRequestId,entry.eventKind,
        entry.providerReport,entry.evidenceReference,entry.note],
    )).rows[0];
    if(!created)posFail("Investigation update could not be recorded.",
      "HUBTEL_INVESTIGATION_EVENT_RETRY_REQUIRED",409);
    await tx.query(
      "INSERT INTO audit_events(business_id,branch_id,event_type,entity_type,"+
      "entity_id,correlation_id,payload,occurred_at) "+
      "VALUES($1,$2,'HUBTEL_CANCELLATION_INVESTIGATION_EVENT_RECORDED',"+
      "'HUBTEL_CANCELLATION_INVESTIGATION',$3,$4,$5::jsonb,now())",
      [input.businessId,investigation.branch_id,investigation.id,
        created.id,JSON.stringify({
          investigationId:investigation.id,eventId:created.id,
          actorUserId:input.actorUserId,eventKind:entry.eventKind,
          providerFinality:"NOT_ESTABLISHED",stockRelease:false,
        })],
    );
    return {event:publicEvent(created,false)};
  });
}

export async function listHubtelCancellationInvestigationEvents(
  pool:DatabasePool,input:{businessId:string;investigationId:string;
    limit?:number;offset?:number},
){
  validId(input.businessId);validId(input.investigationId);
  const limit=input.limit??25,offset=input.offset??0;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||
    !Number.isSafeInteger(offset)||offset<0||offset>100000)
    posFail("Invalid investigation timeline page.",
      "HUBTEL_INVESTIGATION_EVENT_PAGE_INVALID",400);
  const c=(await pool.query<CaseRow>(
    "SELECT id,business_id,branch_id FROM hubtel_pos_cancellation_investigations "+
    "WHERE business_id=$1 AND id=$2",
    [input.businessId,input.investigationId],
  )).rows[0];
  if(!c)posFail("Investigation case was not found.",
    "HUBTEL_INVESTIGATION_EVENT_CASE_NOT_FOUND",404);
  const result=await pool.query<EventRow>(
    "SELECT * FROM hubtel_pos_cancellation_investigation_events "+
    "WHERE business_id=$1 AND investigation_id=$2 "+
    "ORDER BY created_at DESC,id DESC LIMIT $3::integer OFFSET $4::integer",
    [input.businessId,input.investigationId,limit,offset],
  );
  const count=(await pool.query<{total:string}>(
    "SELECT count(*)::text AS total FROM hubtel_pos_cancellation_investigation_events "+
    "WHERE business_id=$1 AND investigation_id=$2",
    [input.businessId,input.investigationId],
  )).rows[0]?.total??"0";
  const total=Number(count);
  if(!Number.isSafeInteger(total)||total<0)
    posFail("Investigation event totals exceeded safe precision.",
      "HUBTEL_INVESTIGATION_EVENT_COUNT_INVALID",500);
  return {
    investigationId:c.id,branchId:c.branch_id,
    events:result.rows.map(row=>publicEvent(row,false)),
    total,limit,offset,hasMore:offset+result.rows.length<total,
    providerFinality:"NOT_ESTABLISHED" as const,canReleaseStock:false as const,
  };
}
