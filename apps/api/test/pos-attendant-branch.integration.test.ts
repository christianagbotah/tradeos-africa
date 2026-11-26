import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users, businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});
const bearer=(token:string)=>({authorization:"Bearer "+token});
async function register(email:string,deviceKey:string){
  const response=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"POS tester",email,password:"TradeOS-12345",
    platform:"WEB",deviceKey,appVersion:"test"}});
  expect(response.statusCode,response.body).toBe(201);
  return response.json() as {user:{id:string};session:{accessToken:string}};
}
async function setup(){
  const owner=await register("branch-owner@tradeos.test","branch-owner-device");
  const attendant=await register("branch-attendant@tradeos.test","branch-attendant-device");
  const guest=await register("branch-guest@tradeos.test","branch-guest-device");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:bearer(owner.session.accessToken),payload:{
      name:"Food and Hardware Group",businessType:"SERVICES",
      branchName:"Main",countryCode:"GH",currencyCode:"GHS",timezone:"Africa/Accra",
    }});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const body=onboard.json() as {business:{id:string};branch:{id:string}};
  const businessId=body.business.id,mainBranch=body.branch.id;
  const second=await app.inject({method:"POST",url:"/v1/businesses/"+businessId+"/branches",
    headers:bearer(owner.session.accessToken),
    payload:{name:"Market Street",code:"MARKET",timezone:"Africa/Accra"}});
  expect(second.statusCode,second.body).toBe(201);
  const marketBranch=second.json().branch.id as string;
  const newStaff=await app.inject({method:"POST",url:"/v1/staff",
    headers:bearer(owner.session.accessToken),payload:{
      businessId,displayName:"Market Attendant",email:"branch-attendant@tradeos.test",
      role:"POS_ATTENDANT",
    }});
  expect(newStaff.statusCode,newStaff.body).toBe(201);
  const staffId=newStaff.json().staff.id as string;
  await pool.query(
    "INSERT INTO business_memberships(business_id,user_id,staff_id,role,status) VALUES($1,$2,$3,'POS_ATTENDANT','ACTIVE')",
    [businessId,attendant.user.id,staffId],
  );
  const item=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers:bearer(owner.session.accessToken),payload:{
      businessId,name:"Waakye",kind:"PREPARED_PRODUCT",
      units:[{code:"portion",label:"Portion",canSell:true,defaultSalePriceMinor:1500}],
    }});
  expect(item.statusCode,item.body).toBe(201);
  const itemId=item.json().item.id as string;
  const product=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers:bearer(owner.session.accessToken),payload:{
      businessId,name:"Cement",kind:"PRODUCT",trackStock:true,stockUnitCode:"bag",
      units:[{code:"bag",label:"Bag",canSell:true,canPurchase:true,canStock:true,
        defaultSalePriceMinor:10000}],
    }});
  expect(product.statusCode,product.body).toBe(201);
  return {owner,attendant,guest,businessId,mainBranch,marketBranch,staffId,itemId};
}
function sale(x:Awaited<ReturnType<typeof setup>>,branchId:string){
  return {clientId:"branch-attendant-device",clientMutationId:randomUUID(),
    businessId:x.businessId,branchId,mutationType:"SALE_CREATE",
    occurredAt:new Date().toISOString(),payload:{
      paymentMethod:"CASH",currencyCode:"GHS",
      lines:[{itemId:x.itemId,saleUnitCode:"portion",quantity:2}],
    }};
}
function branchesUrl(x:Awaited<ReturnType<typeof setup>>){
  return "/v1/staff/"+x.staffId+"/branches";
}
async function assign(x:Awaited<ReturnType<typeof setup>>,branchIds:string[]){
  return app.inject({method:"PUT",url:branchesUrl(x),
    headers:bearer(x.owner.session.accessToken),
    payload:{businessId:x.businessId,branchIds},
  });
}

