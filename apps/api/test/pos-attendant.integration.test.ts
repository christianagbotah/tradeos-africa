import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users, businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});
const bearer=(token:string)=>({authorization:"Bearer "+token});

async function register(email:string, deviceKey:string){
  const response=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"TradeOS Tester",email,password:"TradeOS-12345",
      platform:"WEB",deviceKey,appVersion:"test"}});
  expect(response.statusCode,response.body).toBe(201);
  return response.json() as {user:{id:string};session:{accessToken:string}};
}
async function setup(){
  const owner=await register("attendant-owner@tradeos.test","attendant-owner-device");
  const attendant=await register("pos-only@tradeos.test","attendant-pos-device");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:bearer(owner.session.accessToken),
    payload:{name:"Kofi Fast Foods",businessType:"SERVICES",
      branchName:"Main",countryCode:"GH",currencyCode:"GHS",timezone:"Africa/Accra"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const body=onboard.json() as {business:{id:string};branch:{id:string}};
  const businessId=body.business.id;
  const branchId=body.branch.id;
  const staffId=randomUUID();
  await pool.query("INSERT INTO staff(id,business_id,display_name,email,role) VALUES($1,$2,$3,$4,'POS_ATTENDANT')",
    [staffId,businessId,"Kofi Attendant","pos-only@tradeos.test"]);
  await pool.query("INSERT INTO business_memberships(business_id,user_id,staff_id,role,status) VALUES($1,$2,$3,'POS_ATTENDANT','ACTIVE')",
    [businessId,attendant.user.id,staffId]);
  const catalog=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers:bearer(owner.session.accessToken),
    payload:{businessId,name:"Waakye",kind:"PREPARED_PRODUCT",units:[
      {code:"price_1000",label:"₵10 portion",canSell:true,defaultSalePriceMinor:1000},
      {code:"price_1500",label:"₵15 portion",canSell:true,defaultSalePriceMinor:1500},
    ]}});
  expect(catalog.statusCode,catalog.body).toBe(201);
  const itemId=(catalog.json() as {item:{id:string}}).item.id;
  return {owner,attendant,businessId,branchId,staffId,itemId};
}
function sale(businessId:string,branchId:string,itemId:string,deviceKey:string,paymentMethod="CASH"){
  return {
    clientId:deviceKey,clientMutationId:randomUUID(),businessId,branchId,
    occurredAt:new Date().toISOString(),mutationType:"SALE_CREATE",
    payload:{paymentMethod,currencyCode:"GHS",
      lines:[{itemId,saleUnitCode:"price_1500",quantity:2}]},
  };
}
describe("POS attendant restricted business operations end-to-end",()=>{
  it("posts one cash sale, price-quotes, denies unrelated financial modules and forged credit",async()=>{
    const x=await setup();
    const token=x.attendant.session.accessToken;
    const business=x.businessId;
    const context=await app.inject({method:"GET",url:"/v1/businesses/"+business+"/context",headers:bearer(token)});
    expect(context.statusCode,context.body).toBe(200);
    expect(context.json().membership.role).toBe("POS_ATTENDANT");
    const catalog=await app.inject({method:"GET",url:"/v1/catalog/items?businessId="+business,headers:bearer(token)});
    expect(catalog.statusCode,catalog.body).toBe(200);
    const quote=await app.inject({method:"POST",url:"/v1/pricing/quote",headers:bearer(token),
      payload:{businessId:business,branchId:x.branchId,lines:[{itemId:x.itemId,unitCode:"price_1500",quantity:2}]}});
    expect(quote.statusCode,quote.body).toBe(200);
    expect(quote.json().totalMinor).toBe(3000);
    const order=sale(business,x.branchId,x.itemId,"attendant-pos-device");
    const charge=await app.inject({method:"POST",url:"/v1/sync",headers:bearer(token),
      payload:{mutations:[order]}});
    expect(charge.statusCode,charge.body).toBe(200);
    const result=charge.json().mutationResults[0];
    expect(result.status).toBe("APPLIED");
    const saleId=result.result.saleId as string;
    const repeat=await app.inject({method:"POST",url:"/v1/sync",headers:bearer(token),
      payload:{mutations:[order]}});
    expect(repeat.statusCode,repeat.body).toBe(200);
    expect(repeat.json().mutationResults[0].result.saleId).toBe(saleId);
    const total=await pool.query("SELECT COUNT(*) AS n FROM sales WHERE business_id=$1",[business]);
    expect(Number(total.rows[0]?.n)).toBe(1);
    for(const url of ["/v1/sales?businessId="+business+"&branchId="+x.branchId,
       "/v1/customers?businessId="+business,
       "/v1/suppliers?businessId="+business]){
      const denied=await app.inject({method:"GET",url,headers:bearer(token)});
      expect(denied.statusCode,denied.body).toBe(403);
    }
    const ownPdf=await app.inject({method:"GET",
      url:"/v1/sales/"+saleId+"/receipt.pdf?businessId="+business+"&paper=A5",
      headers:bearer(token)});
    expect(ownPdf.statusCode,ownPdf.body).toBe(200);
    expect(ownPdf.headers["content-type"]).toContain("application/pdf");
    const forged=sale(business,x.branchId,x.itemId,"attendant-pos-device","CUSTOMER_CREDIT");
    const forbidden=await app.inject({method:"POST",url:"/v1/sync",headers:bearer(token),
      payload:{mutations:[forged]}});
    expect(forbidden.statusCode,forbidden.body).toBe(403);
    expect(forbidden.json().error).toBe("POS_ATTENDANT_SCOPE_FORBIDDEN");
    const deniedCatalog=await app.inject({method:"POST",url:"/v1/catalog/items",
      headers:bearer(token),payload:{businessId:business,name:"Unauthorized",kind:"SERVICE",
        units:[{code:"service",label:"Service",canSell:true,defaultSalePriceMinor:1000}]}});
    expect(deniedCatalog.statusCode).toBe(403);
    const deniedSync=await app.inject({method:"POST",url:"/v1/sync",headers:bearer(token),
      payload:{mutations:[{...order,clientMutationId:randomUUID(),mutationType:"CATALOG_ITEM_CREATE"}]}});
    expect(deniedSync.statusCode).toBe(403);
    expect(Number((await pool.query("SELECT COUNT(*) AS n FROM sales WHERE business_id=$1",[business])).rows[0]?.n)).toBe(1);
  });
  it("limits PDF receipts to the authenticated attendant's own sale",async()=>{
    const x=await setup();
    const ownerSale=sale(x.businessId,x.branchId,x.itemId,"attendant-owner-device");
    const created=await app.inject({method:"POST",url:"/v1/sync",
      headers:bearer(x.owner.session.accessToken),payload:{mutations:[ownerSale]}});
    expect(created.statusCode,created.body).toBe(200);
    const otherId=created.json().mutationResults[0].result.saleId as string;
    const response=await app.inject({method:"GET",
      url:"/v1/sales/"+otherId+"/receipt.pdf?businessId="+x.businessId,
      headers:bearer(x.attendant.session.accessToken)});
    expect(response.statusCode,response.body).toBe(404);
  });
  it("only shows inventory availability, never purchase cost or valuations",async()=>{
    const x=await setup();
    const product=await app.inject({method:"POST",url:"/v1/catalog/items",
      headers:bearer(x.owner.session.accessToken),
      payload:{businessId:x.businessId,name:"Cement",kind:"PRODUCT",
        trackStock:true,stockUnitCode:"bag",
        units:[{code:"bag",label:"Bag",canSell:true,canStock:true,canPurchase:true,
          defaultSalePriceMinor:10000}]}});
    expect(product.statusCode,product.body).toBe(201);
    const response=await app.inject({method:"GET",
      url:"/v1/inventory?businessId="+x.businessId+"&branchId="+x.branchId,
      headers:bearer(x.attendant.session.accessToken)});
    expect(response.statusCode,response.body).toBe(200);
    const item=response.json().items.find((row:{name:string})=>row.name==="Cement");
    expect(item).toMatchObject({stockUnitCode:"bag",available:0});
    expect(Object.keys(item).sort()).toEqual(["available","id","name","sku","stockUnitCode"]);
  });
});
