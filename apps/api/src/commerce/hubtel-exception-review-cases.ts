import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {posFail} from "./hubtel-pos-config.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ReviewAction="ACCOUNTING_REVIEW"|"PROVIDER_INVESTIGATION";
export type ReviewStatus="OPEN"|"AWAITING_APPROVAL"|
  "APPROVED_ACCOUNTING_REVIEW"|"APPROVED_PROVIDER_INVESTIGATION";
type ExceptionRow={id:string;business_id:string;branch_id:string;exception_kind:string};
type CaseRow={id:string;exception_id:string;business_id:string;branch_id:string;
  status:ReviewStatus;recommended_action:ReviewAction|null;
  evidence_reference:string|null;investigator_note:string|null;
  proposed_by_user_id:string|null;approved_by_user_id:string|null;
  revision:number;submitted_at:Date|null;approved_at:Date|null};

function validId(value:string){if(!UUID.test(value))
  posFail("Invalid settlement review identifier.","HUBTEL_REVIEW_INVALID_ID",400);}
function note(value:unknown,min=20,max=700):string{
  if(typeof value!=="string"||value.trim().length<min||
     value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    posFail("Provide a clear review explanation (20–700 characters).",
      "HUBTEL_REVIEW_NOTE_INVALID",400);
  return value.trim();
}
function evidence(value:unknown):string{
  if(typeof value!=="string"||!/(?=.{6,160}$)^[a-zA-Z0-9][a-zA-Z0-9 _.:/\-]*$/.test(value.trim()))
    posFail("Provide an external provider support case or document reference, not credentials.",
      "HUBTEL_REVIEW_EVIDENCE_INVALID",400);
  return value.trim();
}
function version(value:unknown):number{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)
    posFail("Refresh the case to get its latest revision.","HUBTEL_REVIEW_REVISION_REQUIRED",400);
  return value;
}
function action(value:unknown):ReviewAction{
  if(value!=="ACCOUNTING_REVIEW"&&value!=="PROVIDER_INVESTIGATION")
    posFail("Choose a supported review action.","HUBTEL_REVIEW_ACTION_INVALID",400);
  return value;
}
async function exception(tx:{query:DatabasePool["query"]},businessId:string,exceptionId:string){
  const e=(await tx.query<ExceptionRow>(
    "SELECT id,business_id,branch_id,exception_kind "+
    "FROM hubtel_pos_settlement_exceptions WHERE business_id=$1 AND id=$2 FOR UPDATE",
    [businessId,exceptionId])).rows[0];
  if(!e)posFail("Review exception was not found.","HUBTEL_REVIEW_NOT_FOUND",404);
  return e;
}
async function caseRow(tx:{query:DatabasePool["query"]},businessId:string,exceptionId:string){
  return (await tx.query<CaseRow>(
    "SELECT id,exception_id,business_id,branch_id,status,recommended_action,"+
    "evidence_reference,investigator_note,proposed_by_user_id,approved_by_user_id,"+
    "revision,submitted_at,approved_at FROM hubtel_pos_exception_review_cases "+
    "WHERE business_id=$1 AND exception_id=$2 FOR UPDATE",
    [businessId,exceptionId])).rows[0]??null;
}
function asPublic(c:CaseRow|null,exceptionId:string){
  return {
    exceptionId,reviewCaseId:c?.id??null,
    status:c?.status??"OPEN" as ReviewStatus,
    recommendedAction:c?.recommended_action??null,
    evidenceReference:c?.evidence_reference??null,
    investigatorNote:c?.investigator_note??null,
    proposedByUserId:c?.proposed_by_user_id??null,
    approvedByUserId:c?.approved_by_user_id??null,
    revision:c?.revision??0,
    submittedAt:c?.submitted_at?.toISOString()??null,
    approvedAt:c?.approved_at?.toISOString()??null,
  };
}
async function logEvent(tx:{query:DatabasePool["query"]},input:{
  businessId:string;branchId:string;caseId:string;exceptionId:string;
  actorUserId:string;verb:"SUBMITTED"|"APPROVED"|"RETURNED";
  recommendedAction:ReviewAction|null;evidenceReference:string|null;
  reason:string;revision:number;
}){
  await tx.query(
    "INSERT INTO hubtel_pos_exception_review_events "+
    "(review_case_id,business_id,actor_user_id,action,recommended_action,"+
    "evidence_reference,reason,case_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [input.caseId,input.businessId,input.actorUserId,input.verb,
      input.recommendedAction,input.evidenceReference,input.reason,input.revision]);
  await tx.query(
    "INSERT INTO audit_events(business_id,branch_id,event_type,entity_type,"+
    "entity_id,payload) VALUES($1,$2,$3,'HUBTEL_SETTLEMENT_EXCEPTION',$4,$5::jsonb)",
    [input.businessId,input.branchId,"HUBTEL_EXCEPTION_REVIEW_"+input.verb,
      input.exceptionId,JSON.stringify({
        caseId:input.caseId,revision:input.revision,
        recommendedAction:input.recommendedAction,actorUserId:input.actorUserId,
      })]);
}
export async function submitHubtelExceptionReview(pool:DatabasePool,input:{
  businessId:string;exceptionId:string;actorUserId:string;
  expectedRevision:unknown;recommendedAction:unknown;
  evidenceReference:unknown;note:unknown;
}){
  [input.businessId,input.exceptionId,input.actorUserId].forEach(validId);
  const rev=version(input.expectedRevision),recommended=action(input.recommendedAction);
  const ev=evidence(input.evidenceReference),reason=note(input.note);
  return withTransaction(pool,async tx=>{
    const e=await exception(tx,input.businessId,input.exceptionId);
    const existing=await caseRow(tx,input.businessId,input.exceptionId);
    if((existing?.revision??0)!==rev)
      posFail("Review changed; refresh before submitting.","HUBTEL_REVIEW_REVISION_CONFLICT",409);
    if(existing&&existing.status!=="OPEN")
      posFail("This review is already pending or approved.","HUBTEL_REVIEW_ALREADY_SUBMITTED",409);
    const result=(await tx.query<CaseRow>(
      "INSERT INTO hubtel_pos_exception_review_cases "+
      "(exception_id,business_id,branch_id,status,recommended_action,"+
      "evidence_reference,investigator_note,proposed_by_user_id,revision,submitted_at) "+
      "VALUES($1,$2,$3,'AWAITING_APPROVAL',$4,$5,$6,$7,$8,now()) "+
      "ON CONFLICT(exception_id) DO UPDATE SET "+
      "status='AWAITING_APPROVAL',recommended_action=EXCLUDED.recommended_action,"+
      "evidence_reference=EXCLUDED.evidence_reference,"+
      "investigator_note=EXCLUDED.investigator_note,"+
      "proposed_by_user_id=EXCLUDED.proposed_by_user_id,"+
      "revision=hubtel_pos_exception_review_cases.revision+1,"+
      "submitted_at=now(),updated_at=now() "+
      "RETURNING id,exception_id,business_id,branch_id,status,recommended_action,"+
      "evidence_reference,investigator_note,proposed_by_user_id,approved_by_user_id,"+
      "revision,submitted_at,approved_at",
      [e.id,input.businessId,e.branch_id,recommended,ev,reason,
        input.actorUserId,rev+1])).rows[0]!;
    await logEvent(tx,{businessId:input.businessId,branchId:e.branch_id,
      exceptionId:e.id,caseId:result.id,actorUserId:input.actorUserId,
      verb:"SUBMITTED",recommendedAction:recommended,evidenceReference:ev,
      reason,revision:result.revision});
    return asPublic(result,e.id);
  });
}

