import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
const url=process.env.DATABASE_URL??"postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||!/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw new Error("Only isolated local test PostgreSQL is allowed");
process.env.DATABASE_URL=url;
const env="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const old=process.env[env];
const pass="Test-Account-Password-1234";
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{process.env[env]=Buffer.alloc(32,67).toString("base64");await app.ready();});
afterAll(async()=>{await app.close();await pool.end();
  if(old===undefined)delete process.env[env];else process.env[env]=old;});
async function merchant(){
  const nonce=randomUUID();
  const signup=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Owner",email:"gateway-"+nonce+"@example.test",password:pass,
    platform:"WEB",deviceKey:"test-"+nonce,appVersion:"test"}});
  expect(signup.statusCode).toBe(201);
  const headers={authorization:"Bearer "+signup.json().session.accessToken};
  const on=await app.inject({method:"POST",url:"/v1/onboarding/business",headers,
    payload:{name:"Gateway "+nonce,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(on.statusCode).toBe(201);
  return {headers,id:on.json().business.id as string};
}
describe("merchant test-key connection and audit",()=>{
  it("requires ownership, reauth and test key; returns no credential",async()=>{
    const a=await merchant(),b=await merchant();
    const list="/v1/businesses/"+a.id+"/payment-gateways/connections";
    const path=list+"/PAYSTACK";
    expect((await app.inject({method:"GET",url:list})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:list,headers:b.headers})).statusCode).toBe(403);
    const key="sk_test_syntheticABCDEFGHIJKLMNOP";
    const send=(payload:unknown)=>app.inject({method:"PUT",url:path,headers:a.headers,payload});
    expect((await send({secretKey:key,expectedRevision:0,currentPassword:"wrong"})).statusCode).toBe(403);
    expect((await send({secretKey:"sk_live_forbidden",expectedRevision:0,
      currentPassword:pass})).statusCode).toBe(400);
    const saved=await send({secretKey:key,expectedRevision:0,currentPassword:pass});
    expect(saved.statusCode,saved.body).toBe(200);
    expect(saved.json()).toMatchObject({connection:{enabled:false,revision:1,
      status:"PENDING_VERIFICATION"}});
    const listing=await app.inject({method:"GET",url:list,headers:a.headers});
    expect(listing.json().connections[0]).toMatchObject({providerCode:"PAYSTACK",
      enabled:false,revision:1});
    expect(listing.body).not.toContain(key);
    expect(listing.body).not.toContain("encrypted_secret");
    expect((await send({secretKey:key,expectedRevision:0,currentPassword:pass})).statusCode).toBe(409);
    const revoked=await app.inject({method:"DELETE",url:path,headers:a.headers,
      payload:{expectedRevision:1,currentPassword:pass}});
    expect(revoked.statusCode,revoked.body).toBe(200);
    expect(revoked.json().connection).toMatchObject({enabled:false,status:"REVOKED",revision:2});
  });
});
