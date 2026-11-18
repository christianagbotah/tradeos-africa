"use client";
import {useState} from "react";
import {Button} from "../ui/button";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";

type Hosted={
  state:"INITIATING"|"READY"|"OUTCOME_UNKNOWN";
  checkoutUrl:string|null;environment:"TEST";charged:false;settled:false;
};
export function GatewayHostedTestCheckout({businessId,attemptId,provider,checkout,
  online,onChanged,disabled}:{businessId:string;attemptId:string;provider:string;
  checkout:Hosted|null;online:boolean;onChanged:()=>void;disabled:boolean;
}){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  async function initiate(){
    if(!online||disabled||busy||checkout||!password||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return;
    if(!window.confirm("Create exactly one hosted TEST checkout? "+
      "This uses the original merchant TEST key, not a live key. "+
      "It never posts a TradeOS receipt or settles the real sale."))return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const url="/v1/businesses/"+encodeURIComponent(businessId)+
        "/payment-gateways/attempts/"+encodeURIComponent(attemptId)+
        "/hosted-test-checkout";
      const response=await getOfflineQueue().authenticatedFetch(url,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({customerEmail:email.trim(),currentPassword:password}),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const result=await response.json() as {
        checkout:Hosted;replayed:boolean;
      };
      if(result.checkout.environment!=="TEST"||
         result.checkout.charged!==false||result.checkout.settled!==false)
        throw new Error("Unexpected provider TEST response.");
      setMessage(result.checkout.state==="READY"?
        "Provider TEST checkout prepared. Open the link below after refreshing.":
        "Provider outcome requires manual review. Do not initiate again.");
      onChanged();
    }catch(e){
      setError(e instanceof Error?e.message:"Could not initiate TEST checkout.");
    }finally{
      setBusy(false);setPassword("");
    }
  }
  return <div style={{display:"grid",gap:8,padding:9,
    border:"1px dashed #aab6c8",borderRadius:8,minWidth:180}}>
    <strong>{provider} hosted TEST checkout</strong>
    {checkout?.state==="READY"&&checkout.checkoutUrl?
      <a target="_blank" rel="noopener noreferrer"
        href={checkout.checkoutUrl}>Open provider TEST checkout</a>:null}
    {checkout?.state==="OUTCOME_UNKNOWN"||checkout?.state==="INITIATING"?
      <small role="status">Provider outcome: {checkout.state.replaceAll("_"," ")}.
        Do not retry; investigate in the provider TEST portal.</small>:null}
    {!checkout?<>
      <small>Creates a simulated provider TEST checkout using the saved
        TEST key. No live collection or TradeOS receipt.</small>
      <label htmlFor={"hosted-email-"+attemptId}>TEST customer email</label>
      <input id={"hosted-email-"+attemptId} className="tos-input"
        type="email" autoComplete="off" maxLength={254}
        placeholder="test@example.com" value={email}
        disabled={!online||busy||disabled}
        onChange={e=>setEmail(e.target.value)}/>
      <label htmlFor={"hosted-pass-"+attemptId}>Current TradeOS password</label>
      <input id={"hosted-pass-"+attemptId} className="tos-input"
        type="password" autoComplete="current-password"
        maxLength={200} value={password}
        disabled={!online||busy||disabled}
        onChange={e=>setPassword(e.target.value)}/>
      <Button type="button" variant="outline"
        disabled={!online||busy||disabled||!email||!password}
        loading={busy} onClick={()=>void initiate()}>
        Create hosted TEST checkout</Button>
    </>:null}
    {error?<small role="alert">{error}</small>:null}
    {message?<small role="status">{message}</small>:null}
  </div>;
}