export async function decideHubtelExceptionReview(pool:DatabasePool,input:{
  businessId:string;exceptionId:string;actorUserId:string;
  expectedRevision:unknown;decision:unknown;note:unknown;
}){
  [input.businessId,input.exceptionId,input.actorUserId].forEach(validId);
  const rev=version(input.expectedRevision);
  if(input.decision!=="APPROVE"&&input.decision!=="RETURN")
    posFail("Choose approve or return for more evidence.","HUBTEL_REVIEW_DECISION_INVALID",400);
  const reason=note(input.note);
  return withTransaction(pool,async tx=>{
    const e=await exception(tx,input.businessId,input.exceptionId);
    const current=await caseRow(tx,input.businessId,input.exceptionId);
    if(!current||current.status!=="AWAITING_APPROVAL")
      posFail("Only submitted reviews can be decided.","HUBTEL_REVIEW_NOT_PENDING",409);
    if(current.revision!==rev)
      posFail("Review changed; refresh before deciding.","HUBTEL_REVIEW_REVISION_CONFLICT",409);
    if(current.proposed_by_user_id===input.actorUserId)
      posFail("A different owner or administrator must make the second decision.",
        "HUBTEL_REVIEW_SELF_APPROVAL_FORBIDDEN",403);
    const approved=input.decision==="APPROVE";
    const next=approved
      ?current.recommended_action==="ACCOUNTING_REVIEW"
        ?"APPROVED_ACCOUNTING_REVIEW":"APPROVED_PROVIDER_INVESTIGATION"
      :"OPEN";
    const updated=(await tx.query<CaseRow>(
      "UPDATE hubtel_pos_exception_review_cases SET status=$3,"+
      "approved_by_user_id=$4,approved_at=$5,revision=revision+1,"+
      "updated_at=now() WHERE business_id=$1 AND exception_id=$2 "+
      "RETURNING id,exception_id,business_id,branch_id,status,recommended_action,"+
      "evidence_reference,investigator_note,proposed_by_user_id,approved_by_user_id,"+
      "revision,submitted_at,approved_at",
      [input.businessId,e.id,next,approved?input.actorUserId:null,
        approved?new Date():null])).rows[0]!;
    await logEvent(tx,{businessId:input.businessId,branchId:e.branch_id,
      caseId:updated.id,exceptionId:e.id,actorUserId:input.actorUserId,
      verb:approved?"APPROVED":"RETURNED",
      recommendedAction:current.recommended_action,
      evidenceReference:current.evidence_reference,
      reason,revision:updated.revision});
    return asPublic(updated,e.id);
  });
}

