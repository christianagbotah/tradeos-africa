import { randomUUID } from "node:crypto";
import { beforeEach,afterAll,describe,expect,it } from "vitest";
import { createPool } from "../src/db.js";
import {
  prepareSubscriptionCheckoutAttempt,recordCreatedSubscriptionCheckout,
} from "../src/platform-admin/checkout-attempt-service.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
beforeEach(async()=>{await pool.query("TRUNCATE TABLE businesses CASCADE")});
afterAll(async()=>{await pool.end()});

async function setup(credit=0,status:"OPEN"|"PAID"|"PARTIALLY_PAID"="OPEN") {
  const business=await pool.query<{id:string}>(
    "INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status) "+
    "VALUES('Checkout Test','RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id",
  );
  const businessId=business.rows[0]!.id;
  const plan=await pool.query<{id:string}>(
    "INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active) "+
    "VALUES($1,'Checkout Monthly','GHS',10000,'MONTHLY',0,true,true) RETURNING id",
    ["CHECKOUT_"+randomUUID()],
  );
  const subscription=await pool.query<{id:string}>(
    "INSERT INTO business_subscriptions(business_id,plan_id,status) "+
    "VALUES($1,$2,'ACTIVE') RETURNING id",
    [businessId,plan.rows[0]!.id],
  );
  const invoice=await pool.query<{id:string}>(
    "INSERT INTO subscription_invoices("+
    "business_id,subscription_id,invoice_number,currency_code,"+
    "subtotal_minor,total_minor,amount_paid_minor,status,period_start,period_end,due_at) "+
    "VALUES($1,$2,$3,'GHS',10000,10000,$4,$5,now(),"+
    "now()+interval '1 month',now()+interval '7 days') RETURNING id",
    [businessId,subscription.rows[0]!.id,randomUUID(),credit,status],
  );
  return {businessId,invoiceId:invoice.rows[0]!.id,clientRequestId:randomUUID(),
    merchantAccountNumber:"11684"};
}
type Input=Awaited<ReturnType<typeof setup>>;

const urls={
  checkoutId:"7569a11e8b784f21baa9443b3fce31ed",
  checkoutUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed",
  checkoutDirectUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed/direct",
};

async function counts() {
  const x=await pool.query<{
    attempts:string;payments:string;cashbook:string;received:string;
  }>(
    "SELECT (SELECT count(*) FROM subscription_checkout_attempts)::text AS attempts,"+
    "(SELECT count(*) FROM subscription_payments)::text AS payments,"+
    "(SELECT count(*) FROM cashbook_entries)::text AS cashbook,"+
    "(SELECT COALESCE(SUM(amount_paid_minor),0) FROM subscription_invoices)::text AS received",
  );
  return x.rows[0]!;
}

