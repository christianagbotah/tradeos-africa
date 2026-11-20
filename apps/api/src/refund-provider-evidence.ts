import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole } from "./auth/authorization.js";
import { withTransaction, type DatabasePool } from "./db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDERS = ["HUBTEL","PAYSTACK","FLUTTERWAVE","OTHER"] as const;
const CLAIM_STATES = ["CLAIMED_SUCCESS","CLAIMED_PENDING","CLAIMED_FAILED"] as const;
const DECISIONS = ["FIELDS_MATCHED_UNVERIFIED","DISCREPANCY_RECORDED",
  "PROVIDER_CONFIRMATION_NEEDED"] as const;
const ROLES = ["OWNER","ADMIN","MANAGER","ACCOUNTANT"] as const;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,139}$/;
const CASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.:/-]{5,139}$/;
const INVALID_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

type Provider = typeof PROVIDERS[number];
type ClaimState = typeof CLAIM_STATES[number];
type Decision = typeof DECISIONS[number];
type Refund = {
  id: string; status: "PENDING"|"FAILED"|"SUCCEEDED";
  method: string; amount_minor: string; currency_code: string;
  original_payment_method: string | null;
};
type ClaimRow = {
  id: string; business_id: string; branch_id: string;
  refund_transaction_id: string; submitted_by_user_id: string;
  client_request_id: string; provider_code: Provider; provider_ref: string;
  reported_amount_minor: string; reported_currency: string;
  recipient_last4: string; reported_status: ClaimState;
  provider_case_ref: string | null; note: string; reported_at: Date | null;
  created_at: Date;
  submitter_name?: string;
  review_id?: string | null; reviewer_user_id?: string | null;
  reviewer_name?: string | null; review_decision?: Decision | null;
  review_note?: string | null; review_created_at?: Date | null;
};
type ReviewRow = {
  id: string; business_id: string; branch_id: string;
  evidence_claim_id: string; reviewer_user_id: string;
  client_request_id: string; decision: Decision;
  note: string; created_at: Date;
  reviewer_name?: string;
};