export async function listHubtelExceptionReviewCases(pool:DatabasePool,input:{
  businessId:string;branchId?:string;limit?:number;
}){
  validId(input.businessId);
  if(input.branchId)validId(input.branchId);
  const limit=Math.min(100,Math.max(1,Number.isSafeInteger(input.limit)&&input.limit!?input.limit:50));
  const rows=await pool.query<{
    exception_id:string;sale_id:string;branch_id:string;exception_kind:string;
    detected_at:Date;status:ReviewStatus|null;recommended_action:ReviewAction|null;
    evidence_reference:string|null;investigator_note:string|null;
    proposed_by_user_id:string|null;approved_by_user_id:string|null;
    revision:number|null;submitted_at:Date|null;approved_at:Date|null;
  }>(
    "SELECT e.id AS exception_id,e.sale_id,e.branch_id,e.exception_kind,e.detected_at,"+
    "c.status,c.recommended_action,c.evidence_reference,c.investigator_note,"+
    "c.proposed_by_user_id,c.approved_by_user_id,c.revision,c.submitted_at,c.approved_at "+
    "FROM hubtel_pos_settlement_exceptions e "+
    "LEFT JOIN hubtel_pos_exception_review_cases c ON c.exception_id=e.id "+
    "AND c.business_id=e.business_id "+
    "WHERE e.business_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2::uuid) "+
    "ORDER BY CASE WHEN c.status IS NULL OR c.status='OPEN' THEN 0 "+
    "WHEN c.status='AWAITING_APPROVAL' THEN 1 ELSE 2 END,"+
    "e.detected_at DESC,e.id DESC LIMIT $3::integer",
    [input.businessId,input.branchId??null,limit]);
  return {cases:rows.rows.map(r=>({
    exceptionId:r.exception_id,saleId:r.sale_id,branchId:r.branch_id,
    exceptionKind:r.exception_kind,detectedAt:r.detected_at.toISOString(),
    status:r.status??"OPEN" as ReviewStatus,
    recommendedAction:r.recommended_action,
    evidenceReference:r.evidence_reference,
    investigatorNote:r.investigator_note,
    proposedByUserId:r.proposed_by_user_id,
    approvedByUserId:r.approved_by_user_id,
    revision:r.revision??0,
    submittedAt:r.submitted_at?.toISOString()??null,
    approvedAt:r.approved_at?.toISOString()??null,
  }))};
}
