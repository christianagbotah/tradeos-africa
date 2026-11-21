import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",url: "/v1/auth/register",
    payload: {displayName:email.split("@")[0],email,
      password:"Safe-Export-QA-2026!",platform:"WEB",
      deviceKey,appVersion:"test"},
  });
  expect(response.statusCode).toBe(201);
  return {id:response.json().user.id as string,
    headers:{authorization:`Bearer ${response.json().session.accessToken}`}};
}

async function fixture() {
  const owner=await register("export-owner@tradeos.test","export-owner");
  const manager=await register("export-manager@tradeos.test","export-manager");
  const cashier=await register("export-cashier@tradeos.test","export-cashier");
  const outsider=await register("export-outsider@tradeos.test","export-outsider");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:owner.headers,payload:{name:"Export QA Business",
      branchName:"HQ",businessType:"RETAIL_HARDWARE"}});
  expect(onboard.statusCode).toBe(201);
  const businessId:string=onboard.json().business.id;
  const branchId:string=onboard.json().branch.id;
  const otherBranchId=(await pool.query<{id:string}>(
    "INSERT INTO branches(business_id,name,code) VALUES($1,'Other','OTHER') RETURNING id",
    [businessId])).rows[0]!.id;
  await pool.query(
    `INSERT INTO business_memberships(business_id,user_id,role,status)
      VALUES($1,$2,'MANAGER','ACTIVE'),($1,$3,'CASHIER','ACTIVE')`,
    [businessId,manager.id,cashier.id]);
  async function seed(key:string,branch=branchId,method="MOMO",
    status="PENDING",daysOld=0) {
    const sale=(await pool.query<{id:string}>(
      `INSERT INTO sales(business_id,branch_id,status,currency_code,
       subtotal_net_minor,total_minor,client_mutation_id)
       VALUES($1,$2,'COMPLETED','GHS',1500,1500,$3) RETURNING id`,
      [businessId,branch,`sale-${key}`])).rows[0]!.id;
    const ret=(await pool.query<{id:string}>(
      `INSERT INTO return_cases(business_id,branch_id,original_sale_id,
       status,reason,refund_method,currency_code,refund_total_minor,client_mutation_id)
       VALUES($1,$2,$3,'PROCESSING','Customer requested return',$4,'GHS',1400,$5)
       RETURNING id`,[businessId,branch,sale,method,`ret-${key}`])).rows[0]!.id;
    const refund=(await pool.query<{id:string}>(
      `INSERT INTO refund_transactions
       (business_id,return_case_id,amount_minor,currency_code,method,
        status,idempotency_key,created_at)
       VALUES($1,$2,1400,'GHS',$3,$4,$5,
         NOW()-($6::integer*INTERVAL '1 day')) RETURNING id`,
      [businessId,ret,method,status,`refund-${key}`,daysOld])).rows[0]!.id;
    return refund;
  }
  const missing=await seed("missing");
  const mismatch=await seed("mismatch");
  const matched=await seed("matched");
  const failed=await seed("failed",branchId,"CARD","FAILED",2);
  const cash=await seed("cash",branchId,"CASH");
  const closed=await seed("closed",branchId,"MOMO","SUCCEEDED");
  const other=await seed("other",otherBranchId);
  async function submit(refundId:string,providerReference:string,
    reportedAmountMinor=1400,reportedCurrency="GHS") {
    const response=await app.inject({method:"POST",
      url:"/v1/refunds/provider-evidence",headers:owner.headers,
      payload:{businessId,branchId,refundId,clientRequestId:randomUUID(),
        providerCode:"HUBTEL",providerReference,reportedAmountMinor,
        reportedCurrency,recipientLast4:"6693",reportedStatus:"CLAIMED_SUCCESS",
        note:"Merchant supplied an external reference; independent provider confirmation is pending."}});
    expect(response.statusCode).toBe(201);
    return response.json().claim.claimId as string;
  }
  const mismatchClaim=await submit(mismatch,"EXPORT-QA-MISMATCH-001",1800);
  const matchedClaim=await submit(matched,"EXPORT-QA-MATCHED-001");
  const reviewed=await app.inject({method:"POST",
    url:"/v1/refunds/provider-evidence-review",headers:manager.headers,
    payload:{businessId,branchId,refundId:matched,
      claimId:matchedClaim,clientRequestId:randomUUID(),
      decision:"FIELDS_MATCHED_UNVERIFIED",
      note:"Claimed amount and currency match but no independently authenticated refund receipt."}});
  expect(reviewed.statusCode).toBe(201);
  const url=(status="ALL",currency?:string,branch=branchId)=>
    `/v1/refunds/settlement-evidence-export?businessId=${businessId}&branchId=${branch}&status=${status}${currency?`&currencyCode=${currency}`:""}`;
  return {owner,manager,cashier,outsider,businessId,branchId,otherBranchId,
    missing,mismatch,matched,failed,cash,closed,other,mismatchClaim,matchedClaim,
    seed,url};
}

