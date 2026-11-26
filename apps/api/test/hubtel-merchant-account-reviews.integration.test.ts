import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {hashPassword} from "../src/auth/security.js";
import {
  saveMerchantPaymentCredentials,verifyMerchantHubtelConnection,
  requestMerchantGatewayActivation,
} from "../src/payment-providers/merchant-connections.js";

const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
  !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw Error("Hubtel account reviews require isolated local tradeos_ci");
process.env.DATABASE_URL=url;
const secretName="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const oldSecret=process.env[secretName];
const pool=createPool(),app=buildApp(pool),password="TradeOS-Test-1234";
beforeAll(async()=>{
  process.env[secretName]=Buffer.alloc(32,88).toString("base64");
  await app.ready();
});
afterAll(async()=>{
  await app.close();await pool.end();
  if(oldSecret===undefined)delete process.env[secretName];
  else process.env[secretName]=oldSecret;
});
async function business(){
  const tag=randomUUID();
  const res=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Review Merchant",email:"review-"+tag+"@example.test",
      password,platform:"WEB",deviceKey:"review-"+tag,appVersion:"test"}});
  expect(res.statusCode,res.body).toBe(201);
  const headers={authorization:"Bearer "+res.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Review "+tag,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const actor=(await pool.query<{user_id:string}>(
    "SELECT user_id FROM business_memberships "+
    "WHERE business_id=$1 AND role='OWNER'",[businessId])).rows[0]!.user_id;
  return {businessId,actor,headers};
}
async function admin(role:"SUPER_ADMIN"|"OPERATIONS"|"SUPPORT"){
  const tag=randomUUID(),email="merchant-admin-"+tag+"@example.test";
  const hashed=await hashPassword(password);
  const user=(await pool.query<{id:string}>(
    "INSERT INTO platform_users(email,display_name,role,is_active,password_hash) "+
    "VALUES($1,$2,$3,true,$4) RETURNING id",
    [email,"Merchant Review Administrator",role,hashed])).rows[0]!.id;
  const signed=await app.inject({method:"POST",url:"/api/admin/session/login",
    payload:{identifier:email,password,platform:"WEB",deviceKey:"admin-"+tag}});
  expect(signed.statusCode,signed.body).toBe(200);
  const raw=signed.headers["set-cookie"];
  const cookie=(Array.isArray(raw)?raw[0]:raw)?.split(";")[0];
  expect(cookie).toContain("__Host-tradeos_admin_session=");
  return {id:user,headers:{cookie:cookie!}};
}
async function verifiedMerchant(m:Awaited<ReturnType<typeof business>>){
  const account="6"+String(Math.floor(Math.random()*900000000)+100000000);
  const fields={apiId:"hubtel-review-test-id",apiKey:"hubtel-review-test-key",
    collectionAccount:account};
  await saveMerchantPaymentCredentials(pool,{
    businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
    environment:"LIVE",fields,currentPassword:password,expectedRevision:0,
  });
  await verifyMerchantHubtelConnection(pool,{
    businessId:m.businessId,actorUserId:m.actor,environment:"LIVE",
    expectedRevision:1,currentPassword:password,
    fetchImpl:async(_url,init)=>{
      expect(init?.method).toBe("GET");
      return new Response(JSON.stringify({
        responseCode:"0000",data:{amount:12.5}}),{status:200});
    },
  });
  await requestMerchantGatewayActivation(pool,{
    businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
    environment:"LIVE",expectedRevision:1,currentPassword:password,
  });
  return {account,fields};
}
const path="/api/admin/payments/hubtel/merchant-accounts";
describe("Platform Hubtel beneficiary evidence review",()=>{
  it("requires privileged platform session and records no-charge decision with immutable audit",async()=>{
    const m=await business(),superUser=await admin("SUPER_ADMIN");
    const ops=await admin("OPERATIONS"),support=await admin("SUPPORT");
    const {account,fields}=await verifiedMerchant(m);
    expect((await app.inject({method:"GET",url:path})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:path,
      headers:support.headers})).statusCode).toBe(403);
    const visible=await app.inject({method:"GET",url:path,headers:ops.headers});
    expect(visible.statusCode,visible.body).toBe(200);
    expect(visible.body).not.toContain(fields.apiId);
    expect(visible.body).not.toContain(fields.apiKey);
    const candidate=visible.json().reviews.find(
      (x:{businessId:string})=>x.businessId===m.businessId);
    expect(candidate).toMatchObject({
      reviewStatus:"PENDING",collectionEnabled:false,
      credentialRevision:1,reviewVersion:0,collectionAccount:account,
    });
    const url=path+"/"+m.businessId+"/review";
    const payload={decision:"APPROVED",evidenceReference:"CASE-2026-merchant-001",
      rationale:"Verified account beneficiary against official merchant documents.",
      beneficiaryOwnershipConfirmed:true,
      expectedCredentialRevision:1,expectedReviewVersion:0};
    expect((await app.inject({method:"POST",url,
      headers:ops.headers,payload})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url,
      headers:superUser.headers,
      payload:{...payload,beneficiaryOwnershipConfirmed:false}})).statusCode)
      .toBe(400);
    const recorded=await app.inject({method:"POST",url,
      headers:superUser.headers,payload});
    expect(recorded.statusCode,recorded.body).toBe(200);
    expect(recorded.json().review).toMatchObject({
      reviewStatus:"APPROVED",reviewVersion:1,
      credentialRevision:1,collectionEnabled:false,
      collectionAccount:account});
    const ownerRead=await app.inject({method:"GET",
      url:"/v1/businesses/"+m.businessId+
        "/payment-gateways/HUBTEL/activation-readiness",
      headers:m.headers});
    expect(ownerRead.statusCode,ownerRead.body).toBe(200);
    expect(ownerRead.json()).toMatchObject({
      accountApproved:true,accountReviewStatus:"APPROVED",
      merchantCollectionEnabled:false,approvedLegacyCollectionAccount:false});
    expect((await app.inject({method:"POST",url,
      headers:superUser.headers,payload})).statusCode).toBe(409);
    const row=(await pool.query<{collection_enabled:boolean}>(
      "SELECT collection_enabled FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code='HUBTEL'",
      [m.businessId])).rows[0];
    expect(row?.collection_enabled).toBe(false);
    const legacy=(await pool.query<{n:string}>(
      "SELECT count(*)::text AS n FROM business_hubtel_sales_accounts "+
      "WHERE business_id=$1",[m.businessId])).rows[0];
    expect(legacy?.n).toBe("0");
    const events=(await pool.query<{decision:string;review_version:number}>(
      "SELECT decision,review_version FROM hubtel_merchant_account_review_events "+
      "WHERE business_id=$1",[m.businessId])).rows;
    expect(events).toEqual([{decision:"APPROVED",review_version:1}]);
    await expect(pool.query(
      "DELETE FROM hubtel_merchant_account_review_events WHERE business_id=$1",
      [m.businessId])).rejects.toThrow();
    await expect(pool.query(
      "INSERT INTO hubtel_merchant_account_reviews "+
      "(business_id,account_reference,credential_revision,decision,"+
      "beneficiary_ownership_confirmed,evidence_reference,rationale,"+
      "reviewed_by_platform_user_id) VALUES($1,'123456789',999,'APPROVED',"+
      "true,'CASE-12345678','Forged beneficiary account ownership',$2)",
      [m.businessId,superUser.id])).rejects.toThrow();
  });

  it("rejects stale approval after rotated merchant API key and supports independent re-review",async()=>{
    const m=await business(),superUser=await admin("SUPER_ADMIN");
    const {account}=await verifiedMerchant(m);
    const url=path+"/"+m.businessId+"/review";
    const initial={decision:"REJECTED",evidenceReference:"CASE-2026-review-002",
      rationale:"Beneficiary ownership evidence was not independently confirmed.",
      beneficiaryOwnershipConfirmed:false,
      expectedCredentialRevision:1,expectedReviewVersion:0};
    const rejected=await app.inject({method:"POST",url,
      headers:superUser.headers,payload:initial});
    expect(rejected.statusCode,rejected.body).toBe(200);
    expect(rejected.json().review.reviewStatus).toBe("REJECTED");
    const approval={...initial,decision:"APPROVED",
      evidenceReference:"CASE-2026-review-003",
      rationale:"Verified beneficial ownership against approved merchant case.",
      beneficiaryOwnershipConfirmed:true,expectedReviewVersion:1};
    expect((await app.inject({method:"POST",url,
      headers:superUser.headers,payload:approval})).statusCode).toBe(200);
    await saveMerchantPaymentCredentials(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
      environment:"LIVE",fields:{apiId:"new-hubtel-review-id",
        apiKey:"new-hubtel-review-secret",collectionAccount:account},
      currentPassword:password,expectedRevision:1,
    });
    const ownerView=await app.inject({method:"GET",
      url:"/v1/businesses/"+m.businessId+
        "/payment-gateways/HUBTEL/activation-readiness",
      headers:m.headers});
    expect(ownerView.json()).toMatchObject({
      accountApproved:false,accountReviewStatus:"PENDING",
      merchantCollectionEnabled:false});
    expect((await app.inject({method:"POST",url,
      headers:superUser.headers,payload:{
        ...approval,expectedCredentialRevision:2,expectedReviewVersion:2,
      }})).statusCode).toBe(409);
    const history=(await pool.query<{review_version:number;decision:string}>(
      "SELECT review_version,decision FROM hubtel_merchant_account_review_events "+
      "WHERE business_id=$1 ORDER BY review_version",[m.businessId])).rows;
    expect(history).toEqual([
      {review_version:1,decision:"REJECTED"},
      {review_version:2,decision:"APPROVED"},
    ]);
  });
});
