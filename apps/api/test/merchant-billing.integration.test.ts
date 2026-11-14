import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function owner(tag: string) {
  const reg=await app.inject({
    method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Billing Owner",email:"tenant-billing-"+tag+"@tradeos.test",
      password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"bill-"+tag,appVersion:"test"},
  });
  expect(reg.statusCode,reg.body).toBe(201);
  const headers={authorization:"Bearer "+reg.json().session.accessToken};
  const onboard=await app.inject({
    method:"POST",url:"/v1/onboarding/business",headers,
    payload:{name:"Tenant Billing "+tag,businessType:"RETAIL_HARDWARE",branchName:"Main"},
  });
  expect(onboard.statusCode,onboard.body).toBe(201);
  return {businessId:onboard.json().business.id as string,
    userId:reg.json().user.id as string,headers};
}
type Owner=Awaited<ReturnType<typeof owner>>;
const path=(o:Owner)=>"/v1/billing/overview?businessId="+o.businessId;

async function addInvoice(o:Owner,amountMinor=10000) {
  const plan=await pool.query<{id:string}>(
    "INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active) "+
    "VALUES($1,'TradeOS Growth','GHS',$2,'MONTHLY',0,true,true) RETURNING id",
    ["GROWTH_"+o.businessId.slice(0,8),amountMinor],
  );
  const subscription=await pool.query<{id:string}>(
    "INSERT INTO business_subscriptions(business_id,plan_id,status,current_period_starts_at,current_period_ends_at) "+
    "VALUES($1,$2,'ACTIVE',now(),now()+interval '1 month') RETURNING id",
    [o.businessId,plan.rows[0]!.id],
  );
  const inv=await pool.query<{id:string}>(
    "INSERT INTO subscription_invoices("+
    "business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,"+
    "amount_paid_minor,status,period_start,period_end,issued_at,due_at) "+
    "VALUES($1,$2,$3,'GHS',$4,0,$4,3000,'PARTIALLY_PAID',now(),"+
    "now()+interval '1 month',now(),now()+interval '7 days') RETURNING id",
    [o.businessId,subscription.rows[0]!.id,"INVOICE_"+o.businessId.slice(0,8),amountMinor],
  );
  await pool.query(
    "INSERT INTO subscription_payments("+
    "business_id,invoice_id,amount_minor,currency_code,method,provider,"+
    "provider_event_reference,provider_transaction_reference,status,received_at) "+
    "VALUES($1,$2,3000,'GHS','MOMO','TESTPAY',$3,$4,'SUCCEEDED',now())",
    [o.businessId,inv.rows[0]!.id,"ev_"+o.businessId,"tx_"+o.businessId],
  );
  return {invoiceId:inv.rows[0]!.id};
}

describe("merchant subscription and billing visibility",()=>{
  it("shows only tenant's plan, outstanding invoice amount and posted payment history",async()=>{
    const a=await owner("first");
    const b=await owner("second");
    const aInvoice=await addInvoice(a);
    await addInvoice(b,40000);
    const before=await pool.query("SELECT COUNT(*)::int AS n FROM subscription_payments");
    const res=await app.inject({method:"GET",url:path(a),headers:a.headers});
    expect(res.statusCode,res.body).toBe(200);
    expect(res.json()).toMatchObject({
      businessId:a.businessId,paymentCollectionEnabled:false,
      subscription:{planName:"TradeOS Growth",status:"ACTIVE",planAmountMinor:10000,
        currencyCode:"GHS",billingInterval:"MONTHLY"},
      invoices:[{id:aInvoice.invoiceId,totalMinor:10000,amountPaidMinor:3000,
        outstandingMinor:7000,status:"PARTIALLY_PAID"}],
      payments:[{amountMinor:3000,status:"SUCCEEDED",provider:"TESTPAY",method:"MOMO"}],
      invoiceHistoryLimited:false,paymentHistoryLimited:false,
    });
    expect(res.json().notice).toMatch(/not enabled yet/i);
    expect(JSON.stringify(res.json())).not.toContain(b.businessId);
    expect(res.json().payments[0]).not.toHaveProperty("providerTransactionReference");
    expect(res.json().payments[0]).not.toHaveProperty("providerEventReference");
    const after=await pool.query("SELECT COUNT(*)::int AS n FROM subscription_payments");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("returns honest empty business billing data without creating a subscription",async()=>{
    const a=await owner("empty");
    const res=await app.inject({method:"GET",url:path(a),headers:a.headers});
    expect(res.statusCode,res.body).toBe(200);
    expect(res.json()).toMatchObject({businessId:a.businessId,subscription:null,
      invoices:[],payments:[],paymentCollectionEnabled:false});
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM business_subscriptions")).rows[0].n).toBe(0);
  });

  it("rejects anonymous users, forged businesses, suspended businesses and invalid IDs",async()=>{
    const a=await owner("access-a"),b=await owner("access-b");
    await addInvoice(a);
    expect((await app.inject({method:"GET",url:path(a)})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:path(a),headers:b.headers})).statusCode).toBe(403);
    expect((await app.inject({
      method:"GET",url:"/v1/billing/overview?businessId=not-uuid",headers:a.headers,
    })).statusCode).toBe(400);
    expect((await app.inject({
      method:"GET",url:"/v1/billing/overview",headers:a.headers,
    })).statusCode).toBe(400);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1",[a.businessId]);
    expect((await app.inject({method:"GET",url:path(a),headers:a.headers})).statusCode).toBe(403);
  });

  it("permits accountants and admins, denies cashiers, sales and viewers",async()=>{
    const a=await owner("roles");
    await addInvoice(a);
    for(const role of ["ACCOUNTANT","ADMIN","OWNER"]){
      await pool.query("UPDATE business_memberships SET role=$1 WHERE business_id=$2",
        [role,a.businessId]);
      const res=await app.inject({method:"GET",url:path(a),headers:a.headers});
      expect(res.statusCode,role).toBe(200);
    }
    for(const role of ["CASHIER","SALES","VIEWER","MANAGER"]){
      await pool.query("UPDATE business_memberships SET role=$1 WHERE business_id=$2",
        [role,a.businessId]);
      const res=await app.inject({method:"GET",url:path(a),headers:a.headers});
      expect(res.statusCode,role).toBe(403);
    }
  });
});