describe("finance-only unresolved refund CSV export", () => {
  it("exports all unresolved branch refunds and safely excludes private payout details", async () => {
    const f=await fixture();
    const res=await app.inject({method:"GET",url:f.url(),headers:f.owner.headers});
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="tradeos-refund-investigations-/);
    expect(res.rawPayload.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))).toBe(true);
    const lines=res.body.replace(/^\ufeff/,"").trimEnd().split("\r\n");
    expect(lines).toHaveLength(6); // header + 5 unresolved in this branch
    for(const id of [f.missing,f.mismatch,f.matched,f.failed,f.cash]) {
      expect(res.body).toContain(id);
    }
    for(const id of [f.closed,f.other])expect(res.body).not.toContain(id);
    expect(res.body).toContain('"DISCREPANCY"');
    expect(res.body).toContain('"PROVIDER_PROOF_REQUIRED"');
    expect(res.body).toContain('"NO_EVIDENCE_SUBMITTED"');
    expect(res.body).toContain('"NOT_ELECTRONIC"');
    expect(res.body).toContain('"MERCHANT_SUPPLIED_UNVERIFIED","NOT_ESTABLISHED","FALSE"');
    expect(res.body).not.toContain("6693");
    expect(res.body).not.toContain("independent provider confirmation is pending");
    const liability=(await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [f.mismatch])).rows[0];
    expect(liability).toEqual({status:"PENDING",amount_minor:"1400"});
  });
  it("exports exact matching finance filters independently of the ten-item visible page", async () => {
    const f=await fixture();
    const cases: Array<[string,string[],string[]]> = [
      ["EVIDENCE_MISSING",[f.missing,f.failed],[f.matched,f.mismatch,f.cash]],
      ["EVIDENCE_MISMATCH",[f.mismatch],[f.missing,f.matched,f.failed]],
      ["EVIDENCE_AWAITING_REVIEW",[f.mismatch],[f.matched,f.missing]],
      ["EVIDENCE_NEEDS_PROVIDER",[f.matched],[f.mismatch,f.missing]],
      ["FAILED",[f.failed],[f.mismatch,f.matched,f.missing]],
      ["PENDING_24H",[],[f.missing,f.mismatch,f.matched]],
    ];
    for(const [filter,yes,no] of cases) {
      const res=await app.inject({method:"GET",url:f.url(filter),headers:f.manager.headers});
      expect(res.statusCode).toBe(200);
      for(const id of yes)expect(res.body).toContain(id);
      for(const id of no)expect(res.body).not.toContain(id);
    }
    const onlyGhs=await app.inject({method:"GET",url:f.url("ALL","GHS"),
      headers:f.owner.headers});
    expect(onlyGhs.statusCode).toBe(200);
    expect(onlyGhs.body).toContain(f.missing);
    const usd=await app.inject({method:"GET",url:f.url("ALL","USD"),
      headers:f.owner.headers});
    expect(usd.statusCode).toBe(200);
    expect(usd.body.replace(/^\ufeff/,"").trimEnd().split("\r\n")).toHaveLength(1);
  });
  it("exports every matching branch row beyond the visible 10-record worklist page",async()=>{
    const f=await fixture();
    const extra: string[]=[];
    for(let i=0;i<12;i++)extra.push(await f.seed("beyond-page-"+i));
    const response=await app.inject({method:"GET",url:f.url("ALL"),
      headers:f.owner.headers});
    expect(response.statusCode).toBe(200);
    expect(response.body.replace(/^\ufeff/,"").trimEnd().split("\r\n"))
      .toHaveLength(18); // 5 base + 12 additional + 1 header
    expect(response.body).toContain(extra[0]);
    expect(response.body).toContain(extra[11]);
  });
  it("denies unauthorized roles and cross-branch access without leaking CSV data",async()=>{
    const f=await fixture();
    const unauthorized=await app.inject({method:"GET",url:f.url()});
    expect(unauthorized.statusCode).toBe(401);
    const cashier=await app.inject({method:"GET",url:f.url(),
      headers:f.cashier.headers});
    expect(cashier.statusCode).toBe(403);
    const outsider=await app.inject({method:"GET",url:f.url(),
      headers:f.outsider.headers});
    expect(outsider.statusCode).toBe(403);
    const other=await app.inject({method:"GET",url:f.url("ALL",undefined,f.otherBranchId),
      headers:f.owner.headers});
    expect(other.statusCode).toBe(200);
    expect(other.body).toContain(f.other);
    expect(other.body).not.toContain(f.missing);
    const differentBusiness=await app.inject({method:"GET",
      url:f.url().replace(f.businessId,randomUUID()),headers:f.owner.headers});
    expect(differentBusiness.statusCode).toBe(403);
  });
  it("validates request parameters before any CSV is served",async()=>{
    const f=await fixture();
    for(const url of [
      f.url("NOT_A_REAL_STATUS"),
      f.url("ALL","G$S"),
      f.url("ALL","ghs"),
      f.url().replace(f.branchId,"bad-branch"),
      f.url().replace(f.businessId,"not-an-id"),
    ]) {
      const res=await app.inject({method:"GET",url,headers:f.owner.headers});
      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).not.toContain("text/csv");
    }
    const missingBranch=await app.inject({method:"GET",
      url:f.url().replace(f.branchId,randomUUID()),headers:f.owner.headers});
    expect(missingBranch.statusCode).toBe(404);
  });
});
