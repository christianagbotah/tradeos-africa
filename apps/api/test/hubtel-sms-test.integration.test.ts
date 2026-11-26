import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {sendHubtelSmsConnectionTest} from "../src/messaging/hubtel-sms-test.js";
const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
  !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw new Error("Hubtel SMS tests require isolated local tradeos_ci");
process.env.DATABASE_URL=url;
const key="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const old=process.env[key];
const pass="TradeOS-Test-1234",pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{
  process.env[key]=Buffer.alloc(32,65).toString("base64");await app.ready();
});
afterAll(async()=>{
  await app.close();await pool.end();
  if(old===undefined)delete process.env[key];else process.env[key]=old;
});
async function merchant(){
  const id=randomUUID();
  const register=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"SMS Test Owner",email:"hubtel-sms-"+id+"@example.test",
      password:pass,platform:"WEB",deviceKey:"sms-"+id,appVersion:"test"}});
  expect(register.statusCode,register.body).toBe(201);
  const userId=register.json().user.id as string;
  const headers={authorization:"Bearer "+register.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"SMS Business "+id,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  return {businessId:onboard.json().business.id as string,userId,headers};
}
describe("Hubtel SMS one-message test security",()=>{
  it("enforces tenant/owner/password/consent and idempotency before provider POST",async()=>{
    const owner=await merchant(),other=await merchant();
    const path="/v1/businesses/"+owner.businessId+
      "/sms-providers/HUBTEL_SMS/test-send";
    const data={clientRequestId:randomUUID(),recipient:"0241234567",
      currentPassword:pass,confirmOwnership:true};
    expect((await app.inject({method:"POST",url:path,payload:data})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:path,headers:other.headers,
      payload:data})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:path,headers:owner.headers,
      payload:{...data,confirmOwnership:false}})).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:path,headers:owner.headers,
      payload:{...data,currentPassword:"wrong"}})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:path,headers:owner.headers,
      payload:data})).statusCode).toBe(409);
    const saved=await app.inject({method:"PUT",url:
      "/v1/businesses/"+owner.businessId+
      "/sms-providers/connections/HUBTEL_SMS",headers:owner.headers,payload:{
        accountId:"sms-client-id",apiSecret:"private-sms-secret-1234",
        senderId:"LIGHTWORLD",currentPassword:pass,expectedRevision:0}});
    expect(saved.statusCode,saved.body).toBe(200);
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({
      messageId:"123e4567-e89b-42d3-a456-426614174000",status:0}),{status:201}));
    const first=await sendHubtelSmsConnectionTest(pool,{
      businessId:owner.businessId,actorUserId:owner.userId,
      ...data,fetchImpl:fetchMock as typeof fetch});
    expect(first).toMatchObject({test:{state:"ACCEPTED",delivered:false},
      replayed:false});
    const replay=await sendHubtelSmsConnectionTest(pool,{
      businessId:owner.businessId,actorUserId:owner.userId,
      ...data,fetchImpl:fetchMock as typeof fetch});
    expect(replay.replayed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(sendHubtelSmsConnectionTest(pool,{
      businessId:owner.businessId,actorUserId:owner.userId,
      ...data,clientRequestId:randomUUID(),fetchImpl:fetchMock as typeof fetch}))
      .rejects.toMatchObject({code:"HUBTEL_SMS_TEST_RATE_LIMITED"});
    const audit=await pool.query<{recipient_suffix:string;state:string}>(
      "SELECT recipient_suffix,state FROM hubtel_sms_connection_tests WHERE business_id=$1",
      [owner.businessId]);
    expect(audit.rows).toEqual([{recipient_suffix:"4567",state:"ACCEPTED"}]);
  });
});
