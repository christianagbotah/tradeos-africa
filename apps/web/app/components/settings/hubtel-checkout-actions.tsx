"use client";
import { useEffect,useRef,useState } from "react";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { notifyAction } from "../ui/action-feedback";

type Checkout={id:string;businessId:string;invoiceId:string;clientRequestId:string;
  checkoutUrl:string|null;state:string};
type Result={state:string;status:string;verifiedAt:string};
export function HubtelCheckoutActions({
  businessId,invoiceId,online,onReconciled,
}:{businessId:string;invoiceId:string;online:boolean;onReconciled:()=>void}) {
  const [busy,setBusy]=useState(false);
  const [attemptId,setAttemptId]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const requestRef=useRef<string|null>(null);
  const storageKey="tradeos.hubtel.subscription.v1."+businessId+"."+invoiceId;
  useEffect(()=>{
    try{
      const saved=JSON.parse(window.sessionStorage.getItem(storageKey)??"null") as
        {requestId?:string;attemptId?:string}|null;
      requestRef.current=saved?.requestId??null;
      setAttemptId(saved?.attemptId??null);
    }catch{requestRef.current=null;setAttemptId(null);}
    setNotice(null);
  },[storageKey]);
  async function pay(){
    if(busy||!online)return;
    setBusy(true);setNotice(null);
    try{
      const clientRequestId=requestRef.current??crypto.randomUUID();
      requestRef.current=clientRequestId;
      // Persist the same key BEFORE any provider-facing operation. A retry
      // must not accidentally create a second checkout after navigation loss.
      try{window.sessionStorage.setItem(storageKey,JSON.stringify({requestId:clientRequestId}));}
      catch{/* storage may be unavailable in private browsing */}
      const response=await getOfflineQueue().authenticatedFetch("/v1/billing/hubtel/checkout",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({businessId,invoiceId,clientRequestId}),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const {checkout}=await response.json() as {checkout:Checkout};
      if(checkout.businessId!==businessId||checkout.invoiceId!==invoiceId||
         !checkout.checkoutUrl)throw new Error("The checkout link did not match this invoice.");
      const url=new URL(checkout.checkoutUrl);
      if(url.protocol!=="https:"||url.hostname!=="pay.hubtel.com"||
         url.username||url.password||url.port) {
        throw new Error("Untrusted payment destination. No redirect was opened.");
      }
      setAttemptId(checkout.id);
      try{window.sessionStorage.setItem(storageKey,JSON.stringify({
        requestId:clientRequestId,attemptId:checkout.id,
      }));}catch{/* storage may be unavailable in private browsing */}
      // A redirect is NOT evidence of payment.
      window.location.assign(url.toString());
    }catch(error){
      const message=error instanceof Error?error.message:"Checkout could not start.";
      setNotice(message);notifyAction({tone:"error",message});
    }finally{setBusy(false);}
  }
  async function verify(){
    if(busy||!online||!attemptId)return;
    setBusy(true);setNotice(null);
    try{
      const res=await getOfflineQueue().authenticatedFetch(
        "/v1/billing/hubtel/checkout/"+encodeURIComponent(attemptId)+"/verify",{
          method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({businessId}),
        });
      if(!res.ok)throw new Error(await readApiErrorMessage(res));
      const {result}=await res.json() as {result:Result};
      if(result.state==="RECONCILED"&&result.status==="PAID"){
        setNotice("Hubtel verified this subscription payment. Billing records refreshed.");
        notifyAction({tone:"success",title:"Subscription payment verified",
          message:"Hubtel verified this subscription payment. Billing records refreshed."});
        onReconciled();
      }else if(result.state==="REQUIRES_REFUND_RECONCILIATION"){
        setNotice("Hubtel reports a refund. Contact billing support for reconciliation.");
        notifyAction({tone:"warning",title:"Refund requires review",
          message:"Hubtel reports a refund. Contact billing support for reconciliation."});
      }else{
        setNotice("Payment is not confirmed yet. Retry verification after a few minutes.");
        notifyAction({tone:"warning",title:"Payment not yet verified",
          message:"Payment is not confirmed. Do not treat the invoice as paid."});
      }
    }catch(error){
      const message=error instanceof Error?error.message:"Verification is unavailable.";
      setNotice(message);notifyAction({tone:"error",message});
    }finally{setBusy(false);}
  }
  return <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
    <button type="button" disabled={busy||!online} onClick={()=>void pay()}
      style={{cursor:"pointer",border:"1px solid #b8c5d6",borderRadius:8,padding:"7px 11px"}}>
      {busy?"Processing…":"Pay with Hubtel"}
    </button>
    {attemptId?<button type="button" disabled={busy||!online} onClick={()=>void verify()}
      style={{cursor:"pointer",border:"1px solid #b8c5d6",borderRadius:8,padding:"7px 11px"}}>
      Verify payment
    </button>:null}
    {notice?<span role="status" style={{fontSize:12,maxWidth:230,whiteSpace:"normal"}}>{notice}</span>:null}
  </div>;
}
