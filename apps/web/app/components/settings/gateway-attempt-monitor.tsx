"use client";

import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";
import {MoneyValue} from "../business/money-value";

type Attempt={
  attemptId:string;saleId:string;branchId:string;providerCode:string;
  environment:"TEST";clientReference:string;expectedAmountMinor:string;
  currencyCode:string;paymentMethod:string;state:string;createdAt:string;
  sandboxEvidence:{status:"TEST_PAID_OBSERVED"|"TEST_UNPAID_OBSERVED";
    observedAt:string;posted:false}|null;
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
        <p>Tenant-scoped TEST attempts and review queue. Preparation
          is not proof of collection.</p>
      </div>
      <Button type="button" variant="outline"
        disabled={!online||loading}
        onClick={()=>setRevision(n=>n+1)}>Refresh</Button>
    </div>
    {!online?<p role="status">Connect to view the verified server audit.</p>:null}
    {loading?<p role="status">Loading payment attempt records…</p>:null}
    {error?<p role="alert" className="tos-banner tos-banner--danger">{error}</p>:null}
    {data?<><div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
      <span>Prepared: <strong>{data.summary.prepared}</strong></span>
      <span>Cancelled: <strong>{data.summary.cancelled}</strong></span>
      <span>Review required: <strong>{data.summary.reviewRequired}</strong></span>
    </div>
    {data.attempts.length?<div style={{maxWidth:"100%",overflowX:"auto"}}>
      <table style={{width:"100%",fontSize:13}}>
        <thead><tr><th>When</th><th>Gateway</th><th>Method</th>
          <th>Amount</th><th>State</th><th>Sandbox observation</th><th>Reference</th></tr></thead>
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
          </tr>
        ))}</tbody>
      </table>
    </div>:<p>No test payment attempts recorded yet.</p>}
    <p className="tos-callout">{data.notice}</p></>:null}
  </section>;
}
