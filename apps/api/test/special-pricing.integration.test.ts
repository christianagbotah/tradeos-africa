import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";

process.env.DATABASE_URL??="postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});
async function createUser(tag:string){
  const email="pricing-"+tag+"@example.invalid";
  const res=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Pricing "+tag,email,
    password:"TradeOS-Pricing-Test-Owner-12345!",
    platform:"WEB",deviceKey:"pricing-"+tag,appVersion:"test",
  }});
  expect(res.statusCode,res.body).toBe(201);
  const id=(await pool.query<{id:string}>(
    "SELECT id FROM app_users WHERE email=$1",[email])).rows[0]!.id;
  return {headers:{authorization:"Bearer "+res.json().session.accessToken},id};
}
async function fixture(tag:string){
  const owner=await createUser("owner-"+tag);
  const on=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:owner.headers,payload:{name:"Pricing Test Shop "+tag,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(on.statusCode,on.body).toBe(201);
  const businessId=on.json().business.id as string;
  const branchId=on.json().branch.id as string;
  const itemId=(await pool.query<{id:string}>(
    `INSERT INTO catalog_items(business_id,name,kind,track_stock)
      VALUES($1,'Test flat door','SERVICE',false) RETURNING id`,
    [businessId])).rows[0]!.id;
  await pool.query(
    `INSERT INTO catalog_item_units(business_id,item_id,unit_code,
      unit_label,can_sell,default_sale_price_minor)
      VALUES($1,$2,'piece','piece',true,1000)`,
    [businessId,itemId]);
  const customerId=(await pool.query<{id:string}>(
    `INSERT INTO customers(business_id,name,credit_limit_minor)
      VALUES($1,'Comfort Mensah',100000) RETURNING id`,
    [businessId])).rows[0]!.id;
  const employee=await createUser("employee-"+tag);
  const employeeStaff=(await pool.query<{id:string}>(
    `INSERT INTO staff(business_id,display_name,role)
     VALUES($1,'Pricing Cashier','CASHIER') RETURNING id`,
    [businessId])).rows[0]!.id;
  await pool.query(
    `INSERT INTO business_memberships(business_id,user_id,role,status,staff_id)
      VALUES($1,$2,'CASHIER','ACTIVE',$3)`,
    [businessId,employee.id,employeeStaff]);
  const ownerMembership=await pool.query<{staff_id:string|null}>(
    'SELECT staff_id FROM business_memberships WHERE business_id=$1 AND user_id=$2',
    [businessId,owner.id]);
  if(!ownerMembership.rows[0]?.staff_id){
    const ownerStaff=(await pool.query<{id:string}>(
      `INSERT INTO staff(business_id,display_name,role)
       VALUES($1,'Pricing Owner','OWNER') RETURNING id`,
      [businessId])).rows[0]!.id;
    await pool.query('UPDATE business_memberships SET staff_id=$1 WHERE business_id=$2 AND user_id=$3',
      [ownerStaff,businessId,owner.id]);
  }
  const other=await fixtureOtherBusiness(tag);
  return {owner,employee,businessId,branchId,itemId,customerId,other};
}
async function fixtureOtherBusiness(tag:string){
  const visitor=await createUser("visitor-"+tag);
  const on=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:visitor.headers,payload:{name:"Other Merchant "+tag,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(on.statusCode,on.body).toBe(201);
  return {headers:visitor.headers,businessId:on.json().business.id as string};
}
const reqBody=(f:Awaited<ReturnType<typeof fixture>>,overrides:Record<string,unknown>={})=>({
  businessId:f.businessId,branchId:f.branchId,customerId:f.customerId,
  itemId:f.itemId,unitCode:"piece",quantity:1,
  requestedPriceMinor:800,reason:"Customer negotiated lower price",
  clientRequestId:randomUUID(),...overrides,
});
async function syncSale(f:Awaited<ReturnType<typeof fixture>>,headers:{
  authorization:string},lines:unknown[],customerId:string|null=f.customerId){
  const id=randomUUID();
  const res=await app.inject({method:"POST",url:"/v1/sync",headers,payload:{
    mutations:[{clientId:"pricing-device",clientMutationId:id,
      businessId:f.businessId,branchId:f.branchId,
      mutationType:"SALE_CREATE",occurredAt:new Date().toISOString(),
      payload:{paymentMethod:"CASH",...(customerId?{customerId}:{}),
        lines}}],
  }});
  expect(res.statusCode,res.body).toBe(200);
  return res.json().mutationResults[0];
}
describe("customer rate and one-use discount approval",()=>{
  it("applies a manager-set special price only to the right customer and business",async()=>{
    const f=await fixture("rates");
    const put=await app.inject({method:"PUT",url:"/v1/pricing/customer-rates",
      headers:f.owner.headers,payload:{businessId:f.businessId,
        customerId:f.customerId,itemId:f.itemId,unitCode:"piece",priceMinor:700}});
    expect(put.statusCode,put.body).toBe(200);
    const quote=await app.inject({method:"POST",url:"/v1/pricing/quote",
      headers:f.employee.headers,payload:{businessId:f.businessId,
        branchId:f.branchId,customerId:f.customerId,
        lines:[{itemId:f.itemId,unitCode:"piece",quantity:2}]}});
    expect(quote.statusCode,quote.body).toBe(200);
    expect(quote.json().totalMinor).toBe(1400);
    expect(quote.json().lines[0].source).toBe("CUSTOMER");
    const forbidden=await app.inject({method:"PUT",url:"/v1/pricing/customer-rates",
      headers:f.employee.headers,payload:{businessId:f.businessId,
        customerId:f.customerId,itemId:f.itemId,unitCode:"piece",priceMinor:100}});
    expect(forbidden.statusCode).toBe(403);
    const foreign=await app.inject({method:"GET",
      url:"/v1/pricing/customer-rates?businessId="+f.other.businessId+
        "&customerId="+f.customerId,headers:f.other.headers});
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().rates).toHaveLength(0);
    const sale=await syncSale(f,f.employee.headers,
      [{itemId:f.itemId,saleUnitCode:"piece",quantity:1,expectedUnitPriceMinor:700}]);
    expect(sale.status,sale.errorMessage).toBe("APPLIED");
    expect(sale.result.totalMinor).toBe(700);
    const wrong=await syncSale(f,f.employee.headers,
      [{itemId:f.itemId,saleUnitCode:"piece",quantity:1,
        expectedUnitPriceMinor:1000}]);
    expect(wrong.status).toBe("REJECTED");
    const walkIn=await syncSale(f,f.owner.headers,
      [{itemId:f.itemId,saleUnitCode:"piece",quantity:1}],null);
    expect(walkIn.status).toBe("APPLIED");
    expect(walkIn.result.totalMinor).toBe(1000);
  });
  it("requires manager review, blocks self review and uses exact approval only once",async()=>{
    const f=await fixture("approval");
    const created=await app.inject({method:"POST",
      url:"/v1/pricing/discount-requests",
      headers:f.employee.headers,payload:reqBody(f)});
    expect(created.statusCode,created.body).toBe(201);
    const id=created.json().request.id as string;
    const unauth=await app.inject({method:"POST",
      url:"/v1/pricing/discount-requests/"+id+"/approve",
      headers:f.employee.headers,payload:{businessId:f.businessId}});
    expect(unauth.statusCode).toBe(403);
    const foreign=await app.inject({method:"POST",
      url:"/v1/pricing/discount-requests/"+id+"/approve",
      headers:f.other.headers,payload:{businessId:f.other.businessId}});
    expect(foreign.statusCode).toBe(404);
    const approved=await app.inject({method:"POST",
      url:"/v1/pricing/discount-requests/"+id+"/approve",
      headers:f.owner.headers,payload:{businessId:f.businessId,
        note:"Approved after discussing with cashier"}});
    expect(approved.statusCode,approved.body).toBe(200);
    const wrongQty=await syncSale(f,f.employee.headers,
      [{itemId:f.itemId,saleUnitCode:"piece",quantity:2,priceApprovalId:id}]);
    expect(wrongQty.status).toBe("REJECTED");
    const first=await syncSale(f,f.employee.headers,
      [{itemId:f.itemId,saleUnitCode:"piece",quantity:1,
        priceApprovalId:id,expectedUnitPriceMinor:800}]);
    expect(first.status,first.errorMessage).toBe("APPLIED");
    expect(first.result.totalMinor).toBe(800);
    const second=await syncSale(f,f.employee.headers,
      [{itemId:f.itemId,saleUnitCode:"piece",quantity:1,priceApprovalId:id}]);
    expect(second.status).toBe("REJECTED");
    const status=(await pool.query<{status:string;used_sale_id:string|null}>(
      "SELECT status,used_sale_id FROM sale_price_approval_requests WHERE id=$1",
      [id])).rows[0]!;
    expect(status.status).toBe("USED");
    expect(status.used_sale_id).toBe(first.result.saleId);
  });
});
