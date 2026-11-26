"use client";

import { useCallback,useEffect,useState } from "react";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { Button } from "../ui/button";
import { notifyAction } from "../ui/action-feedback";

type Checkout={saleId:string;attemptId:string;state:string;
  checkoutUrl:string|null;amountMinor:number};
type Readiness={businessId:string;enabled:boolean;
  existingCheckoutEnabled?:boolean;preferredProvider?:string;notice:string};
type Verification={state:"PAID"|"UNPAID"|"REFUND_REVIEW";verifiedAt:string};
type Props={businessId:string;saleId:string;online:boolean;onPaid:()=>void};

export function HubtelSaleActions({businessId,saleId,online,onPaid}:Props){
  const [readiness,setReadiness]=useState<Readiness|null>(null);
  const [checkout,setCheckout]=useState<Checkout|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const load=useCallback(async()=>{
    if(!online)return;
    const q=getOfflineQueue();
    const [ready,found]=await Promise.all([
      q.authenticatedFetch("/v1/payments/hubtel/readiness?businessId="+
        encodeURIComponent(businessId)),
      q.authenticatedFetch("/v1/sales/"+encodeURIComponent(saleId)+
        "/hubtel/checkout?businessId="+encodeURIComponent(businessId)),
    ]);
    if(!ready.ok)throw new Error(await readApiErrorMessage(ready));
    if(!found.ok)throw new Error(await readApiErrorMessage(found));
    setReadiness(await ready.json() as Readiness);
    const data=await found.json() as {checkout:Checkout|null};
    if(data.checkout && data.checkout.saleId!==saleId)throw new Error("Sale checkout mismatch.");
    setCheckout(data.checkout);
  },[businessId,saleId,online]);
  useEffect(()=>{
    let disposed=false;
    void load().catch(e=>{if(!disposed)setError(e instanceof Error?e.message:"Cannot load checkout.");});
    return()=>{disposed=true;};
  },[load]);
  async function send(path:string,payload:object){
    const response=await getOfflineQueue().authenticatedFetch(path,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(payload),
    });
    if(!response.ok)throw new Error(await readApiErrorMessage(response));
    return response.json() as Promise<unknown>;
  }
  function openTrustedCheckout(url:string|null){
    if(!url)throw new Error("Hubtel checkout link is not ready.");
    const parsed=new URL(url);
    if(parsed.protocol!=="https:"||parsed.hostname!=="pay.hubtel.com"||
       parsed.port||parsed.username||parsed.password||parsed.hash) {
      throw new Error("Untrusted Hubtel payment destination.");
    }
    window.location.assign(parsed.toString());
  }
  async function start(){
    if(busy||!online)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const existing=checkout;
      if(existing?.checkoutUrl){openTrustedCheckout(existing.checkoutUrl);return;}
      const data=await send("/v1/sales/"+encodeURIComponent(saleId)+"/hubtel/checkout",{
        businessId,clientRequestId:crypto.randomUUID(),
      }) as {checkout:Checkout};
      if(data.checkout?.saleId!==saleId)throw new Error("Provider checkout is for a different sale.");
      setCheckout(data.checkout);
      openTrustedCheckout(data.checkout.checkoutUrl);
    }catch(e){setError(e instanceof Error?e.message:"Cannot start checkout.");}
    finally{setBusy(false);}
  }
  async function verify(){
    if(busy||!online||!checkout)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const data=await send("/v1/sales/"+encodeURIComponent(saleId)+"/hubtel/verify",
        {businessId}) as {result:Verification};
      if(data.result.state==="PAID"){
        setMessage("Hubtel independently confirmed payment. The sale receipt is now finalized.");
        notifyAction({tone:"success",title:"Payment verified",
          message:"Hubtel independently confirmed payment. The sale receipt is now finalized."});
        onPaid();
      }else if(data.result.state==="UNPAID"){
        setMessage("Payment is not confirmed. The sale remains pending.");
        notifyAction({tone:"warning",title:"Payment still pending",
          message:"Payment is not confirmed. The sale remains pending; do not issue a receipt."});
      }else{
        setMessage("Hubtel reports a refund. Contact the billing team for reconciliation.");
        notifyAction({tone:"warning",title:"Refund requires review",
          message:"Hubtel reports a refund. Contact the billing team for reconciliation."});
      }
      await load();
    }catch(e){
      const message=e instanceof Error?e.message:"Cannot verify payment.";
      setError(message);notifyAction({tone:"error",message});
    }
    finally{setBusy(false);}
  }
  return <div className="tos-section">
    <div className="tos-section__head">
      <h3 className="tos-section__title">Hubtel payment pending</h3>
    </div>
    <div className="tos-section__body--padded tos-stack">
      <p role="status">This order has not been paid. Do not issue a final receipt or release goods until the provider payment is verified.</p>
      {!online?<p>Go online to verify or resume this payment.</p>:null}
      {readiness && !readiness.enabled?<p>{readiness.notice}</p>:null}
      {(readiness?.enabled||(readiness?.existingCheckoutEnabled&&checkout))?
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {readiness?.enabled && (!checkout ||
          (["READY","PENDING_VERIFICATION"].includes(checkout.state) && checkout.checkoutUrl)) ?
          <Button variant="gold" disabled={busy||!online}
            onClick={()=>void start()}>{checkout?.checkoutUrl?"Open Hubtel checkout":"Create Hubtel checkout"}</Button>
          : null}
        {readiness?.existingCheckoutEnabled && checkout &&
          ["READY","PENDING_VERIFICATION","REVIEW_REQUIRED"].includes(checkout.state)?
          <Button variant="outline" disabled={busy||!online} onClick={()=>void verify()}>
            {busy?"Checking…":"Verify payment"}
          </Button>:null}
      </div>:null}
      {message?<p role="status">{message}</p>:null}
      {error?<p role="alert">{error}</p>:null}
    </div>
  </div>;
}
