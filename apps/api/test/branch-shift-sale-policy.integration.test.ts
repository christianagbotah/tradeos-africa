import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,beforeEach,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});

async function register(username:string,key:string){
  const r=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:username,email:username+"@tradeos.test",
    password:"TradeOS-12345",platform:"WEB",deviceKey:key,appVersion:"test",
  }});
  expect(r.statusCode,r.body).toBe(201);
  return r.json() as {user:{id:string};session:{accessToken:string}};
}
const bearer=(token:string)=>({authorization:"Bearer "+token});
async function fixture(){
  const owner=await register("policy-owner","policy-owner-device");
  const staff=await register("policy-attendant","policy-attendant-device");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:bearer(owner.session.accessToken),
    payload:{name:"Shift Opt-in Groceries",businessType:"SERVICES",
      branchName:"Main",countryCode:"GH",currencyCode:"GHS",timezone:"Africa/Accra"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const staffId=randomUUID();
  await pool.query("INSERT INTO staff(id,business_id,display_name,email,role) VALUES($1,$2,'Cash seller',$3,'POS_ATTENDANT')",
    [staffId,businessId,"policy-attendant@tradeos.test"]);
  await pool.query("INSERT INTO business_memberships(business_id,user_id,staff_id,role,status) VALUES($1,$2,$3,'POS_ATTENDANT','ACTIVE')",
    [businessId,staff.user.id,staffId]);
  await pool.query(
    "INSERT INTO pos_attendant_branch_assignments(business_id,staff_id,branch_id,assigned_by_staff_id) VALUES($1,$2,$3,(SELECT staff_id FROM business_memberships WHERE business_id=$1 AND role='OWNER' LIMIT 1))",
    [businessId,staffId,branchId]);
  const product=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers:bearer(owner.session.accessToken),payload:{
      businessId,name:"Waakye plate",kind:"PREPARED_PRODUCT",
      units:[{code:"portion",label:"Food portion",canSell:true,defaultSalePriceMinor:1500}],
    }});
  expect(product.statusCode,product.body).toBe(201);
  const itemId=product.json().item.id as string;
  const policyUrl=(branch=branchId)=>"/v1/operations/sale-shift-policy?businessId="+businessId+"&branchId="+branch;
  const getPolicy=(role:"owner"|"attendant"="owner",branch=branchId)=>
    app.inject({method:"GET",url:policyUrl(branch),headers:bearer(
      role==="owner"?owner.session.accessToken:staff.session.accessToken)});
  const setPolicy=(required:unknown,expectedRevision:unknown,reason:string,
    role:"owner"|"attendant"="owner",branch=branchId)=>
    app.inject({method:"PATCH",url:policyUrl(branch),headers:bearer(
      role==="owner"?owner.session.accessToken:staff.session.accessToken),
    payload:{required,expectedRevision,reason}});
  const sync=(role:"owner"|"attendant",mutationType:string,payload:unknown,
    occurredAt:string,key=randomUUID(),branch=branchId)=>
    app.inject({method:"POST",url:"/v1/sync",
      headers:bearer(role==="owner"?owner.session.accessToken:staff.session.accessToken),
      payload:{mutations:[{
        businessId,branchId:branch,clientId:role==="owner"?"policy-owner-device":"policy-attendant-device",
        clientMutationId:key,mutationType,occurredAt,payload,
      }]}});
  const salePayload=()=>({
    currencyCode:"GHS",paymentMethod:"CASH",
    lines:[{itemId,saleUnitCode:"portion",quantity:1}],
  });
  return {businessId,branchId,staffId,owner,staff,getPolicy,setPolicy,sync,salePayload};
}
const at=(base:Date,offsetMs:number)=>new Date(base.getTime()+offsetMs).toISOString();
const closing=(shiftId:string)=>({shiftId,closingBalances:[
  {method:"CASH",countedMinor:1500},{method:"MOMO",countedMinor:0},
  {method:"CARD",countedMinor:0},{method:"BANK",countedMinor:0},
  {method:"OTHER",countedMinor:0},
]});
const applied=(r:{body:string;statusCode:number})=>{
  expect(r.statusCode,r.body).toBe(200);
  const result=JSON.parse(r.body).mutationResults[0];
  expect(result.status,JSON.stringify(result)).toBe("APPLIED");
  return result.result as {id:string;saleId?:string};
};

