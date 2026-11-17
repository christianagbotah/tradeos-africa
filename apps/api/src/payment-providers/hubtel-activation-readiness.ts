import type {DatabasePool} from "../db.js";
import {AuthError} from "../auth/security.js";
import {isGatewayVaultConfigured} from "../payment-providers/vault.js";
import {hubtelPosConnection,hubtelPosGloballyEnabled} from
  "../commerce/hubtel-pos-config.js";
import {selectedGateway} from "./service.js";

type Credential={
  status:"SAVED_UNVERIFIED"|"VERIFIED"|"REVOKED";
  revision:number;account_reference:string|null;verified_at:Date|null;
  activation_requested_at:Date|null;collection_enabled:boolean;
};
type Approval={
  collection_account:string;approval_status:string;enabled:boolean;
  verified_at:Date|null;
};
type Counts={unsettled:string;review:string};
type Step={
  code:string;title:string;status:"DONE"|"NEEDS_ACTION"|"BLOCKED";
  detail:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read-only owner checklist. This code never decrypts credentials or calls
 * Hubtel, and it cannot update sales, the cashbook or collection switches.
 * The "verified" flag only confirms API access, not settlement authority.
 */
export async function getHubtelMerchantActivationReadiness(
  pool:DatabasePool,businessId:string,
){
  if(!UUID.test(businessId))throw new AuthError("Invalid business identifier.",
    400,"HUBTEL_ACTIVATION_BUSINESS_INVALID");
  const [business,creds,approval,counts,preferred,current]=await Promise.all([
    pool.query<{id:string}>("SELECT id FROM businesses WHERE id=$1",[businessId]),
    pool.query<Credential>(
      "SELECT status,revision,account_reference,verified_at,"+
      "activation_requested_at,collection_enabled "+
      "FROM business_merchant_gateway_credentials WHERE "+
      "business_id=$1 AND provider_code='HUBTEL' AND environment='LIVE'",
      [businessId]),
    pool.query<Approval>(
      "SELECT collection_account,approval_status,enabled,verified_at "+
      "FROM business_hubtel_sales_accounts WHERE business_id=$1",[businessId]),
    pool.query<Counts>(
      "SELECT count(*) FILTER(WHERE state IN ('PREPARED','READY',"+
      "'PENDING_VERIFICATION','REVIEW_REQUIRED'))::text AS unsettled,"+
      "count(*) FILTER(WHERE state='REVIEW_REQUIRED')::text AS review "+
      "FROM hubtel_sale_checkout_attempts WHERE business_id=$1",[businessId]),
    selectedGateway(pool,businessId),
    hubtelPosConnection(pool,businessId),
  ]);
  if(!business.rows[0])throw new AuthError("Business not found.",
    404,"HUBTEL_ACTIVATION_BUSINESS_NOT_FOUND");
  const saved=creds.rows[0],approved=approval.rows[0],tally=counts.rows[0];
  const hasKey=Boolean(saved&&saved.status!=="REVOKED");
  const verified=Boolean(hasKey&&saved?.status==="VERIFIED"&&saved.verified_at);
  const requested=Boolean(verified&&saved?.activation_requested_at);
  const accountMatched=Boolean(requested&&approved&&
    approved.collection_account===saved?.account_reference&&
    approved.approval_status==="VERIFIED"&&
    approved.enabled&&approved.verified_at);
  const globallyEnabled=hubtelPosGloballyEnabled();
  const merchantVaultFlag=process.env.TRADEOS_HUBTEL_MERCHANT_POS_ENABLED==="true";
  const vaultReady=isGatewayVaultConfigured();
  const activeFromMerchantVault=Boolean(accountMatched&&globallyEnabled&&
    merchantVaultFlag&&saved?.collection_enabled&&
    current?.credentialSource==="MERCHANT_VAULT");
  const needsProviderChoice=preferred!=="HUBTEL";
  const steps:Step[]=[
    {code:"CREDENTIAL_VAULT",title:"Secure credential storage",
      status:vaultReady?"DONE":"BLOCKED",
      detail:vaultReady?
        "Encrypted merchant API credentials can be saved securely.":
        "Secure key storage is unavailable. Contact TradeOS support."},
    {code:"MERCHANT_CREDENTIALS",title:"Save your Hubtel API credentials",
      status:hasKey?"DONE":"NEEDS_ACTION",
      detail:hasKey?
        "Merchant-owned Hubtel Payment API credentials are saved.":
        "Enter the Hubtel API ID, API Key and Collection Account."},
    {code:"API_ACCESS",title:"Verify collection-account API access",
      status:verified?"DONE":hasKey?"NEEDS_ACTION":"BLOCKED",
      detail:verified?
        "Hubtel confirmed read-only API access; no customer was charged.":
        "Use Verify Hubtel account after saving your credentials."},
    {code:"ACTIVATION_REQUEST",title:"Request account activation",
      status:requested?"DONE":verified?"NEEDS_ACTION":"BLOCKED",
      detail:requested?
        "Your request is recorded for merchant collection review.":
        "Request activation after independent API verification."},
    {code:"PROVIDER_PREFERENCE",title:"Choose Hubtel for electronic sales",
      status:needsProviderChoice?"NEEDS_ACTION":"DONE",
      detail:needsProviderChoice?
        "Select Hubtel and save it as the preferred provider.":
        "Hubtel is the currently selected payment gateway."},
    {code:"ACCOUNT_APPROVAL",title:"Merchant collection-account approval",
      status:accountMatched?"DONE":"BLOCKED",
      detail:accountMatched?
        "TradeOS has approved this matching merchant collection account.":
        "Await TradeOS approval of the exact collection account and settlement ownership."},
    {code:"POS_RELEASE",title:"Safe collection and settlement activation",
      status:activeFromMerchantVault?"DONE":"BLOCKED",
      detail:activeFromMerchantVault?
        "Merchant POS collection is enabled with independent payment verification.":
        "Still gated pending authorized production checkout, refunds and settlement checks."},
  ];
  return {
    businessId,providerCode:"HUBTEL" as const,environment:"LIVE" as const,
    merchantCredentialStatus:saved?.status??"NOT_CONFIGURED",
    credentialRevision:saved?.revision??null,
    accountReference:saved?.account_reference??null,
    activationRequested:requested,accountApproved:accountMatched,
    preferredProvider:preferred,
    merchantCollectionEnabled:activeFromMerchantVault,
    existingLegacyCollectionEnabled:current?.credentialSource==="PLATFORM_ALIAS",
    unsettledPayments:Number(tally?.unsettled??0),
    reviewRequired:Number(tally?.review??0),
    steps,notice:activeFromMerchantVault?
      "Customer payments still require independently verified settlement.":
      "Saving API keys and verifying account access do not enable money collection. "+
      "Current merchant POS collection is disabled until all release gates pass.",
  };
}