describe("durable Hubtel checkout preparation and idempotency",()=>{
  it("prepares exactly one invoice-specific checkout and safely repeats same client key",async()=>{
    const input=await setup(2500,"PARTIALLY_PAID");
    const first=await prepareSubscriptionCheckoutAttempt(pool,input);
    const again=await prepareSubscriptionCheckoutAttempt(pool,input);
    expect(first).toMatchObject({
      businessId:input.businessId,invoiceId:input.invoiceId,
      clientRequestId:input.clientRequestId,merchantAccountNumber:"11684",
      currencyCode:"GHS",expectedAmountMinor:7500,state:"PREPARED",
      checkoutId:null,checkoutUrl:null,
    });
    expect(first.id).toBe(again.id);
    expect(first.clientReference).toMatch(/^TOS-[0-9a-f]{24}$/);
    expect((await counts()).attempts).toBe("1");
    await expect(prepareSubscriptionCheckoutAttempt(pool,{
      ...input,clientRequestId:randomUUID(),
    })).rejects.toMatchObject({code:"CHECKOUT_ALREADY_OPEN",statusCode:409});
  });

  it("records provider-created links without posting any subscription payment",async()=>{
    const input=await setup();
    const first=await prepareSubscriptionCheckoutAttempt(pool,input);
    const before=await counts();
    const response={businessId:input.businessId,attemptId:first.id,
      clientReference:first.clientReference,...urls};
    const ready=await recordCreatedSubscriptionCheckout(pool,response);
    const replay=await recordCreatedSubscriptionCheckout(pool,response);
    expect(ready).toMatchObject({
      state:"READY",checkoutUrl:urls.checkoutUrl,checkoutDirectUrl:urls.checkoutDirectUrl,
      checkoutId:urls.checkoutId,expectedAmountMinor:10000,
    });
    expect(ready.nextVerifyAt).not.toBeNull();
    expect(replay.id).toBe(ready.id);
    expect(replay.checkoutCreatedAt).toBe(ready.checkoutCreatedAt);
    const after=await counts();
    expect(after).toEqual(before);
  });

  it("rejects wrong tenant, invoice, key, provider references or fake checkout domains",async()=>{
    const a=await setup(),b=await setup();
    const first=await prepareSubscriptionCheckoutAttempt(pool,a);
    await expect(prepareSubscriptionCheckoutAttempt(pool,{
      ...b,businessId:a.businessId,invoiceId:b.invoiceId,
    })).rejects.toMatchObject({code:"CHECKOUT_INVOICE_NOT_FOUND",statusCode:404});
    await expect(prepareSubscriptionCheckoutAttempt(pool,{
      ...a,invoiceId:b.invoiceId,
    })).rejects.toMatchObject({code:"CHECKOUT_INVOICE_NOT_FOUND",statusCode:404});
    await expect(prepareSubscriptionCheckoutAttempt(pool,{
      ...a,merchantAccountNumber:"99999",
    })).rejects.toMatchObject({code:"CHECKOUT_IDEMPOTENCY_CONFLICT"});
    const response={businessId:a.businessId,attemptId:first.id,
      clientReference:first.clientReference,...urls};
    await expect(recordCreatedSubscriptionCheckout(pool,{
      ...response,businessId:b.businessId,
    })).rejects.toMatchObject({code:"CHECKOUT_NOT_FOUND",statusCode:404});
    await expect(recordCreatedSubscriptionCheckout(pool,{
      ...response,clientReference:"TOS-fake",
    })).rejects.toMatchObject({code:"CHECKOUT_PROVIDER_REFERENCE_MISMATCH"});
    await expect(recordCreatedSubscriptionCheckout(pool,{
      ...response,checkoutUrl:"https://evil-pay.hubtel.com/fake",
    })).rejects.toMatchObject({code:"CHECKOUT_PROVIDER_RESPONSE_INVALID"});
    expect((await counts()).payments).toBe("0");
  });

  it("blocks paid invoices and allows a new idempotency key only after closing prior attempt",async()=>{
    const paid=await setup(10000,"PAID");
    await expect(prepareSubscriptionCheckoutAttempt(pool,paid))
      .rejects.toMatchObject({code:"CHECKOUT_INVOICE_UNCOLLECTIBLE",statusCode:409});
    const o=await setup();
    const first=await prepareSubscriptionCheckoutAttempt(pool,o);
    await pool.query(
      "UPDATE subscription_checkout_attempts SET state='CANCELED' WHERE id=$1",
      [first.id],
    );
    const retry=await prepareSubscriptionCheckoutAttempt(pool,{
      ...o,clientRequestId:randomUUID(),
    });
    expect(retry.id).not.toBe(first.id);
    await expect(recordCreatedSubscriptionCheckout(pool,{
      businessId:o.businessId,attemptId:first.id,clientReference:first.clientReference,...urls,
    })).rejects.toMatchObject({code:"CHECKOUT_TRANSITION_FORBIDDEN",statusCode:409});
    expect((await counts()).payments).toBe("0");
  });

  it("rejects direct cross-tenant invoice insertion at database constraint",async()=>{
    const a=await setup(),b=await setup();
    await expect(pool.query(
      "INSERT INTO subscription_checkout_attempts("+
      "business_id,invoice_id,client_request_id,client_reference,merchant_account_number,"+
      "expected_amount_minor,currency_code) VALUES($1,$2,$3,$4,'11684',5000,'GHS')",
      [a.businessId,b.invoiceId,randomUUID(),"TOS-"+randomUUID().replaceAll("-","").slice(0,24)],
    )).rejects.toMatchObject({code:"23503"});
  });
});