describe("explicit branch shift-before-sale opt-in: real PostgreSQL",()=>{
  it("defaults OFF, rejects an uncovered new sale when enabled, then accepts own historical shift sales after close",async()=>{
    const f=await fixture(),now=new Date();
    expect((await f.getPolicy()).json().policy).toEqual({
      required:false,revision:null,changedAt:null,
    });
    applied(await f.sync("attendant","SALE_CREATE",f.salePayload(),at(now,-30*60_000)));
    const day=applied(await f.sync("owner","OPERATING_DAY_OPEN_CREATE",{
      businessDate:now.toISOString().slice(0,10),
      openingBalances:[{method:"CASH",countedMinor:5000}],
    },at(now,-20*60_000)));
    const enabled=await f.setPolicy(true,null,"Require audited cash drawer accountability");
    expect(enabled.statusCode,enabled.body).toBe(200);
    expect(enabled.json().policy).toMatchObject({required:true});
    const onTime=new Date(enabled.json().policy.changedAt as string);
    const failed=await f.sync("attendant","SALE_CREATE",f.salePayload(),at(onTime,1000));
    expect(failed.statusCode,failed.body).toBe(200);
    expect(failed.json().mutationResults[0]).toMatchObject({
      status:"REJECTED",errorCode:"SHIFT_REQUIRED_FOR_SALE",
    });
    const opened=applied(await f.sync("attendant","SHIFT_OPEN_CREATE",{
      dayId:day.id,openingBalances:[{method:"CASH",countedMinor:0}],
    },at(now,-10*60_000)));
    const covered=await f.sync("attendant","SALE_CREATE",f.salePayload(),
      at(onTime,1000));
    applied(covered);
    // Cash counted and closed before delayed offline transaction reaches us.
    applied(await f.sync("attendant","SHIFT_CLOSE_CREATE",closing(opened.id),
      at(onTime,3*60_000)));
    const late=await f.sync("attendant","SALE_CREATE",f.salePayload(),
      at(onTime,2*60_000));
    applied(late);
    const rows=await pool.query(
      "SELECT COUNT(*)::int AS n FROM sales WHERE business_id=$1 AND status='COMPLETED'",
      [f.businessId]);
    expect(rows.rows[0].n).toBe(3);
    const attribution=await pool.query(
      "SELECT staff_shift_id FROM cashbook_entries WHERE business_id=$1 AND occurred_at=$2",
      [f.businessId,at(onTime,2*60_000)]);
    expect(attribution.rows[0]?.staff_shift_id).toBe(opened.id);
    const audit=await pool.query(
      "SELECT COUNT(*)::int AS n FROM audit_events WHERE business_id=$1 AND event_type='SHIFT_SALE_POLICY_ENABLED'",
      [f.businessId]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("requires owner/admin, guards the active branch, and rejects stale optimistic revisions",async()=>{
    const f=await fixture();
    const denied=await f.setPolicy(true,null,"Enable cash shift accountability","attendant");
    expect(denied.statusCode).toBe(403);
    expect((await f.getPolicy("attendant")).statusCode).toBe(200);
    const invalid=await f.setPolicy("true",null,"Enable cash shift accountability");
    expect(invalid.statusCode).toBe(400);
    const initial=await f.setPolicy(true,null,"Enable cash shift accountability");
    expect(initial.statusCode,initial.body).toBe(200);
    const first=initial.json().policy as {revision:string;changedAt:string;required:boolean};
    const stale=await f.setPolicy(false,null,"Disable the new cash shift requirement");
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("SHIFT_POLICY_REVISION_CONFLICT");
    const disabled=await f.setPolicy(false,first.revision,"Disabling after the shop handover review");
    expect(disabled.statusCode,disabled.body).toBe(200);
    const second=disabled.json().policy;
    expect(second.required).toBe(false);
    expect(second.revision).not.toBe(first.revision);
    // Historical enabled event remains, even when the current policy is off.
    expect((await pool.query(
      "SELECT required FROM branch_shift_sale_policy_events WHERE business_id=$1 ORDER BY effective_at",
      [f.businessId])).rows.map(row=>row.required)).toEqual([true,false]);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM outbox_events WHERE business_id=$1 AND event_type LIKE 'SHIFT_SALE_POLICY_%'",
      [f.businessId])).rows[0].n).toBe(2);
    const otherBranch=randomUUID();
    const wrong=await f.getPolicy("owner",otherBranch);
    expect(wrong.statusCode).toBe(404);
    const foreignToggle=await f.setPolicy(true,null,"Attempt unassigned branch toggle","attendant",otherBranch);
    expect(foreignToggle.statusCode).toBe(403);
  });

  it("preserves every historical policy transition for queued sale occurrence time",async()=>{
    const f=await fixture();
    const start=new Date();
    const enabled=await f.setPolicy(true,null,"Enable tills for the school canteen");
    const first=enabled.json().policy;
    const disabled=await f.setPolicy(false,first.revision,"Temporarily disable until training ends");
    const second=disabled.json().policy;
    expect(second.required).toBe(false);
    const afterOff=at(new Date(second.changedAt),1500);
    // No shift required after disable; future sale still creates correctly.
    applied(await f.sync("attendant","SALE_CREATE",f.salePayload(),afterOff));
    const earlier=await f.sync("attendant","SALE_CREATE",f.salePayload(),
      at(new Date(first.changedAt),1));
    expect(earlier.json().mutationResults[0]).toMatchObject({
      status:"REJECTED",errorCode:"SHIFT_REQUIRED_FOR_SALE",
    });
    const prior=await f.sync("attendant","SALE_CREATE",f.salePayload(),at(start,-1000));
    applied(prior);
    expect((await pool.query(
      "SELECT COUNT(*)::int AS n FROM sales WHERE business_id=$1",[f.businessId])).rows[0].n).toBe(2);
  });
});
