import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {PlatformAdminError,type PlatformAdminContext} from "./security.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAN_REVIEW=new Set(["SUPER_ADMIN","PLATFORM_ADMIN"]);
const CAN_READ=new Set(["SUPER_ADMIN","PLATFORM_ADMIN","OPERATIONS"]);
type Decision="APPROVED"|"REJECTED";
type Row={
  business_id:string;business_name:string;country_code:string;currency_code:string;
  credential_status:string;credential_revision:number;account_reference:string|null;
  verified_at:Date|null;activation_requested_at:Date|null;
  existing_collection_account:string|null;existing_approval_status:string|null;
  review_decision:Decision|null;review_version:number|null;
  review_credential_revision:number|null;review_account_reference:string|null;
  review_evidence_reference:string|null;review_rationale:string|null;
  review_beneficiary_ownership_confirmed:boolean|null;
  reviewed_at:Date|null;
};
type Version={review_version:number;credential_revision:number;
  account_reference:string;decision:Decision;
  evidence_reference:string;rationale:string};
const COLUMNS=`
  c.business_id,b.name AS business_name,b.country_code,b.currency_code,
  c.status AS credential_status,c.revision AS credential_revision,
  c.account_reference,c.verified_at,c.activation_requested_at,
  h.collection_account AS existing_collection_account,
  h.approval_status AS existing_approval_status,
  r.decision AS review_decision,r.review_version,
  r.credential_revision AS review_credential_revision,
  r.account_reference AS review_account_reference,
  r.evidence_reference AS review_evidence_reference,
  r.rationale AS review_rationale,
  r.beneficiary_ownership_confirmed AS review_beneficiary_ownership_confirmed,
  r.reviewed_at
`;
function role(actor:PlatformAdminContext,write:boolean){
  if(!(write?CAN_REVIEW:CAN_READ).has(actor.role))
    throw new PlatformAdminError(
      "Your platform role cannot review merchant collection accounts.",
      403,"ADMIN_HUBTEL_REVIEW_FORBIDDEN");
}
function requireBusiness(id:string){
  if(!UUID.test(id))throw new PlatformAdminError(
    "A valid business ID is required.",400,"ADMIN_HUBTEL_REVIEW_ID_INVALID");
}
function project(row:Row){
  const current=Boolean(row.review_decision&&
    row.review_credential_revision===row.credential_revision&&
    row.review_account_reference===row.account_reference);
  const requested=Boolean(row.credential_status==="VERIFIED"&&
    row.verified_at&&row.activation_requested_at);
  return {
    businessId:row.business_id,businessName:row.business_name,
    countryCode:row.country_code.trim(),
    currencyCode:row.currency_code.trim(),
    providerCode:"HUBTEL" as const,
    merchantCredentialStatus:row.credential_status,
    credentialRevision:row.credential_revision,
    collectionAccount:row.account_reference,
    activationRequested:requested,
    legacyCollectionAccount:row.existing_collection_account,
    legacyAccountApproval:row.existing_approval_status,
    reviewVersion:row.review_version??0,
    reviewStatus:current?row.review_decision:"PENDING" as const,
    evidenceReference:current?row.review_evidence_reference:null,
    reviewRationale:current?row.review_rationale:null,
    beneficiaryOwnershipConfirmed:current?
      row.review_beneficiary_ownership_confirmed===true:false,
    reviewedAt:current?row.reviewed_at?.toISOString()??null:null,
    collectionEnabled:false,
  };
}
export async function listHubtelMerchantAccountReviews(
  pool:DatabasePool,actor:PlatformAdminContext,
  options:{limit?:number}={},
){
  role(actor,false);
  const limit=Math.max(1,Math.min(100,Math.floor(options.limit??50)||50));
  const rows=await pool.query<Row>(
    "SELECT "+COLUMNS+" FROM business_merchant_gateway_credentials c "+
    "JOIN businesses b ON b.id=c.business_id "+
    "LEFT JOIN business_hubtel_sales_accounts h ON h.business_id=c.business_id "+
    "LEFT JOIN hubtel_merchant_account_reviews r ON r.business_id=c.business_id "+
    "WHERE c.provider_code='HUBTEL' AND c.environment='LIVE' "+
    "AND c.status='VERIFIED' AND c.activation_requested_at IS NOT NULL "+
    "AND b.status='ACTIVE' "+
    "ORDER BY (r.decision IS DISTINCT FROM 'APPROVED' OR "+
    "r.credential_revision IS DISTINCT FROM c.revision OR "+
    "r.account_reference IS DISTINCT FROM c.account_reference) DESC,"+
    "c.activation_requested_at DESC,c.business_id LIMIT $1",
    [limit]);
  return {reviews:rows.rows.map(project),collectionEnabled:false};
}
function details(input:{decision:unknown;evidenceReference:unknown;
  rationale:unknown;beneficiaryOwnershipConfirmed:unknown;
  expectedCredentialRevision:unknown;expectedReviewVersion:unknown}){
  if(input.decision!=="APPROVED"&&input.decision!=="REJECTED")
    throw new PlatformAdminError("Select Approve or Reject.",
      400,"ADMIN_HUBTEL_REVIEW_DECISION_INVALID");
  if(!Number.isSafeInteger(input.expectedCredentialRevision)||
     (input.expectedCredentialRevision as number)<1||
     !Number.isSafeInteger(input.expectedReviewVersion)||
     (input.expectedReviewVersion as number)<0)
    throw new PlatformAdminError("Reload the merchant record before reviewing.",
      400,"ADMIN_HUBTEL_REVIEW_VERSION_INVALID");
  if(typeof input.evidenceReference!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9 _.:/\-]{7,179}$/.test(
       input.evidenceReference.trim()))
    throw new PlatformAdminError(
      "Enter an approved internal evidence/case reference, not a URL containing secrets.",
      400,"ADMIN_HUBTEL_REVIEW_EVIDENCE_INVALID");
  if(typeof input.rationale!=="string"||
     input.rationale.trim().length<12||
     input.rationale.trim().length>500)
    throw new PlatformAdminError("Explain the review outcome in 12–500 characters.",
      400,"ADMIN_HUBTEL_REVIEW_RATIONALE_INVALID");
  if(input.decision==="APPROVED"&&input.beneficiaryOwnershipConfirmed!==true)
    throw new PlatformAdminError(
      "Confirm independently reviewed collection-account beneficiary evidence.",
      400,"ADMIN_HUBTEL_BENEFICIARY_NOT_CONFIRMED");
  return {
    decision:input.decision as Decision,
    evidenceReference:input.evidenceReference.trim(),
    rationale:input.rationale.trim(),
    beneficiaryOwnershipConfirmed:input.beneficiaryOwnershipConfirmed===true,
    expectedCredentialRevision:input.expectedCredentialRevision as number,
    expectedReviewVersion:input.expectedReviewVersion as number,
  };
}
export async function reviewHubtelMerchantAccount(pool:DatabasePool,
  actor:PlatformAdminContext,businessId:string,input:{
    decision:unknown;evidenceReference:unknown;rationale:unknown;
    beneficiaryOwnershipConfirmed:unknown;expectedCredentialRevision:unknown;
    expectedReviewVersion:unknown;
  }){
  role(actor,true);requireBusiness(businessId);
  const args=details(input);
  return withTransaction(pool,async tx=>{
    // Serialize review with merchant key rotations: both use the business row
    // lock as their first shared lock.
    await tx.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE",[businessId]);
    const current=(await tx.query<Row>(
      "SELECT "+COLUMNS+" FROM business_merchant_gateway_credentials c "+
      "JOIN businesses b ON b.id=c.business_id "+
      "LEFT JOIN business_hubtel_sales_accounts h ON h.business_id=c.business_id "+
      "LEFT JOIN hubtel_merchant_account_reviews r ON r.business_id=c.business_id "+
      "WHERE c.business_id=$1 AND c.provider_code='HUBTEL' AND "+
      "c.environment='LIVE' AND b.status='ACTIVE' FOR UPDATE OF c",
      [businessId])).rows[0];
    if(!current||current.credential_status!=="VERIFIED"||
       !current.verified_at||!current.activation_requested_at||
       !current.account_reference)
      throw new PlatformAdminError(
        "Merchant must verify Hubtel access and request activation first.",
        409,"ADMIN_HUBTEL_MERCHANT_NOT_READY");
    if(current.credential_revision!==args.expectedCredentialRevision||
       (current.review_version??0)!==args.expectedReviewVersion)
      throw new PlatformAdminError("This review or merchant key changed. Refresh.",
        409,"ADMIN_HUBTEL_REVIEW_STALE");
    if(current.account_reference===
       process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT)
      throw new PlatformAdminError(
        "A merchant cannot use TradeOS's subscription collection account.",
        409,"ADMIN_HUBTEL_PLATFORM_ACCOUNT_FORBIDDEN");
    if(current.existing_collection_account&&
       current.existing_collection_account!==current.account_reference)
      throw new PlatformAdminError(
        "A different Hubtel account has prior checkout history. "+
        "Reconcile and migrate that account before reviewing the new account.",
        409,"ADMIN_HUBTEL_LEGACY_ACCOUNT_CONFLICT");
    if(args.decision==="APPROVED"&&
       current.country_code.trim()!=="GH")
      throw new PlatformAdminError(
        "Hubtel collection account approval is restricted to Ghana.",
        409,"ADMIN_HUBTEL_MARKET_UNSUPPORTED");
    if(args.decision==="APPROVED"&&
       current.currency_code.trim()!=="GHS")
      throw new PlatformAdminError(
        "Hubtel merchant approval requires a Ghana cedi account.",
        409,"ADMIN_HUBTEL_CURRENCY_UNSUPPORTED");

    const next=(current.review_version??0)+1;
    await tx.query(
      "INSERT INTO hubtel_merchant_account_reviews "+
      "(business_id,account_reference,credential_revision,review_version,"+
      "decision,beneficiary_ownership_confirmed,evidence_reference,rationale,"+
      "reviewed_by_platform_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) "+
      "ON CONFLICT(business_id) DO UPDATE SET "+
      "account_reference=$2,credential_revision=$3,review_version=$4,"+
      "decision=$5,beneficiary_ownership_confirmed=$6,evidence_reference=$7,"+
      "rationale=$8,reviewed_by_platform_user_id=$9,"+
      "reviewed_at=now(),updated_at=now()",
      [businessId,current.account_reference,current.credential_revision,
        next,args.decision,args.beneficiaryOwnershipConfirmed,
        args.evidenceReference,args.rationale,actor.id]);
    await tx.query(
      "INSERT INTO hubtel_merchant_account_review_events "+
      "(business_id,account_reference,credential_revision,review_version,"+
      "decision,beneficiary_ownership_confirmed,evidence_reference,rationale,"+
      "reviewed_by_platform_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [businessId,current.account_reference,current.credential_revision,
        next,args.decision,args.beneficiaryOwnershipConfirmed,
        args.evidenceReference,args.rationale,actor.id]);
    // Deliberately never writes platform Hubtel sales account enabled flags,
    // business_merchant_gateway_credentials.collection_enabled, payments,
    // sales, money accounts, payouts or cashbook.
    return {businessId,credentialRevision:current.credential_revision,
      reviewVersion:next,reviewStatus:args.decision,
      collectionAccount:current.account_reference,collectionEnabled:false};
  });
}
