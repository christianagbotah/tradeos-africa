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

async function newUser(email:string,key:string){
  const created=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:email.split("@")[0],email,
    password:"QA-Proof-2026-Safe!!",platform:"WEB",deviceKey:key,appVersion:"test",
  }});
  expect(created.statusCode).toBe(201);
  return {id:created.json().user.id as string,
    headers:{authorization:`Bearer ${created.json().session.accessToken}`}};
}
async function setUp(){
  const submitter=await newUser("submitter-proof@tradeos.test","proof-submitter");
  const reviewer=await newUser("reviewer-proof@tradeos.test","proof-reviewer");
  const cashier=await newUser("cashier-proof@tradeos.test","proof-cashier");
  const outsider=await newUser("outsider-proof@tradeos.test","proof-outsider");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:submitter.headers,payload:{
      name:"Provider Proof QA",branchName:"Main",businessType:"RETAIL_HARDWARE",
    }});
  expect(onboard.statusCode).toBe(201);
  const businessId:string=onboard.json().business.id;
  const branchId:string=onboard.json().branch.id;
  const otherBranchId=(await pool.query<{id:string}>(
    "INSERT INTO branches(business_id,name,code) VALUES($1,'Other','OTHER') RETURNING id",
    [businessId])).rows[0]!.id;
  await pool.query(
    `INSERT INTO business_memberships
     (business_id,user_id,role,status) VALUES
     ($1,$2,'MANAGER','ACTIVE'),($1,$3,'CASHIER','ACTIVE')`,
    [businessId,reviewer.id,cashier.id]);
  async function seed(key:string,branch=branchId,method="MOMO",
    status="PENDING"){
    const sale=(await pool.query<{id:string}>(
      `INSERT INTO sales
       (business_id,branch_id,status,currency_code,subtotal_net_minor,total_minor,
        client_mutation_id)
       VALUES($1,$2,'COMPLETED','GHS',4000,4000,$3) RETURNING id`,
      [businessId,branch,`sale-${key}`])).rows[0]!.id;
    const ret=(await pool.query<{id:string}>(
      `INSERT INTO return_cases
       (business_id,branch_id,original_sale_id,status,reason,refund_method,
        currency_code,refund_total_minor,client_mutation_id)
       VALUES($1,$2,$3,'PROCESSING','Proof QA', $4,'GHS',1400,$5) RETURNING id`,
      [businessId,branch,sale,method,`return-${key}`])).rows[0]!.id;
    const refund=(await pool.query<{id:string}>(
      `INSERT INTO refund_transactions
       (business_id,return_case_id,amount_minor,currency_code,method,status,idempotency_key)
       VALUES($1,$2,1400,'GHS',$3,$4,$5) RETURNING id`,
      [businessId,ret,method,status,`refund-${key}`])).rows[0]!.id;
    return {sale,ret,refund};
  }
  const main=await seed("main");
  const second=await seed("second");
  const otherBranch=await seed("cross",otherBranchId);
  const cashRefund=await seed("cash",branchId,"CASH");
  const closedRefund=await seed("closed",branchId,"MOMO","SUCCEEDED");
  const claim=(refundId:string,ref="HUB-REFUND-QA-0000001",
    clientRequestId=randomUUID(),branch=branchId)=>({
    businessId,branchId:branch,refundId,clientRequestId,
    providerCode:"HUBTEL",providerReference:ref,
    reportedAmountMinor:1400,reportedCurrency:"GHS",recipientLast4:"8721",
    reportedStatus:"CLAIMED_SUCCESS",
    providerCaseReference:"HUB-CASE-332142",
    note:"Provider merchant dashboard shows this reference; awaiting direct authentication.",
  });
  const review=(refundId:string,claimId:string,decision="FIELDS_MATCHED_UNVERIFIED",
    clientRequestId=randomUUID())=>({
    businessId,branchId,refundId,claimId,decision,clientRequestId,
    note:"The amount and currency fields agree, but independent payout proof is missing.",
  });
  const list=(refundId:string,branch=branchId)=>
    `/v1/refunds/provider-evidence?businessId=${businessId}&branchId=${branch}&refundId=${refundId}`;
  const post=(payload:object,headers?:{authorization:string})=>
    app.inject({method:"POST",url:"/v1/refunds/provider-evidence",
      ...(headers?{headers}:{}),payload});
  const doReview=(payload:object,headers?:{authorization:string})=>
    app.inject({method:"POST",url:"/v1/refunds/provider-evidence-review",
      ...(headers?{headers}:{}),payload});
  return {submitter,reviewer,cashier,outsider,
    businessId,branchId,otherBranchId,main,second,otherBranch,cashRefund,
    closedRefund,claim,review,list,post,doReview};
}
describe("unverified refund-specific provider evidence intake",()=>{
  it("records immutable idempotent evidence and isolates each branch and role",async()=>{
    const f=await setUp();
    const id=randomUUID();
    const payload=f.claim(f.main.refund,"HUB-REFUND-QA-0000001",id);
    const first=await f.post(payload,f.submitter.headers);
    expect(first.statusCode).toBe(201);
    const claim=first.json().claim;
    expect(claim).toMatchObject({
      refundId:f.main.refund,providerCode:"HUBTEL",
      expectedAmountMinor:1400,expectedCurrency:"GHS",
      reportedAmountMinor:1400,reportedCurrency:"GHS",
      amountMatches:true,currencyMatches:true,
      recipientLast4:"8721",reportedStatus:"CLAIMED_SUCCESS",
      evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED",
      providerAuthenticated:false,refundDestinationAuthenticated:false,
      providerFinality:"NOT_ESTABLISHED",
      canMarkPaid:false,payoutStatusUnchanged:true,idempotentReplay:false,
    });
    const repeated=await f.post(payload,f.submitter.headers);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().claim).toMatchObject({
      claimId:claim.claimId,idempotentReplay:true,
    });
    const changed=await f.post({...payload,note:"This changes the original note without changing the request identity."},
      f.submitter.headers);
    expect(changed.statusCode).toBe(409);
    const dupReference=await f.post(f.claim(f.second.refund,
      "hub-refund-qa-0000001"),f.submitter.headers);
    expect(dupReference.statusCode).toBe(409);
    const history=await app.inject({method:"GET",url:f.list(f.main.refund),
      headers:f.submitter.headers});
    expect(history.statusCode).toBe(200);
    expect(history.headers["cache-control"]).toContain("no-store");
    expect(history.json()).toMatchObject({
      refundId:f.main.refund,expectedAmountMinor:1400,
      expectedCurrency:"GHS",electronicRefund:true,
      hasMore:false,evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED",
      providerFinality:"NOT_ESTABLISHED",canMarkPaid:false,
    });
    expect(history.json().items).toHaveLength(1);
    expect(history.json().items[0].submittedByName).toBe("submitter-proof");
    expect((await f.post(f.claim(f.otherBranch.refund),f.submitter.headers))
      .statusCode).toBe(404);
    expect((await f.post(f.claim(f.main.refund,"HUB-SECOND-CLAIM"),f.cashier.headers))
      .statusCode).toBe(403);
    expect((await f.post(f.claim(f.main.refund,"HUB-THIRD-CLAIM"),f.outsider.headers))
      .statusCode).toBe(403);
    expect((await f.post(f.claim(f.main.refund,"HUB-FOURTH-CLAIM")))
      .statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:f.list(f.otherBranch.refund),
      headers:f.reviewer.headers})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:f.list(f.main.refund),
      headers:f.cashier.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:f.list(f.main.refund)})
      ).statusCode).toBe(401);
    await expect(pool.query(
      "UPDATE refund_provider_evidence_claims SET reported_amount_minor=1 WHERE id=$1",
      [claim.claimId])).rejects.toThrow(/append-only/i);
    await expect(pool.query(
      "DELETE FROM refund_provider_evidence_claims WHERE id=$1",
      [claim.claimId])).rejects.toThrow(/append-only/i);
    const liabilities=(await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [f.main.refund])).rows[0];
    expect(liabilities).toEqual({status:"PENDING",amount_minor:"1400"});
    const audits=(await pool.query<{total:string}>(
      `SELECT count(*)::text AS total FROM audit_events
       WHERE entity_id=$1 AND event_type='REFUND_PROVIDER_CLAIM_SUBMITTED'`,
      [f.main.refund])).rows[0]!.total;
    expect(audits).toBe("1");
  });
  it("enforces second-person immutable review and never approves payout",async()=>{
    const f=await setUp();
    const claimResult=await f.post(f.claim(f.main.refund),f.submitter.headers);
    expect(claimResult.statusCode).toBe(201);
    const claimId=claimResult.json().claim.claimId as string;
    const payload=f.review(f.main.refund,claimId);
    const self=await f.doReview(payload,f.submitter.headers);
    expect(self.statusCode).toBe(403);
    const cashier=await f.doReview(payload,f.cashier.headers);
    expect(cashier.statusCode).toBe(403);
    const outsider=await f.doReview(payload,f.outsider.headers);
    expect(outsider.statusCode).toBe(403);
    const anonymous=await f.doReview(payload);
    expect(anonymous.statusCode).toBe(401);
    const checked=await f.doReview(payload,f.reviewer.headers);
    expect(checked.statusCode).toBe(201);
    expect(checked.json()).toMatchObject({
      providerFinality:"NOT_ESTABLISHED",canMarkPaid:false,
      review:{decision:"FIELDS_MATCHED_UNVERIFIED",
        providerAuthenticated:false,providerFinality:"NOT_ESTABLISHED",
        idempotentReplay:false},
    });
    const repeated=await f.doReview(payload,f.reviewer.headers);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().review).toMatchObject({
      reviewId:checked.json().review.reviewId,idempotentReplay:true,
    });
    const conflict=await f.doReview({
      ...payload,clientRequestId:randomUUID(),
    },f.reviewer.headers);
    expect(conflict.statusCode).toBe(409);
    const listed=await app.inject({method:"GET",url:f.list(f.main.refund),
      headers:f.submitter.headers});
    expect(listed.json().items[0].review).toMatchObject({
      decision:"FIELDS_MATCHED_UNVERIFIED",
      reviewerName:"reviewer-proof",providerAuthenticated:false,
      providerFinality:"NOT_ESTABLISHED",
    });
    await expect(pool.query(
      "UPDATE refund_provider_evidence_reviews SET decision='DISCREPANCY_RECORDED' WHERE id=$1",
      [checked.json().review.reviewId])).rejects.toThrow(/append-only/i);
    await expect(pool.query(
      "DELETE FROM refund_provider_evidence_reviews WHERE id=$1",
      [checked.json().review.reviewId])).rejects.toThrow(/append-only/i);
    const refund=(await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [f.main.refund])).rows[0];
    expect(refund).toEqual({status:"PENDING",amount_minor:"1400"});
    const audit=(await pool.query<{n:string}>(
      `SELECT count(*)::text AS n FROM audit_events
       WHERE entity_id=$1 AND event_type='REFUND_PROVIDER_CLAIM_REVIEWED'`,
      [f.main.refund])).rows[0]!.n;
    expect(audit).toBe("1");
  });
  it("shows amount and currency mismatches, requires discrepancy classification",async()=>{
    const f=await setUp();
    const first=await f.post({
      ...f.claim(f.main.refund),providerReference:"HUB-MISMATCH-000002",
      reportedAmountMinor:2700,reportedCurrency:"USD",
    },f.submitter.headers);
    expect(first.statusCode).toBe(201);
    expect(first.json().claim).toMatchObject({
      amountMatches:false,currencyMatches:false,canMarkPaid:false,
    });
    const claimId=first.json().claim.claimId as string;
    const wrongReview=await f.doReview(
      f.review(f.main.refund,claimId),f.reviewer.headers);
    expect(wrongReview.statusCode).toBe(409);
    const flagged=await f.doReview(
      f.review(f.main.refund,claimId,"DISCREPANCY_RECORDED"),f.reviewer.headers);
    expect(flagged.statusCode).toBe(201);
    expect(flagged.json().review.decision).toBe("DISCREPANCY_RECORDED");
    expect((await pool.query<{status:string}>(
      "SELECT status FROM refund_transactions WHERE id=$1",
      [f.main.refund])).rows[0]?.status).toBe("PENDING");
  });
  it("rejects unsafe input, non-electronic and closed refunds, bad paging",async()=>{
    const f=await setUp();
    const valid=f.claim(f.main.refund,"HUB-UNIQUE-0000008");
    const invalids=[
      {...valid,providerReference:"https://attacker.example/a"},
      {...valid,providerReference:"short"},
      {...valid,recipientLast4:"0000000000"},
      {...valid,reportedAmountMinor:"NaN"},
      {...valid,reportedAmountMinor:9e18},
      {...valid,reportedCurrency:"ghs"},
      {...valid,providerCode:"UNTRUSTED"},
      {...valid,reportedStatus:"SUCCEEDED"},
      {...valid,note:"short"},
      {...valid,note:"Contains\u0000control and secrets"},
      {...valid,note:"My bank account 123456789012345 and the cashier checked it."},
      {...valid,note:"See https://example.com/payout for the supposed refund."},
      {...valid,note:"The account API key: secret123 is in the email message."},
      {...valid,providerCaseReference:"https://example.com/case"},
      {...valid,reportedAt:"2085-01-01T00:00:00Z"},
    ];
    for(const payload of invalids){
      const denied=await f.post(payload,f.submitter.headers);
      expect(denied.statusCode).toBe(400);
    }
    expect((await f.post(f.claim(f.cashRefund.refund,"CASH-REF-QA-00001"),
      f.submitter.headers)).statusCode).toBe(409);
    expect((await f.post(f.claim(f.closedRefund.refund,"CLOSED-REF-QA-001"),
      f.submitter.headers)).statusCode).toBe(409);
    expect((await app.inject({method:"GET",
      url:f.list(f.main.refund)+"&limit=0",
      headers:f.submitter.headers})).statusCode).toBe(400);
    expect((await app.inject({method:"GET",
      url:f.list(f.main.refund)+"&offset=-1",
      headers:f.submitter.headers})).statusCode).toBe(400);
  });

  it("triages unresolved provider evidence by review, discrepancies, and missing provider proof",async()=>{
    const f=await setUp();
    const endpoint=(status:string,branch=f.branchId)=>
      "/v1/refunds/settlement-queue?businessId="+f.businessId+
      "&branchId="+branch+"&status="+status;
    const allBefore=await app.inject({method:"GET",
      url:endpoint("ALL"),headers:f.submitter.headers});
    expect(allBefore.statusCode).toBe(200);
    const baselineSummary=allBefore.json().summaryByCurrency;
    expect(allBefore.json().items).toHaveLength(3);
    for(const item of allBefore.json().items){
      expect(item).toMatchObject({
        evidenceClaimCount:0,evidenceAwaitingReviewCount:0,
        evidenceDiscrepancyCount:0,providerFinality:"NOT_ESTABLISHED",
      });
    }
    const mismatch=await f.post({
      ...f.claim(f.main.refund,"HUB-TRIAGE-MISMATCH-0001"),
      reportedAmountMinor:1800,reportedCurrency:"USD",
    },f.submitter.headers);
    expect(mismatch.statusCode).toBe(201);
    const matching=await f.post(
      f.claim(f.second.refund,"HUB-TRIAGE-MATCHED-0001"),
      f.submitter.headers);
    expect(matching.statusCode).toBe(201);
    const foreign=await f.post(
      f.claim(f.otherBranch.refund,"HUB-TRIAGE-FOREIGN-0001",
        randomUUID(),f.otherBranchId),f.submitter.headers);
    expect(foreign.statusCode).toBe(201);

    const awaiting=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_AWAITING_REVIEW"),headers:f.reviewer.headers});
    expect(awaiting.statusCode).toBe(200);
    expect(awaiting.json().items).toHaveLength(2);
    expect(awaiting.json().items.every((item:{evidenceClaimCount:number;
      evidenceAwaitingReviewCount:number;providerFinality:string})=>
        item.evidenceClaimCount===1 &&
        item.evidenceAwaitingReviewCount===1 &&
        item.providerFinality==="NOT_ESTABLISHED")).toBe(true);
    expect(awaiting.json().summaryByCurrency).toEqual(baselineSummary);
    const mismatches=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISMATCH"),headers:f.reviewer.headers});
    expect(mismatches.statusCode).toBe(200);
    expect(mismatches.json().items).toHaveLength(1);
    expect(mismatches.json().items[0]).toMatchObject({
      id:f.main.refund,evidenceDiscrepancyCount:1,
      evidenceClaimCount:1,providerFinality:"NOT_ESTABLISHED",
    });
    expect(mismatches.json().summaryByCurrency).toEqual(baselineSummary);
    expect(JSON.stringify(mismatches.json())).not.toContain("8721");
    expect(JSON.stringify(mismatches.json())).not.toContain("HUB-TRIAGE-MISMATCH-0001");
    const noVerified=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_NEEDS_PROVIDER"),headers:f.reviewer.headers});
    expect(noVerified.json().items).toHaveLength(0);
    const reviewed=await f.doReview(f.review(f.second.refund,
      matching.json().claim.claimId),f.reviewer.headers);
    expect(reviewed.statusCode).toBe(201);
    const flagged=await f.doReview(f.review(f.main.refund,
      mismatch.json().claim.claimId,"DISCREPANCY_RECORDED"),f.reviewer.headers);
    expect(flagged.statusCode).toBe(201);
    const afterReview=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_AWAITING_REVIEW"),headers:f.reviewer.headers});
    expect(afterReview.json().items).toHaveLength(0);
    const providerNeeded=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_NEEDS_PROVIDER"),headers:f.reviewer.headers});
    expect(providerNeeded.statusCode).toBe(200);
    expect(providerNeeded.json().items).toHaveLength(1);
    expect(providerNeeded.json().items[0]).toMatchObject({
      id:f.second.refund,evidenceClaimCount:1,
      evidenceAwaitingReviewCount:0,evidenceDiscrepancyCount:0,
      providerFinality:"NOT_ESTABLISHED",
    });
    const stillMismatch=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISMATCH"),headers:f.reviewer.headers});
    expect(stillMismatch.json().items).toHaveLength(1);
    expect(stillMismatch.json().items[0].id).toBe(f.main.refund);
    expect(providerNeeded.json().summaryByCurrency).toEqual(baselineSummary);
    expect((await app.inject({method:"GET",url:endpoint("EVIDENCE_MISMATCH",
      f.otherBranchId),headers:f.reviewer.headers})).json().items).toHaveLength(0);
    expect((await app.inject({method:"GET",url:endpoint("EVIDENCE_MISMATCH"),
      headers:f.cashier.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:endpoint("EVIDENCE_MISMATCH"),
      headers:f.outsider.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:endpoint("EVIDENCE_MISMATCH")}
      )).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:endpoint("EVIDENCE_VERIFIED"),
      headers:f.submitter.headers})).statusCode).toBe(400);
    const actual=(await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [f.main.refund])).rows[0];
    expect(actual).toEqual({status:"PENDING",amount_minor:"1400"});
  });

  it("summarizes every unresolved branch refund per currency regardless of pagination",async()=>{
    const f=await setUp();
    // Add one USD payout liability to prove original refund currency isolation.
    const sale=(await pool.query<{id:string}>(
      `INSERT INTO sales
       (business_id,branch_id,status,currency_code,subtotal_net_minor,total_minor,
        client_mutation_id)
       VALUES($1,$2,'COMPLETED','USD',7900,7900,$3) RETURNING id`,
      [f.businessId,f.branchId,"sale-usd-rollup"])).rows[0]!.id;
    const ret=(await pool.query<{id:string}>(
      `INSERT INTO return_cases
       (business_id,branch_id,original_sale_id,status,reason,refund_method,
        currency_code,refund_total_minor,client_mutation_id)
       VALUES($1,$2,$3,'PROCESSING','USD test','MOMO','USD',2700,$4)
       RETURNING id`,[f.businessId,f.branchId,sale,"return-usd-rollup"]
    )).rows[0]!.id;
    const usdRefund=(await pool.query<{id:string}>(
      `INSERT INTO refund_transactions
       (business_id,return_case_id,amount_minor,currency_code,method,status,idempotency_key)
       VALUES($1,$2,2700,'USD','MOMO','PENDING','refund-usd-rollup')
       RETURNING id`,[f.businessId,ret])).rows[0]!.id;
    const endpoint=(status:string,branch=f.branchId,extra="")=>
      `/v1/refunds/settlement-queue?businessId=${f.businessId}&branchId=${branch}&status=${status}${extra}`;
    const original=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISSING",f.branchId,"&limit=1"),
      headers:f.submitter.headers});
    expect(original.statusCode).toBe(200);
    expect(original.json().items).toHaveLength(1);
    expect(original.json().hasMore).toBe(true);
    expect(original.json().summaryByCurrency).toHaveLength(2);
    expect(original.json().evidenceSummaryByCurrency).toEqual([
      {currencyCode:"GHS",missingCount:2,missingMinor:2800,
        awaitingReviewCount:0,awaitingReviewMinor:0,
        discrepancyCount:0,discrepancyMinor:0,
        needsProviderCount:0,needsProviderMinor:0},
      {currencyCode:"USD",missingCount:1,missingMinor:2700,
        awaitingReviewCount:0,awaitingReviewMinor:0,
        discrepancyCount:0,discrepancyMinor:0,
        needsProviderCount:0,needsProviderMinor:0},
    ]);
    // An unresolved cash refund is not an electronic provider-evidence case.
    const fullMissing=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISSING"),headers:f.submitter.headers});
    expect(fullMissing.json().items).toHaveLength(3);
    expect(fullMissing.json().items.some(
      (item:{id:string})=>item.id===f.cashRefund.refund)).toBe(false);
    expect(fullMissing.json().items.some(
      (item:{id:string})=>item.id===usdRefund)).toBe(true);

    const mismatch=await f.post({...f.claim(f.main.refund,"HUB-ROLLUP-MISMATCH"),
      reportedAmountMinor:1900,reportedCurrency:"USD"},f.submitter.headers);
    const matching=await f.post(f.claim(f.second.refund,"HUB-ROLLUP-MATCH"),
      f.submitter.headers);
    expect(mismatch.statusCode).toBe(201);
    expect(matching.statusCode).toBe(201);
    const afterClaims=await app.inject({method:"GET",
      url:endpoint("ALL",f.branchId,"&limit=1&offset=1"),
      headers:f.reviewer.headers});
    expect(afterClaims.statusCode).toBe(200);
    expect(afterClaims.json().items).toHaveLength(1);
    expect(afterClaims.json().evidenceSummaryByCurrency[0]).toMatchObject({
      currencyCode:"GHS",missingCount:0,missingMinor:0,
      awaitingReviewCount:2,awaitingReviewMinor:2800,
      discrepancyCount:1,discrepancyMinor:1400,
      needsProviderCount:0,needsProviderMinor:0,
    });
    expect(afterClaims.json().evidenceSummaryByCurrency[1]).toMatchObject({
      currencyCode:"USD",missingCount:1,missingMinor:2700,
    });
    const approved=await f.doReview(f.review(
      f.second.refund,matching.json().claim.claimId),f.reviewer.headers);
    expect(approved.statusCode).toBe(201);
    const reviewed=await app.inject({method:"GET",
      url:endpoint("EVIDENCE_NEEDS_PROVIDER"),headers:f.reviewer.headers});
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().items).toHaveLength(1);
    expect(reviewed.json().items[0].id).toBe(f.second.refund);
    expect(reviewed.json().evidenceSummaryByCurrency[0]).toMatchObject({
      awaitingReviewCount:1,awaitingReviewMinor:1400,
      discrepancyCount:1,discrepancyMinor:1400,
      needsProviderCount:1,needsProviderMinor:1400,
    });
    const flagged=await f.doReview(f.review(f.main.refund,
      mismatch.json().claim.claimId,"DISCREPANCY_RECORDED"),f.reviewer.headers);
    expect(flagged.statusCode).toBe(201);
    const final=await app.inject({method:"GET",
      url:endpoint("ALL"),headers:f.reviewer.headers});
    expect(final.json().evidenceSummaryByCurrency[0]).toMatchObject({
      awaitingReviewCount:0,awaitingReviewMinor:0,
      discrepancyCount:1,discrepancyMinor:1400,
      needsProviderCount:1,needsProviderMinor:1400,
    });
    const foreign=await f.post(f.claim(f.otherBranch.refund,
      "HUB-ROLLUP-OTHER",randomUUID(),f.otherBranchId),f.submitter.headers);
    expect(foreign.statusCode).toBe(201);
    const afterForeign=await app.inject({method:"GET",
      url:endpoint("ALL"),headers:f.reviewer.headers});
    expect(afterForeign.json().evidenceSummaryByCurrency).toEqual(
      final.json().evidenceSummaryByCurrency);
    expect((await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISSING"),headers:f.cashier.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISSING"),headers:f.outsider.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",
      url:endpoint("EVIDENCE_MISSING")})).statusCode).toBe(401);
    expect((await pool.query<{status:string}>(
      "SELECT status FROM refund_transactions WHERE id=$1",[usdRefund]
    )).rows[0]?.status).toBe("PENDING");
  });
});
