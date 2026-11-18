"use client";

import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";
import {MoneyValue} from "../business/money-value";
import {GatewayHostedTestCheckout} from "./gateway-hosted-test-checkout";
import {GatewayEligibleSalePicker} from "./gateway-eligible-sale-picker";

type Attempt={
  attemptId:string;saleId:string;branchId:string;providerCode:string;
  environment:"TEST";clientReference:string;expectedAmountMinor:string;
  currencyCode:string;paymentMethod:string;state:string;createdAt:string;
  sandboxEvidence:{status:"TEST_PAID_OBSERVED"|"TEST_UNPAID_OBSERVED";
    observedAt:string;posted:false}|null;
  sandboxCheckout:{
    state:"INITIATING"|"READY"|"OUTCOME_UNKNOWN";
    checkoutUrl:string|null;environment:"TEST";charged:false;settled:false;
  }|null;
};
type Monitor={
  businessId:string;collectionEnabled:false;notice:string;
  summary:{prepared:number;cancelled:number;reviewRequired:number};
  attempts:Attempt[];
};
export function GatewayAttemptMonitor({businessId,online}:{
  businessId:string;online:boolean;
}){
  const [data,setData]=useState<Monitor|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [revision,setRevision]=useState(0);
  const [saleId,setSaleId]=useState("");
  const [requestId,setRequestId]=useState<string|null>(null);
  const [providerTx,setProviderTx]=useState<Record<string,string>>({});
  const [busyId,setBusyId]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [mutationError,setMutationError]=useState<string|null>(null);
  const base="/v1/businesses/"+encodeURIComponent(businessId)+
    "/payment-gateways/attempts";
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function mutate(url:string,payload:unknown,id:string,success:string){
    if(!online||busyId)return;
    setBusyId(id);setMutationError(null);setNotice(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(url,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      setNotice(success);
      setRevision(v=>v+1);
      return true;
    }catch(e){
      setMutationError(e instanceof Error?e.message:"TEST attempt operation failed.");
      return false;
    }finally{setBusyId(null);}
  }
  async function prepare(){
    const input=saleId.trim();
    if(!uuid.test(input))return;
    const id=requestId??crypto.randomUUID();
    setRequestId(id);
    const okay=await mutate(base,{
      saleId:input,clientRequestId:id,
    },"PREPARE","TEST attempt prepared. No checkout, charge or receipt was created. "+
      "Use its original reference only in the provider's TEST environment.");
    if(okay){setSaleId("");setRequestId(null);}
  }
  async function verify(attempt:Attempt){
    if(attempt.state!=="PREPARED"||attempt.sandboxEvidence?.status==="TEST_PAID_OBSERVED")return;
    const transactionId=providerTx[attempt.attemptId]?.trim()??"";
    if(attempt.providerCode==="FLUTTERWAVE"&&!/^[1-9][0-9]{0,15}$/.test(transactionId)){
      setMutationError("Enter the numeric Flutterwave TEST transaction ID before checking.");
      return;
    }
    await mutate(base+"/"+encodeURIComponent(attempt.attemptId)+"/verify-sandbox",{
      ...(attempt.providerCode==="FLUTTERWAVE"?
        {providerTransactionId:transactionId}:{}),
    },attempt.attemptId,
    "Provider TEST status checked. Any evidence is sandbox-only; "+
    "the original sale is still open and unpaid in TradeOS.");
  }
  async function close(attempt:Attempt,decision:"CANCELLED"|"REVIEW_REQUIRED"){
    if(attempt.state!=="PREPARED"||
       !window.confirm("Close this TEST attempt as "+decision.toLowerCase().replaceAll("_"," ")+"? "+
         "This does not refund a customer or alter the sale."))return;
    await mutate(base+"/"+encodeURIComponent(attempt.attemptId)+"/close",{
      decision,reasonCode:decision==="CANCELLED"?
        "MERCHANT_CANCELLED_TEST":"MERCHANT_REQUESTED_REVIEW",
    },attempt.attemptId,"TEST attempt closed without changing sale or payment records.");
  }

  useEffect(()=>{
    setData(null);setError(null);
    if(!online){setLoading(false);return;}
    let active=true;setLoading(true);
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+
      "/payment-gateways/attempts?limit=20").then(async response=>{
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const result=await response.json() as Monitor;
      if(result.businessId!==businessId||result.collectionEnabled!==false)
        throw new Error("The payment audit response was not expected.");
      if(active)setData(result);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:
      "Payment attempts cannot be loaded.");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,online,revision]);

  return <section aria-label="Electronic payment test audit"
    style={{border:"1px solid var(--tos-color-border,#cbd5e1)",
      borderRadius:12,padding:16,display:"grid",gap:12,minWidth:0}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,
      flexWrap:"wrap",alignItems:"center"}}>
      <div>
        <h3>Payment attempt audit</h3>
        <p>Tenant-scoped TEST attempts and review queue. Preparation is not proof
          of collection; an observed sandbox payment never settles a real sale.</p>
      </div>
      <Button type="button" variant="outline"
        disabled={!online||loading}
        onClick={()=>setRevision(n=>n+1)}>Refresh</Button>
    </div>
    {!online?<p role="status">Connect to view the verified server audit.</p>:null}
    {loading?<p role="status">Loading payment attempt records…</p>:null}
    {error||mutationError?<p role="alert" className="tos-banner tos-banner--danger">
      {error??mutationError}</p>:null}
    {notice?<p role="status" className="tos-callout">{notice}</p>:null}
    <div style={{display:"grid",gap:9,border:"1px solid #a5b3c7",
      borderRadius:10,padding:12}}>
      <strong>Prepare a Paystack / Flutterwave sandbox test</strong>
      <p style={{margin:0,fontSize:13}}>Choose an eligible pending sale.
        TradeOS displays the branch, amount and payment method and excludes
        sales that already have a gateway attempt. Preparing this attempt creates
        only a TEST reference: <strong>no checkout or live collection occurs
        during preparation</strong>. A separate password-confirmed action can
        create one provider-hosted TEST checkout.</p>
      <GatewayEligibleSalePicker businessId={businessId} online={online}
        revision={revision} value={saleId}
        onChange={next=>{setSaleId(next);setRequestId(null);}}/>
      <details>
        <summary style={{cursor:"pointer",fontSize:13}}>
          Advanced: use an existing sale ID directly</summary>
        <label htmlFor="gateway-test-sale-id">
          Open sale ID (UUID)</label>
        <input id="gateway-test-sale-id" className="tos-input"
          style={{width:"100%",maxWidth:600,display:"block",marginTop:7}}
          value={saleId} placeholder="Paste the open sale UUID"
          disabled={!online||Boolean(busyId)}
          onChange={e=>{setSaleId(e.target.value);setRequestId(null);}}/>
        <small>The server validates the same restrictions for manually
          entered IDs. A paid, closed or already-attempted sale will be rejected.</small>
      </details>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <Button type="button" variant="primary" loading={busyId==="PREPARE"}
          disabled={!online||Boolean(busyId)||!uuid.test(saleId.trim())}
          onClick={()=>void prepare()}>Prepare selected TEST attempt</Button>
        {uuid.test(saleId.trim())?
          <small role="status">TEST only · no real payment or receipt</small>:null}
      </div>
    </div>
    {data?<><div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
      <span>Prepared: <strong>{data.summary.prepared}</strong></span>
      <span>Cancelled: <strong>{data.summary.cancelled}</strong></span>
      <span>Review required: <strong>{data.summary.reviewRequired}</strong></span>
    </div>
    {data.attempts.length?<div style={{maxWidth:"100%",overflowX:"auto"}}>
      <table style={{width:"100%",fontSize:13}}>
        <thead><tr><th>When</th><th>Gateway</th><th>Method</th>
          <th>Amount</th><th>State</th><th>Sandbox observation</th>
          <th>Reference</th><th>TEST actions</th></tr></thead>
        <tbody>{data.attempts.map(attempt=>(
          <tr key={attempt.attemptId}>
            <td>{new Date(attempt.createdAt).toLocaleString("en-GB")}</td>
            <td>{attempt.providerCode}</td>
            <td>{attempt.paymentMethod}</td>
            <td>{Number.isSafeInteger(Number(attempt.expectedAmountMinor))?
              <MoneyValue minor={Number(attempt.expectedAmountMinor)}
                currencyCode={attempt.currencyCode}/>:
              attempt.expectedAmountMinor+" "+attempt.currencyCode}</td>
            <td>{attempt.state.replaceAll("_"," ")}</td>
            <td>{attempt.sandboxEvidence?
              <span title={"Observed "+attempt.sandboxEvidence.observedAt}>
                {attempt.sandboxEvidence.status==="TEST_PAID_OBSERVED"?
                  "TEST payment observed — not settled":"TEST unpaid observed"}
              </span>:"Not checked"}</td>
            <td><code>{attempt.clientReference}</code></td>
            <td><div style={{display:"grid",gap:7,minWidth:170}}>
              {attempt.state==="PREPARED"&&
               attempt.sandboxEvidence?.status!=="TEST_PAID_OBSERVED"?<>
                {attempt.providerCode==="FLUTTERWAVE"?<>
                  <label htmlFor={"gateway-tx-"+attempt.attemptId}>
                    Flutterwave TEST transaction ID</label>
                  <input id={"gateway-tx-"+attempt.attemptId} className="tos-input"
                    inputMode="numeric" style={{maxWidth:185}}
                    placeholder="Numeric provider transaction ID"
                    value={providerTx[attempt.attemptId]??""}
                    disabled={!online||Boolean(busyId)}
                    onChange={e=>setProviderTx(v=>({
                      ...v,[attempt.attemptId]:e.target.value,
                    }))}/>
                </>:null}
                <GatewayHostedTestCheckout
                  businessId={businessId} attemptId={attempt.attemptId}
                  provider={attempt.providerCode}
                  checkout={attempt.sandboxCheckout} online={online}
                  disabled={Boolean(busyId)}
                  onChanged={()=>setRevision(v=>v+1)}/>
                <Button type="button" variant="outline"
                  loading={busyId===attempt.attemptId}
                  disabled={!online||Boolean(busyId)}
                  onClick={()=>void verify(attempt)}>Check provider TEST status</Button>
              </>:null}
              {attempt.state==="PREPARED"?<>
                <Button type="button" variant="outline"
                  disabled={!online||Boolean(busyId)}
                  onClick={()=>void close(attempt,"REVIEW_REQUIRED")}>Flag for review</Button>
                {!attempt.sandboxCheckout?<Button type="button" variant="outline"
                  disabled={!online||Boolean(busyId)}
                  onClick={()=>void close(attempt,"CANCELLED")}>Cancel TEST attempt</Button>:null}
              </>:null}
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>:<p>No test payment attempts recorded yet.</p>}
    <p className="tos-callout">{data.notice}</p></>:null}
  </section>;
}
