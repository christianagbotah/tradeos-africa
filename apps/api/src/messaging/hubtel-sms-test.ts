import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {reauthenticateSensitiveSettings} from "../payment-providers/connections.js";
import {unsealSmsProviderSecret} from "../payment-providers/vault.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER=/^233[0-9]{9}$/;
const MESSAGE="TradeOS Hubtel SMS connection test. No action is required.";
const ENDPOINT="https://sms.hubtel.com/v1/messages/send";
type State="INITIATING"|"ACCEPTED"|"OUTCOME_UNKNOWN";
type Row={id:string;business_id:string;client_request_id:string;state:State;
  provider_message_id:string|null;created_at:Date};
type Connection={revision:number;account_id:string|null;sender_id:string;
  credential_status:string;encrypted_secret:Buffer|null;nonce:Buffer|null;
  auth_tag:Buffer|null;vault_key_version:1};
export function normalizeHubtelSmsTestNumber(raw:unknown):string{
  if(typeof raw!=="string")throw new AuthError("Enter your Ghana mobile number.",
    400,"HUBTEL_SMS_TEST_RECIPIENT_INVALID");
  const number=raw.replace(/[\s()-]/g,"").replace(/^\+/,"");
  const normalized=number.startsWith("0")?"233"+number.slice(1):number;
  if(!NUMBER.test(normalized))throw new AuthError(
    "Enter a Ghana mobile number beginning with 0 or +233.",
    400,"HUBTEL_SMS_TEST_RECIPIENT_INVALID");
  return normalized;
}
export async function submitHubtelSmsTest(input:{
  clientId:string;secret:string;senderId:string;recipient:string;
  fetchImpl?:typeof fetch;
}):Promise<string>{
  if(!input.clientId||!input.secret||input.clientId.includes(":")||
     /[\r\n]/.test(input.clientId+input.secret)||
     !/^[A-Za-z0-9]{1,11}$/.test(input.senderId)||
     !NUMBER.test(input.recipient))throw new AuthError(
    "Invalid Hubtel SMS test configuration.",400,"HUBTEL_SMS_TEST_CONFIG_INVALID");
  let response:Response;
  try{
    response=await (input.fetchImpl??fetch)(ENDPOINT,{
      method:"POST",headers:{
        authorization:"Basic "+Buffer.from(input.clientId+":"+input.secret).toString("base64"),
        accept:"application/json","content-type":"application/json",
      },body:JSON.stringify({From:input.senderId,To:input.recipient,Content:MESSAGE}),
      signal:AbortSignal.timeout(12000),
    });
  }catch{
    throw new AuthError("Hubtel SMS network outcome is uncertain. Do not retry.",
      503,"HUBTEL_SMS_TEST_OUTCOME_UNKNOWN");
  }
  if(response.status!==200&&response.status!==201)throw new AuthError(
    "Hubtel did not accept the SMS test. Check SMS account access and sender ID.",
    503,"HUBTEL_SMS_TEST_NOT_ACCEPTED");
  let data:unknown;
  try{data=await response.json();}catch{
    throw new AuthError("Hubtel SMS response could not be verified.",
      503,"HUBTEL_SMS_TEST_OUTCOME_UNKNOWN");
  }
  const result=data&&typeof data==="object"&&!Array.isArray(data)?
    data as Record<string,unknown>:null;
  if(!result||result.status!==0||typeof result.messageId!=="string"||
    !/^[A-Za-z0-9-]{4,128}$/.test(result.messageId))
    throw new AuthError("Hubtel did not confirm accepting the test SMS.",
      503,"HUBTEL_SMS_TEST_OUTCOME_UNKNOWN");
  return result.messageId as string;
}
function view(row:Row){return {
  attemptId:row.id,state:row.state,environment:"LIVE" as const,
  providerMessageId:row.provider_message_id,
  attemptedAt:row.created_at.toISOString(),
  delivered:false,bulkSendingEnabled:false,
};}

