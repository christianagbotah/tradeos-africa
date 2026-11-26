"use client";

import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";

type Status="DONE"|"NEEDS_ACTION"|"BLOCKED";
type Step={code:string;title:string;status:Status;detail:string};
type Readiness={
  businessId:string;providerCode:"HUBTEL";environment:"LIVE";
  merchantCredentialStatus:string;credentialRevision:number|null;
  accountReference:string|null;activationRequested:boolean;
  accountApproved:boolean;preferredProvider:string;
  merchantCollectionEnabled:boolean;existingLegacyCollectionEnabled:boolean;
  unsettledPayments:number;reviewRequired:number;
  untrustedNotifications:number;steps:Step[];notice:string;
};
const LABEL:Record<Status,string>={
  DONE:"Complete",NEEDS_ACTION:"Action needed",BLOCKED:"Not available yet",
};
export function HubtelMerchantActivationChecklist({businessId,online,refreshKey}:{
  businessId:string;online:boolean;refreshKey:number;
}){
  const [data,setData]=useState<Readiness|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    setData(null);setError(null);
    if(!online){setLoading(false);return;}
    let active=true;setLoading(true);
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+
      "/payment-gateways/HUBTEL/activation-readiness")
      .then(async response=>{
        if(!response.ok)throw new Error(await readApiErrorMessage(response));
        const result=await response.json() as Readiness;
        if(result.businessId!==businessId||result.providerCode!=="HUBTEL")
          throw new Error("Merchant readiness does not match this business.");
        if(active)setData(result);
      }).catch(e=>{
        if(active)setError(e instanceof Error?e.message:
          "Could not check Hubtel activation status.");
      }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,online,refreshKey,refresh]);
  return <section style={{display:"grid",gap:12,
    border:"1px solid var(--tos-color-border,#cbd5e1)",borderRadius:12,
    padding:16,minWidth:0}}
    aria-label="Hubtel collection activation checklist">
    <div style={{display:"flex",gap:8,justifyContent:"space-between",
      alignItems:"center",flexWrap:"wrap"}}>
      <div>
        <h3>Hubtel activation checklist</h3>
        <p>Follow each step to connect your own account securely.</p>
      </div>
      <Button type="button" variant="outline"
        disabled={!online||loading}
        onClick={()=>setRefresh(x=>x+1)}>Refresh checks</Button>
    </div>
    {!online?<p role="status">Connect to review current merchant status.</p>:null}
    {loading?<p role="status">Checking account readiness…</p>:null}
    {error?<p role="alert" className="tos-banner tos-banner--danger">{error}</p>:null}
    {data?<div style={{display:"grid",gap:12}}>
      <p>Merchant-owned collections: <strong>{
        data.merchantCollectionEnabled?"Enabled":"Not enabled"
      }</strong>.
        {data.existingLegacyCollectionEnabled?
          " A previously approved Hubtel connection is active separately.":""}
      </p>
      <ol style={{margin:0,paddingLeft:24,display:"grid",gap:10}}>
        {data.steps.map(step=><li key={step.code} style={{paddingLeft:4}}>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"baseline"}}>
            <strong>{step.title}</strong>
            <span style={{fontSize:13}}>{LABEL[step.status]}</span>
          </div>
          <p style={{margin:"3px 0 0"}}>{step.detail}</p>
        </li>)}
      </ol>
      {(data.unsettledPayments>0||data.reviewRequired>0)?
        <p>Earlier Hubtel payments awaiting reconciliation: <strong>{
          data.unsettledPayments}</strong>.
          {" "}Needing manual review: <strong>{data.reviewRequired}</strong>.
          Those payments remain tied to their original merchant account.</p>:null}
      {data.untrustedNotifications>0?<p className="tos-callout">
        Hubtel callback notifications captured: <strong>{
          data.untrustedNotifications}</strong>. These are untrusted claims;
          even a success notification is not payment confirmation. TradeOS
          must verify the original transaction directly with Hubtel.
      </p>:null}
      <p className="tos-callout">{data.notice}</p>
    </div>:null}
  </section>;
}
