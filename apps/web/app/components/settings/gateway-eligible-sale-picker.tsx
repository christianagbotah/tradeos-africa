"use client";
import {useEffect,useState} from "react";
import {formatMoney} from "@tradeos/contracts";
import {MoneyValue} from "../business/money-value";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";

type Sale={
  saleId:string;branchId:string;branchName:string;openedAt:string;
  amountMinor:string;currencyCode:string;paymentMethod:"MOMO"|"CARD";
};
type Eligible={
  businessId:string;providerCode:string;ready:boolean;
  reason:string|null;eligibleSales:Sale[];collectionEnabled:false;
};
function readiness(reason:string|null,provider:string){
  if(reason==="SELECT_PAYSTACK_OR_FLUTTERWAVE")
    return "Choose Paystack or Flutterwave in your payment settings to begin.";
  if(reason==="GATEWAY_NOT_SUPPORTED_FOR_MARKET")
    return "Your selected gateway is unavailable for this business country and currency.";
  if(reason==="SAVE_MERCHANT_TEST_KEY")
    return "Save your merchant's TEST API key before preparing a sandbox payment.";
  return "No eligible sales are available for the selected gateway.";
}
export function GatewayEligibleSalePicker({businessId,online,revision,value,
  onChange}:{businessId:string;online:boolean;revision:number;
  value:string;onChange:(next:string)=>void;
}){
  const [data,setData]=useState<Eligible|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    setData(null);setError(null);
    if(!online){setLoading(false);return;}
    setLoading(true);
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+
      "/payment-gateways/eligible-test-sales?limit=40"
    ).then(async response=>{
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const payload=await response.json() as Eligible;
      if(payload.businessId!==businessId||payload.collectionEnabled!==false)
        throw new Error("Unexpected merchant TEST sale response.");
      if(active)setData(payload);
    }).catch(e=>{
      if(active)setError(e instanceof Error?e.message:
        "Eligible pending sales cannot be loaded.");
    }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,online,revision]);

  const selected=data?.eligibleSales.find(s=>s.saleId===value)??null;
  return <div style={{display:"grid",gap:9}}>
    <label htmlFor="gateway-test-eligible-sale">Choose an eligible pending sale</label>
    <select id="gateway-test-eligible-sale" className="tos-input"
      value={selected?.saleId??""}
      disabled={!online||loading||!data?.ready||!data.eligibleSales.length}
      onChange={e=>onChange(e.target.value)}
      style={{width:"100%",maxWidth:700,cursor:"pointer"}}>
      <option value="">Select a sale to test with your gateway</option>
      {data?.eligibleSales.map(s=>{
        const amount=Number(s.amountMinor);
        return <option key={s.saleId} value={s.saleId}>
          {s.branchName} · {s.paymentMethod} · {
            Number.isSafeInteger(amount)?
              formatMoney(amount,s.currencyCode):
              s.currencyCode+" "+s.amountMinor
          } · {s.saleId.slice(0,8).toUpperCase()}
        </option>;
      })}
    </select>
    {selected?<div role="status" style={{display:"flex",alignItems:"center",
      gap:12,flexWrap:"wrap",padding:11,borderRadius:9,
      border:"1px solid #aabaca"}}>
      <strong>{selected.branchName}</strong>
      <MoneyValue minor={Number(selected.amountMinor)}
        currencyCode={selected.currencyCode}/>
      <span>{selected.paymentMethod==="MOMO"?"Mobile money":"Card"} payment</span>
      <small>Opened {new Date(selected.openedAt).toLocaleString("en-GB")}</small>
    </div>:null}
    {loading?<p role="status">Finding eligible pending sales…</p>:null}
    {!online?<p role="status">Connect to select a verified pending sale.</p>:null}
    {error?<p role="alert">{error}</p>:null}
    {data&&!data.ready?<p role="status">{readiness(data.reason,data.providerCode)}</p>:null}
    {data?.ready&&!data.eligibleSales.length?
      <p role="status">No eligible pending electronic sales yet. A sale needs
        exactly one pending MoMo or card payment, must remain open and must
        not have an existing provider checkout.</p>:null}
    {data?.ready&&data.eligibleSales.length?
      <small>Showing up to 40 most recent eligible pending sales.
        Selection does not charge the customer; the server revalidates the
        sale before preparing a TEST attempt.</small>:null}
  </div>;
}