export async function sendHubtelSmsConnectionTest(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;clientRequestId:string;
  recipient:unknown;currentPassword:unknown;confirmOwnership:unknown;
  fetchImpl?:typeof fetch;
}){
  if(![input.businessId,input.actorUserId,input.clientRequestId].every(x=>UUID.test(x)))
    throw new AuthError("Valid SMS test identifiers are required.",
      400,"HUBTEL_SMS_TEST_ID_INVALID");
  if(input.confirmOwnership!==true)throw new AuthError(
    "Confirm that this is your own test mobile number.",
    400,"HUBTEL_SMS_TEST_CONSENT_REQUIRED");
  const recipient=normalizeHubtelSmsTestNumber(input.recipient);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  const claimed=await withTransaction(pool,async tx=>{
    const business=(await tx.query<{id:string}>(
      "SELECT id FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId])).rows[0];
    if(!business)throw new AuthError("Business not found.",404,
      "SMS_BUSINESS_NOT_FOUND");
    const existing=(await tx.query<Row>(
      "SELECT id,business_id,client_request_id,state,provider_message_id,created_at "+
      "FROM hubtel_sms_connection_tests WHERE business_id=$1 AND client_request_id=$2",
      [input.businessId,input.clientRequestId])).rows[0];
    if(existing)return {newlyClaimed:false as const,row:existing};
    const unresolved=(await tx.query<{id:string}>(
      "SELECT id FROM hubtel_sms_connection_tests "+
      "WHERE business_id=$1 AND state IN ('INITIATING','OUTCOME_UNKNOWN') LIMIT 1",
      [input.businessId])).rows[0];
    if(unresolved)throw new AuthError(
      "A previous Hubtel SMS test has an unknown outcome. Resolve it "+
      "with Hubtel before another test.",409,
      "HUBTEL_SMS_TEST_UNRESOLVED");
    const latest=(await tx.query<{id:string}>(
      "SELECT id FROM hubtel_sms_connection_tests "+
      "WHERE business_id=$1 AND created_at>now()-interval '10 minutes' LIMIT 1",
      [input.businessId])).rows[0];
    if(latest)throw new AuthError(
      "Only one Hubtel SMS connection test is allowed per ten minutes.",
      429,"HUBTEL_SMS_TEST_RATE_LIMITED");
    const connection=(await tx.query<Connection>(
      "SELECT revision,account_id,sender_id,credential_status,"+
      "encrypted_secret,nonce,auth_tag,vault_key_version "+
      "FROM business_sms_provider_connections WHERE business_id=$1 "+
      "AND provider_code='HUBTEL_SMS' FOR UPDATE",
      [input.businessId])).rows[0];
    if(!connection||connection.credential_status!=="SAVED_UNVERIFIED"||
       !connection.account_id||!connection.encrypted_secret||
       !connection.nonce||!connection.auth_tag)
      throw new AuthError("Save your Hubtel SMS Client ID, Secret and Sender ID first.",
        409,"HUBTEL_SMS_TEST_CREDENTIALS_MISSING");
    const secret=unsealSmsProviderSecret(input.businessId,"HUBTEL_SMS",{
      encrypted:connection.encrypted_secret,nonce:connection.nonce,
      tag:connection.auth_tag,keyVersion:connection.vault_key_version});
    const row=(await tx.query<Row>(
      "INSERT INTO hubtel_sms_connection_tests "+
      "(business_id,client_request_id,actor_user_id,credential_revision,recipient_suffix) "+
      "VALUES($1,$2,$3,$4,$5) RETURNING "+
      "id,business_id,client_request_id,state,provider_message_id,created_at",
      [input.businessId,input.clientRequestId,input.actorUserId,
        connection.revision,recipient.slice(-4)])).rows[0]!;
    return {newlyClaimed:true as const,row,
      clientId:connection.account_id,senderId:connection.sender_id,secret};
  });
  if(!claimed.newlyClaimed)return {test:view(claimed.row),replayed:true};
  let messageId:string|null=null;
  try{
    messageId=await submitHubtelSmsTest({clientId:claimed.clientId,
      senderId:claimed.senderId,secret:claimed.secret,recipient,
      ...(input.fetchImpl?{fetchImpl:input.fetchImpl}:{})});
  }catch{
    // An external POST may have been accepted before its response was lost.
    // Even definitive provider rejection is never retried automatically.
  }
  return withTransaction(pool,async tx=>{
    const updated=(await tx.query<Row>(
      "UPDATE hubtel_sms_connection_tests SET state=$3,provider_message_id=$4,"+
      "updated_at=now() WHERE id=$1 AND business_id=$2 AND state='INITIATING' "+
      "RETURNING id,business_id,client_request_id,state,provider_message_id,created_at",
      [claimed.row.id,input.businessId,messageId?"ACCEPTED":"OUTCOME_UNKNOWN",messageId]
    )).rows[0];
    if(!updated)throw new AuthError(
      "SMS test outcome requires manual review. Do not resend.",
      409,"HUBTEL_SMS_TEST_REVIEW_REQUIRED");
    return {test:view(updated),replayed:false};
  });
}