class EvidenceError extends Error {
  constructor(message: string, readonly statusCode = 400,
    readonly code = "REFUND_EVIDENCE_INVALID") {super(message);}
}
function requiredId(raw: unknown, name: string): string {
  if (typeof raw !== "string" || !UUID.test(raw))
    throw new EvidenceError("A valid " + name + " is required.",400,
      "REFUND_EVIDENCE_ID_INVALID");
  return raw;
}
function requiredEnum<T extends string>(value: unknown, values: readonly T[],
  name: string): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw new EvidenceError("Select a valid " + name + ".",400,
      "REFUND_EVIDENCE_FIELD_INVALID");
  return value as T;
}
function requiredText(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min ||
      value.trim().length > max || INVALID_CONTROL.test(value))
    throw new EvidenceError(
      "Enter " + name + " (" + min + "–" + max + " characters).",400,
      "REFUND_EVIDENCE_TEXT_INVALID");
  // Keep customer destinations, account numbers, document links and secrets out
  // of narrative notes; references have separate purpose-built fields.
  if (/https?:\/\/|www\.|\b\d{7,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:api[_ -]?key|secret|password)\s*[:=]/i.test(value))
    throw new EvidenceError(
      "Do not include full account numbers, links, email addresses or credentials in notes.",
      400,"REFUND_EVIDENCE_SENSITIVE_NOTE");
  return value.trim();
}
function parseReference(raw: unknown, name: string, optional = false) {
  if (optional && (raw === undefined || raw === null || raw === "")) return null;
  if (typeof raw !== "string" ||
      !(optional ? CASE_PATTERN : REF_PATTERN).test(raw.trim()) ||
      raw.includes("://"))
    throw new EvidenceError(
      "Use a provider reference, not a URL, password, or account number.",400,
      "REFUND_EVIDENCE_REFERENCE_INVALID");
  return raw.trim();
}
function safeMinor(value: unknown, name: string) {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return value;
  } else if (typeof value === "string" &&
      /^[1-9][0-9]*$/.test(value) &&
      Number.isSafeInteger(Number(value))) return Number(value);
  throw new EvidenceError("Invalid " + name + " monetary precision.",400,
    "REFUND_EVIDENCE_MONEY_INVALID");
}
function integerFromDb(raw: string, name: string) {
  try { return safeMinor(raw,name); }
  catch { throw new EvidenceError(
    "Refund " + name + " cannot be displayed safely.",500,
    "REFUND_EVIDENCE_UNREPRESENTABLE"); }
}
function reportTime(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(raw))
    throw new EvidenceError("Enter a valid reported timestamp.",400,
      "REFUND_EVIDENCE_TIME_INVALID");
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime()) ||
      d.getTime() > Date.now()+300_000 ||
      d.getTime() < Date.UTC(2018,0,1))
    throw new EvidenceError("Reported time is outside the supported range.",400,
      "REFUND_EVIDENCE_TIME_INVALID");
  return d;
}
function normalizedClaim(body: Record<string,unknown>) {
  const providerCode = requiredEnum(body.providerCode,PROVIDERS,"provider");
  const providerRef = parseReference(body.providerReference,"reference")!;
  const reportedAmountMinor = safeMinor(body.reportedAmountMinor,"claimed amount");
  const reportedCurrency = body.reportedCurrency;
  if (typeof reportedCurrency !== "string" ||
      !/^[A-Z]{3}$/.test(reportedCurrency))
    throw new EvidenceError("Use a three-letter ISO currency code.",400,
      "REFUND_EVIDENCE_CURRENCY_INVALID");
  const recipientLast4 = body.recipientLast4;
  if (typeof recipientLast4 !== "string" ||
      !/^[A-Za-z0-9]{4}$/.test(recipientLast4))
    throw new EvidenceError(
      "Enter only the final four characters of the reported payout destination.",400,
      "REFUND_EVIDENCE_RECIPIENT_INVALID");
  return {
    providerCode, providerRef, reportedAmountMinor, reportedCurrency,
    recipientLast4,
    reportedStatus:requiredEnum(body.reportedStatus,CLAIM_STATES,
      "provider-reported status"),
    providerCaseRef:parseReference(body.providerCaseReference,"support case",true),
    note:requiredText(body.note,"the evidence note",20,700),
    reportedAt:reportTime(body.reportedAt),
  };
}
function normalizedReview(body: Record<string,unknown>) {
  return {
    decision:requiredEnum(body.decision,DECISIONS,"review decision"),
    note:requiredText(body.note,"the review note",20,700),
  };
}
function toReview(row: ReviewRow | null, idempotentReplay=false) {
  if (!row) return null;
  return {
    reviewId:row.id, reviewerUserId:row.reviewer_user_id,
    reviewerName:row.reviewer_name ?? "Finance reviewer",
    decision:row.decision,note:row.note,
    reviewedAt:row.created_at.toISOString(),
    idempotentReplay, providerAuthenticated:false as const,
    providerFinality:"NOT_ESTABLISHED" as const,
  };
}
function claimPublic(row:ClaimRow, refund:Refund, idempotentReplay=false) {
  return {
    claimId:row.id,refundId:row.refund_transaction_id,
    submittedByUserId:row.submitted_by_user_id,
    submittedByName:row.submitter_name??"Finance member",
    providerCode:row.provider_code,providerReference:row.provider_ref,
    reportedAmountMinor:integerFromDb(row.reported_amount_minor,"claim amount"),
    reportedCurrency:row.reported_currency,
    expectedAmountMinor:integerFromDb(refund.amount_minor,"amount"),
    expectedCurrency:refund.currency_code,
    amountMatches:row.reported_amount_minor===refund.amount_minor,
    currencyMatches:row.reported_currency===refund.currency_code,
    recipientLast4:row.recipient_last4,reportedStatus:row.reported_status,
    providerCaseReference:row.provider_case_ref,
    note:row.note,reportedAt:row.reported_at?.toISOString()??null,
    submittedAt:row.created_at.toISOString(),
    review:row.review_id && row.reviewer_user_id && row.review_created_at &&
      row.review_decision && row.review_note
      ? {
        reviewId:row.review_id,reviewerUserId:row.reviewer_user_id,
        reviewerName:row.reviewer_name??"Finance reviewer",
        decision:row.review_decision,note:row.review_note,
        reviewedAt:row.review_created_at.toISOString(),
        providerAuthenticated:false as const,
        providerFinality:"NOT_ESTABLISHED" as const,
      } : null,
    idempotentReplay, evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED" as const,
    providerAuthenticated:false as const,
    refundDestinationAuthenticated:false as const,
    providerFinality:"NOT_ESTABLISHED" as const,
    canMarkPaid:false as const,
    payoutStatusUnchanged:true as const,
  };
}
function asError(request:{log:{error:(error:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},
  error:unknown) {
  if (error instanceof EvidenceError || error instanceof AuthError)
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  if (typeof error==="object" && error!==null && "code" in error &&
      error.code==="23505")
    return reply.code(409).send({error:"REFUND_EVIDENCE_DUPLICATE_REFERENCE",
      message:"This provider refund reference or review was already recorded."});
  request.log.error(error);
  return reply.code(500).send({error:"REFUND_EVIDENCE_FAILED",
    message:"The provider evidence review could not be completed."});
}
const REFUND_QUERY = `
 SELECT rt.id,rt.status,rt.amount_minor::text,rt.currency_code,rt.method,
        p.method AS original_payment_method
 FROM refund_transactions rt
 JOIN return_cases rc ON rc.id=rt.return_case_id
   AND rc.business_id=rt.business_id AND rc.branch_id=$3
 LEFT JOIN payments p ON p.id=rt.original_payment_id
   AND p.business_id=rt.business_id AND p.branch_id=rc.branch_id
   AND p.sale_id=rc.original_sale_id
 WHERE rt.id=$1 AND rt.business_id=$2
`;
async function lookupRefund(db:{query:DatabasePool["query"]},
  refundId:string,businessId:string,branchId:string,lock=false):Promise<Refund> {
  const r=(await db.query<Refund>(
    REFUND_QUERY+(lock?" FOR UPDATE OF rt":""),
    [refundId,businessId,branchId])).rows[0];
  if (!r) throw new EvidenceError("Refund was not found in this branch.",404,
    "REFUND_EVIDENCE_REFUND_NOT_FOUND");
  return r;
}
function isElectronic(refund:Refund) {
  return ["MOMO","CARD","BANK"].includes(refund.method) ||
    (refund.method==="ORIGINAL_METHOD" &&
      ["MOMO","CARD","BANK"].includes(refund.original_payment_method??""));
}
function pageNumber(raw:unknown,fallback:number,max:number,name:string){
  if (raw===undefined)return fallback;
  if(typeof raw!=="string" || !/^(0|[1-9][0-9]*)$/.test(raw) ||
      !Number.isSafeInteger(Number(raw))||Number(raw)>max||
      (name==="limit"&&Number(raw)<1))
    throw new EvidenceError("Invalid evidence "+name+".",400,
      "REFUND_EVIDENCE_PAGE_INVALID");
  return Number(raw);
}
export function registerRefundProviderEvidenceRoutes(app:FastifyInstance,
  pool:DatabasePool):void{
  async function authorize(headers:{authorization?:string|undefined},
    businessId:string,branchId:string) {
    const auth=await authenticateAccessToken(pool,headers.authorization);
    await requireBusinessRole(pool,auth,businessId,ROLES);
    const branch=await pool.query(
      "SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
      [branchId,businessId]);
    if(branch.rowCount!==1)
      throw new EvidenceError("Branch is not available to this business.",404,
        "REFUND_EVIDENCE_BRANCH_NOT_FOUND");
    return auth;
  }
  // Read-only business + branch scoped history. No provider verification state.
  app.get<{Querystring:{
    businessId?:string;branchId?:string;refundId?:string;
    limit?:string;offset?:string;
  }}>(
    "/v1/refunds/provider-evidence",async(request,reply)=>{
      reply.header("Cache-Control","private, no-store, max-age=0");
      try{
        const businessId=requiredId(request.query.businessId,"business ID");
        const branchId=requiredId(request.query.branchId,"branch ID");
        const refundId=requiredId(request.query.refundId,"refund ID");
        await authorize(request.headers,businessId,branchId);
        const limit=pageNumber(request.query.limit,20,100,"limit");
        const offset=pageNumber(request.query.offset,0,100000,"offset");
        const refund=await lookupRefund(pool,refundId,businessId,branchId);
        const r=await pool.query<ClaimRow>(
          `SELECT c.*,u.display_name AS submitter_name,
                  v.id AS review_id,v.reviewer_user_id,v.decision AS review_decision,
                  v.note AS review_note,v.created_at AS review_created_at,
                  reviewer.display_name AS reviewer_name
           FROM refund_provider_evidence_claims c
           JOIN app_users u ON u.id=c.submitted_by_user_id
           LEFT JOIN refund_provider_evidence_reviews v ON v.evidence_claim_id=c.id
           LEFT JOIN app_users reviewer ON reviewer.id=v.reviewer_user_id
           WHERE c.business_id=$1 AND c.branch_id=$2 AND c.refund_transaction_id=$3
           ORDER BY c.created_at DESC,c.id DESC LIMIT $4 OFFSET $5`,
          [businessId,branchId,refundId,limit+1,offset],
        );
        return {
          refundId, refundStatus:refund.status,
          expectedAmountMinor:integerFromDb(refund.amount_minor,"amount"),
          expectedCurrency:refund.currency_code,
          electronicRefund:isElectronic(refund),
          items:r.rows.slice(0,limit).map(row=>claimPublic(row,refund)),
          hasMore:r.rows.length>limit,offset,
          evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED" as const,
          providerFinality:"NOT_ESTABLISHED" as const,
          canMarkPaid:false as const,
        };
      }catch(error){return asError(request,reply,error);}
    });
  app.post<{Body:Record<string,unknown>}>(
    "/v1/refunds/provider-evidence",async(request,reply)=>{
      reply.header("Cache-Control","private, no-store, max-age=0");
      try{
        const body=request.body??{};
        const businessId=requiredId(body.businessId,"business ID");
        const branchId=requiredId(body.branchId,"branch ID");
        const refundId=requiredId(body.refundId,"refund ID");
        const clientRequestId=requiredId(body.clientRequestId,"request ID");
        const claim=normalizedClaim(body);
        const auth=await authorize(request.headers,businessId,branchId);
        const saved=await withTransaction(pool,async tx=>{
          // Lock the specific refund; exact retries remain safe even if
          // the request was accepted before a refund closed.
          const refund=await lookupRefund(tx,refundId,businessId,branchId,true);
          const previous=(await tx.query<ClaimRow>(
            `SELECT * FROM refund_provider_evidence_claims
             WHERE refund_transaction_id=$1 AND client_request_id=$2`,
            [refundId,clientRequestId])).rows[0];
          if(previous){
            if(previous.submitted_by_user_id!==auth.userId||
               previous.provider_code!==claim.providerCode||
               previous.provider_ref!==claim.providerRef||
               previous.reported_amount_minor!==String(claim.reportedAmountMinor)||
               previous.reported_currency!==claim.reportedCurrency||
               previous.recipient_last4!==claim.recipientLast4||
               previous.reported_status!==claim.reportedStatus||
               previous.provider_case_ref!==claim.providerCaseRef||
               previous.note!==claim.note||
               (previous.reported_at?.getTime()??null)!==
                 (claim.reportedAt?.getTime()??null))
              throw new EvidenceError("This request ID was used with different evidence.",
                409,"REFUND_EVIDENCE_IDEMPOTENCY_CONFLICT");
            return claimPublic(previous,refund,true);
          }
          if(!["PENDING","FAILED"].includes(refund.status)||!isElectronic(refund))
            throw new EvidenceError(
              "Only unresolved electronic refunds can receive provider evidence claims.",
              409,"REFUND_EVIDENCE_NOT_ELIGIBLE");
          const made=(await tx.query<ClaimRow>(
            `INSERT INTO refund_provider_evidence_claims
              (business_id,branch_id,refund_transaction_id,submitted_by_user_id,
               client_request_id,provider_code,provider_ref,reported_amount_minor,
               reported_currency,recipient_last4,reported_status,provider_case_ref,
               note,reported_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING *`,
            [businessId,branchId,refundId,auth.userId,clientRequestId,
              claim.providerCode,claim.providerRef,claim.reportedAmountMinor,
              claim.reportedCurrency,claim.recipientLast4,claim.reportedStatus,
              claim.providerCaseRef,claim.note,claim.reportedAt])).rows[0];
          if(!made)throw new EvidenceError("Evidence claim could not be recorded.",
            409,"REFUND_EVIDENCE_SAVE_FAILED");
          await tx.query(
            `INSERT INTO audit_events
             (business_id,branch_id,event_type,entity_type,entity_id,
              correlation_id,payload,occurred_at)
             VALUES($1,$2,'REFUND_PROVIDER_CLAIM_SUBMITTED','REFUND_TRANSACTION',
               $3,$4,$5::jsonb,now())`,
            [businessId,branchId,refundId,made.id,JSON.stringify({
              claimId:made.id,actorUserId:auth.userId,
              source:"MERCHANT_SUPPLIED_UNVERIFIED",
              payoutStatusUnchanged:true,providerAuthenticated:false,
            })]);
          return claimPublic(made,refund);
        });
        return reply.code(saved.idempotentReplay?200:201).send({claim:saved});
      }catch(error){return asError(request,reply,error);}
    });
  app.post<{Body:Record<string,unknown>}>(
    "/v1/refunds/provider-evidence-review",async(request,reply)=>{
      reply.header("Cache-Control","private, no-store, max-age=0");
      try{
        const body=request.body??{};
        const businessId=requiredId(body.businessId,"business ID");
        const branchId=requiredId(body.branchId,"branch ID");
        const refundId=requiredId(body.refundId,"refund ID");
        const claimId=requiredId(body.claimId,"claim ID");
        const clientRequestId=requiredId(body.clientRequestId,"request ID");
        const review=normalizedReview(body);
        const auth=await authorize(request.headers,businessId,branchId);
        const saved=await withTransaction(pool,async tx=>{
          const refund=await lookupRefund(tx,refundId,businessId,branchId,true);
          const claim=(await tx.query<ClaimRow>(
            `SELECT * FROM refund_provider_evidence_claims
             WHERE id=$1 AND business_id=$2 AND branch_id=$3
               AND refund_transaction_id=$4`,
            [claimId,businessId,branchId,refundId])).rows[0];
          if(!claim)throw new EvidenceError("Evidence claim was not found.",
            404,"REFUND_EVIDENCE_CLAIM_NOT_FOUND");
          const existing=(await tx.query<ReviewRow>(
            `SELECT * FROM refund_provider_evidence_reviews
             WHERE evidence_claim_id=$1`,
            [claimId])).rows[0];
          if(existing){
            if(existing.reviewer_user_id!==auth.userId||
               existing.client_request_id!==clientRequestId||
               existing.decision!==review.decision||existing.note!==review.note)
              throw new EvidenceError("Evidence has already been reviewed.",
                409,"REFUND_EVIDENCE_REVIEW_CONFLICT");
            return toReview(existing,true);
          }
          if(refund.status!=="PENDING" && refund.status!=="FAILED")
            throw new EvidenceError("Closed refunds cannot receive new evidence reviews.",
              409,"REFUND_EVIDENCE_ALREADY_CLOSED");
          if(auth.userId===claim.submitted_by_user_id)
            throw new EvidenceError(
              "A different authorized member must review this evidence.",
              403,"REFUND_EVIDENCE_SECOND_REVIEWER_REQUIRED");
          if(review.decision==="FIELDS_MATCHED_UNVERIFIED" &&
             (claim.reported_amount_minor!==refund.amount_minor||
               claim.reported_currency!==refund.currency_code))
            throw new EvidenceError(
              "The amount or currency differs; record a discrepancy instead.",
              409,"REFUND_EVIDENCE_AMOUNT_CURRENCY_MISMATCH");
          const created=(await tx.query<ReviewRow>(
            `INSERT INTO refund_provider_evidence_reviews
              (business_id,branch_id,evidence_claim_id,reviewer_user_id,
               client_request_id,decision,note)
             VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [businessId,branchId,claimId,auth.userId,clientRequestId,
              review.decision,review.note])).rows[0];
          if(!created)throw new EvidenceError("Evidence review could not be recorded.",
            409,"REFUND_EVIDENCE_REVIEW_SAVE_FAILED");
          await tx.query(
            `INSERT INTO audit_events
             (business_id,branch_id,event_type,entity_type,entity_id,
              correlation_id,payload,occurred_at)
             VALUES($1,$2,'REFUND_PROVIDER_CLAIM_REVIEWED','REFUND_TRANSACTION',
               $3,$4,$5::jsonb,now())`,
            [businessId,branchId,refundId,created.id,JSON.stringify({
              claimId,reviewId:created.id,reviewerUserId:auth.userId,
              decision:review.decision,providerAuthenticated:false,
              payoutStatusUnchanged:true,
            })]);
          return toReview(created);
        });
        return reply.code(saved?.idempotentReplay?200:201).send({review:saved,
          providerFinality:"NOT_ESTABLISHED",canMarkPaid:false});
      }catch(error){return asError(request,reply,error);}
    });
}