describe("POS attendant assigned-branch enforcement with live Postgres",()=>{
  it("denies all POS access until an owner assigns at least one active branch",async()=>{
    const x=await setup(),token=x.attendant.session.accessToken;
    const context=await app.inject({method:"GET",
      url:"/v1/businesses/"+x.businessId+"/context",headers:bearer(token)});
    expect(context.statusCode,context.body).toBe(403);
    expect(context.json().error).toBe("BRANCH_SCOPE_DENIED");
    const inventory=await app.inject({method:"GET",
      url:"/v1/inventory?businessId="+x.businessId+"&branchId="+x.mainBranch,
      headers:bearer(token)});
    expect(inventory.statusCode).toBe(403);
    const sync=await app.inject({method:"POST",url:"/v1/sync",
      headers:bearer(token),payload:{mutations:[sale(x,x.mainBranch)]}});
    expect(sync.statusCode,sync.body).toBe(403);
    expect(Number((await pool.query("SELECT COUNT(*)::int AS n FROM sales WHERE business_id=$1",[x.businessId])).rows[0]?.n)).toBe(0);
    const read=await app.inject({method:"GET",url:branchesUrl(x)+"?businessId="+x.businessId,
      headers:bearer(x.owner.session.accessToken)});
    expect(read.statusCode,read.body).toBe(200);
    expect(read.json().branchIds).toEqual([]);
    const denied=await app.inject({method:"PUT",url:branchesUrl(x),
      headers:bearer(token),payload:{businessId:x.businessId,branchIds:[x.mainBranch]}});
    expect(denied.statusCode).toBe(403);
  });

  it("allows only assigned location: login context, stock, quote, sale and receipt",async()=>{
    const x=await setup(),token=x.attendant.session.accessToken;
    const assigned=await assign(x,[x.mainBranch]);
    expect(assigned.statusCode,assigned.body).toBe(200);
    expect(assigned.json().branchIds).toEqual([x.mainBranch]);
    const context=await app.inject({method:"GET",
      url:"/v1/businesses/"+x.businessId+"/context",headers:bearer(token)});
    expect(context.statusCode,context.body).toBe(200);
    expect(context.json().branches.map((b:{id:string})=>b.id)).toEqual([x.mainBranch]);

    const stocks=await app.inject({method:"GET",
      url:"/v1/inventory?businessId="+x.businessId+"&branchId="+x.mainBranch,
      headers:bearer(token)});
    expect(stocks.statusCode,stocks.body).toBe(200);
    expect(stocks.json().items.find((r:{name:string})=>r.name==="Cement")).toMatchObject({available:0});
    const foreignStocks=await app.inject({method:"GET",
      url:"/v1/inventory?businessId="+x.businessId+"&branchId="+x.marketBranch,
      headers:bearer(token)});
    expect(foreignStocks.statusCode).toBe(403);
    expect(foreignStocks.json().error).toBe("BRANCH_SCOPE_DENIED");
    for(const branchId of [x.mainBranch,x.marketBranch]){
      const quote=await app.inject({method:"POST",url:"/v1/pricing/quote",
        headers:bearer(token),payload:{businessId:x.businessId,branchId,
          lines:[{itemId:x.itemId,unitCode:"portion",quantity:2}]}});
      expect(quote.statusCode,quote.body).toBe(branchId===x.mainBranch?200:403);
      if(branchId===x.mainBranch)expect(quote.json().totalMinor).toBe(3000);
    }

    const good=await app.inject({method:"POST",url:"/v1/sync",
      headers:bearer(token),payload:{mutations:[sale(x,x.mainBranch)]}});
    expect(good.statusCode,good.body).toBe(200);
    expect(good.json().mutationResults[0].status).toBe("APPLIED");
    const saleId=good.json().mutationResults[0].result.saleId as string;
    const own=await app.inject({method:"GET",url:
      "/v1/sales/"+saleId+"/receipt.pdf?businessId="+x.businessId,
      headers:bearer(token)});
    expect(own.statusCode,own.body).toBe(200);
    const bad=await app.inject({method:"POST",url:"/v1/sync",
      headers:bearer(token),payload:{mutations:[sale(x,x.marketBranch)]}});
    expect(bad.statusCode,bad.body).toBe(403);
    expect(bad.json().error).toBe("BRANCH_SCOPE_DENIED");
    const count=await pool.query<{n:number}>(
      "SELECT COUNT(*)::int AS n FROM sales WHERE business_id=$1",[x.businessId]);
    expect(count.rows[0]?.n).toBe(1);

    const transfer=await assign(x,[x.marketBranch]);
    expect(transfer.statusCode,transfer.body).toBe(200);
    const revised=await app.inject({method:"GET",url:"/v1/businesses/"+x.businessId+"/context",
      headers:bearer(token)});
    expect(revised.json().branches.map((b:{id:string})=>b.id)).toEqual([x.marketBranch]);
    const oldReceipt=await app.inject({method:"GET",url:
      "/v1/sales/"+saleId+"/receipt.pdf?businessId="+x.businessId,
      headers:bearer(token)});
    expect(oldReceipt.statusCode,oldReceipt.body).toBe(403);
    expect(oldReceipt.json().error).toBe("BRANCH_SCOPE_DENIED");
  });

  it("rejects foreign, inactive, duplicate and invalid branches without dropping good grants",async()=>{
    const x=await setup();
    expect((await assign(x,[x.mainBranch])).statusCode).toBe(200);
    for(const candidate of [[x.mainBranch,x.mainBranch],[randomUUID()],
      ["wrong-id"],[x.marketBranch,x.mainBranch,x.mainBranch]]){
      const response=await assign(x,candidate);
      expect([400,403]).toContain(response.statusCode);
    }
    const other=await register("another-owner@tradeos.test","another-owner-device");
    const foreign=await app.inject({method:"POST",url:"/v1/onboarding/business",
      headers:bearer(other.session.accessToken),
      payload:{name:"Unrelated Company",businessType:"SERVICES",branchName:"Other"}});
    expect(foreign.statusCode).toBe(201);
    const cross=await assign(x,[foreign.json().branch.id]);
    expect(cross.statusCode).toBe(403);
    const read=await app.inject({method:"GET",
      url:branchesUrl(x)+"?businessId="+x.businessId,
      headers:bearer(x.owner.session.accessToken)});
    expect(read.json().branchIds).toEqual([x.mainBranch]);
    const audits=await pool.query(
      "SELECT payload FROM audit_events WHERE business_id=$1 AND event_type='POS_ATTENDANT_BRANCHES_SET'",
      [x.businessId]);
    expect(audits.rows).toHaveLength(1);
  });

  it("revokes grants on role changes so returning to POS requires new authorization",async()=>{
    const x=await setup();
    expect((await assign(x,[x.mainBranch])).statusCode).toBe(200);
    for(const role of ["SALES","POS_ATTENDANT"]){
      const response=await app.inject({method:"PATCH",url:"/v1/staff/"+x.staffId,
        headers:bearer(x.owner.session.accessToken),
        payload:{businessId:x.businessId,role}});
      expect(response.statusCode,response.body).toBe(200);
    }
    const read=await app.inject({method:"GET",
      url:branchesUrl(x)+"?businessId="+x.businessId,
      headers:bearer(x.owner.session.accessToken)});
    expect(read.json().branchIds).toEqual([]);
    const context=await app.inject({method:"GET",
      url:"/v1/businesses/"+x.businessId+"/context",
      headers:bearer(x.attendant.session.accessToken)});
    expect(context.statusCode).toBe(403);
  });
});
