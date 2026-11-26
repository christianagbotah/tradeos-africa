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

describe("Hubtel billing checkout guarded activation and verification",()=>{
  it("leaves collection unavailable with no merchant configuration, with no financial writes",async()=>{
    const previous=process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED;
    delete process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED;
    try{
      const a=await owner("hubtel-off");
      const inv=await addInvoice(a);
      const body={businessId:a.businessId,invoiceId:inv.invoiceId,
        clientRequestId:"a4df2e2c-03bf-4a52-b842-23d7ac0d3001"};
      expect((await app.inject({method:"POST",url:"/v1/billing/hubtel/checkout",payload:body})).statusCode)
        .toBe(401);
      const denied=await app.inject({method:"POST",url:"/v1/billing/hubtel/checkout",
        payload:body,headers:a.headers});
      expect(denied.statusCode).toBe(503);
      expect(denied.json()).toMatchObject({error:"HUBTEL_COLLECTION_DISABLED"});
      const count=await pool.query("SELECT count(*)::int n FROM subscription_checkout_attempts");
      expect(count.rows[0].n).toBe(0);
      const callback=await app.inject({method:"POST",url:"/v1/billing/hubtel/callback",
        payload:{ResponseCode:"0000",Data:{ClientReference:"fabricated",Amount:999999}}});
      expect(callback.statusCode).toBe(202);
      expect(callback.json()).toMatchObject({verification:"SERVER_SIDE_REQUIRED"});
      const still=await pool.query("SELECT count(*)::int n FROM subscription_payments");
      expect(still.rows[0].n).toBe(1);
    }finally{
      if(previous===undefined)delete process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED;
      else process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED=previous;
    }
  });

  it("creates one hosted checkout, rejects forged tenants, and records only server-verified payment",async()=>{
    const before={
      enabled:process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED,
      id:process.env.TRADEOS_HUBTEL_API_ID,
      key:process.env.TRADEOS_HUBTEL_API_KEY,
      account:process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT,
    };
    const priorFetch=globalThis.fetch;
    process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED="true";
    process.env.TRADEOS_HUBTEL_API_ID="test-id";
    process.env.TRADEOS_HUBTEL_API_KEY="test-secret";
    process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT="11684";
    let initiated=0,verified=0;
    let reference="";
    globalThis.fetch=(async(url:RequestInfo|URL,options?:RequestInit)=>{
      const address=String(url);
      const auth=(options?.headers as Record<string,string>)?.authorization;
      expect(auth).toBe("Basic "+Buffer.from("test-id:test-secret").toString("base64"));
      if(address==="https://payproxyapi.hubtel.com/items/initiate"){
        initiated++;
        const req=JSON.parse(String(options?.body)) as {
          clientReference:string;totalAmount:number;callbackUrl:string;};
        reference=req.clientReference;
        expect(req.totalAmount).toBe(70);
        expect(req.callbackUrl).toBe("https://tradeosafrica.lightworldtech.com/v1/billing/hubtel/callback");
        return new Response(JSON.stringify({responseCode:"0000",status:"Success",data:{
          clientReference:reference,checkoutId:"7569a11e8b784f21baa9443b3fce31ed",
          checkoutUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed",
          checkoutDirectUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed/direct",
        }}),{status:200});
      }
      if(address.startsWith("https://api-txnstatus.hubtel.com/")){
        verified++;
        expect(address).toContain("clientReference="+encodeURIComponent(reference));
        return new Response(JSON.stringify({responseCode:"0000",message:"Successful",data:{
          clientReference:reference,status:"Paid",currencyCode:"GHS",amount:70,
          transactionId:"hubtel-test-txn-001",date:"2026-11-15T12:30:00Z",
        }}),{status:200});
      }
      throw new Error("Unexpected external host");
    }) as typeof fetch;
    try{
      const a=await owner("hubtel-live-a"),b=await owner("hubtel-live-b");
      const invoice=await addInvoice(a);
      const body={businessId:a.businessId,invoiceId:invoice.invoiceId,
        clientRequestId:"ad3d6bd8-c910-40ee-9b8e-2e0e0a1d3932"};
      const forged=await app.inject({method:"POST",url:"/v1/billing/hubtel/checkout",
        headers:b.headers,payload:body});
      expect(forged.statusCode).toBe(403);
      const first=await app.inject({method:"POST",url:"/v1/billing/hubtel/checkout",
        headers:a.headers,payload:body});
      expect(first.statusCode,first.body).toBe(200);
      expect(first.json().checkout).toMatchObject({
        businessId:a.businessId,invoiceId:invoice.invoiceId,
        expectedAmountMinor:7000,state:"READY",
      });
      const attemptId=first.json().checkout.id as string;
      const retry=await app.inject({method:"POST",url:"/v1/billing/hubtel/checkout",
        headers:a.headers,payload:body});
      expect(retry.statusCode,retry.body).toBe(200);
      expect(retry.json().checkout.id).toBe(attemptId);
      expect(initiated).toBe(1);
      const unchecked=await pool.query<{count:string}>(
        "SELECT count(*)::text AS count FROM subscription_payments WHERE provider='HUBTEL'");
      expect(unchecked.rows[0].count).toBe("0");
      const forgedVerify=await app.inject({method:"POST",
        url:"/v1/billing/hubtel/checkout/"+attemptId+"/verify",
        headers:b.headers,payload:{businessId:a.businessId}});
      expect(forgedVerify.statusCode).toBe(403);
      const confirmed=await app.inject({method:"POST",
        url:"/v1/billing/hubtel/checkout/"+attemptId+"/verify",
        headers:a.headers,payload:{businessId:a.businessId}});
      expect(confirmed.statusCode,confirmed.body).toBe(200);
      expect(confirmed.json().result).toMatchObject({state:"RECONCILED",status:"PAID"});
      expect(verified).toBe(1);
      const replay=await app.inject({method:"POST",
        url:"/v1/billing/hubtel/checkout/"+attemptId+"/verify",
        headers:a.headers,payload:{businessId:a.businessId}});
      expect(replay.statusCode,replay.body).toBe(200);
      const paid=await pool.query<{n:string}>(
        "SELECT count(*)::text n FROM subscription_payments WHERE provider='HUBTEL' AND invoice_id=$1",
        [invoice.invoiceId]);
      expect(paid.rows[0].n).toBe("1");
      const account=await pool.query<{status:string;amount_paid_minor:string}>(
        "SELECT status,amount_paid_minor::text FROM subscription_invoices WHERE id=$1",
        [invoice.invoiceId]);
      expect(account.rows[0]).toEqual({status:"PAID",amount_paid_minor:"10000"});
    }finally{
      globalThis.fetch=priorFetch;
      for(const [key,value] of Object.entries({
        TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED:before.enabled,
        TRADEOS_HUBTEL_API_ID:before.id,
        TRADEOS_HUBTEL_API_KEY:before.key,
        TRADEOS_HUBTEL_COLLECTION_ACCOUNT:before.account,
      })){
        if(value===undefined)delete process.env[key];else process.env[key]=value;
      }
    }
  });
});
