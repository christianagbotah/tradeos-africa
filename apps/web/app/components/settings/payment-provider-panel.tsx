"use client";

import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";
import {useWorkspace} from "../workspace/use-workspace";
import {GatewayMerchantConnectionPanel} from "./gateway-merchant-connection-panel";
import {GatewayAttemptMonitor} from "./gateway-attempt-monitor";

type Provider={
  code:string;name:string;description:string;region:string;
  methods:string[];eligible:boolean;
  integrationStage:"EXISTING_GATED"|"PLANNED";docsUrl:string;notice:string;
};
type Snapshot={
  businessId:string;countryCode:string;currencyCode:string;
  preferredProvider:string|null;effectiveLegacyProvider:string|null;
  revision:number;updatedAt:string|null;collectionReady:boolean;
  notice:string;providers:Provider[];
};
const CAN_MANAGE=new Set(["OWNER","ADMIN"]);

export function PaymentProviderPanel(){
  const {session,role,queue}=useWorkspace();
  const businessId=session?.businessId??null;
  const online=queue.online;
  const canManage=CAN_MANAGE.has(role??"");
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [choice,setChoice]=useState<string>("");
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [refreshKey,setRefreshKey]=useState(0);

  useEffect(()=>{
    setSnapshot(null);setChoice("");setError(null);
    if(!businessId||!online){setLoading(false);return;}
    let active=true;
    setLoading(true);
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+"/payment-gateways"
    ).then(async response=>{
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const data=await response.json() as Snapshot;
      if(data.businessId!==businessId)throw new Error(
        "Payment settings do not match the selected business.");
      if(active){
        setSnapshot(data);
        setChoice(data.preferredProvider??data.effectiveLegacyProvider??
          (data.countryCode==="GH"&&data.currencyCode==="GHS"?"HUBTEL":""));
      }
    }).catch(e=>{
      if(active)setError(e instanceof Error?e.message:"Payment options cannot be loaded.");
    }).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,online,refreshKey]);

  async function save(){
    if(!businessId||!snapshot||!online||!canManage||saving)return;
    const provider=snapshot.providers.find(x=>x.code===choice);
    if(!provider?.eligible){setError("This provider is not listed for your business location and currency.");return;}
    setSaving(true);setError(null);setSuccess(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        "/v1/businesses/"+encodeURIComponent(businessId)+"/payment-gateways/preference",{
          method:"PUT",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({providerCode:choice,expectedRevision:snapshot.revision}),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      setSuccess("Preferred provider saved. This does not activate collection. "+
        "Your merchant account and payment verification must still be approved.");
      setRefreshKey(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"Could not save the provider preference.");}
    finally{setSaving(false);}
  }

  if(!session)return null;
  const current=snapshot?.preferredProvider??snapshot?.effectiveLegacyProvider;
  const selected=snapshot?.providers.find(x=>x.code===choice);
  return (
    <section className="tos-settings__panel" aria-label="Payment providers"
      style={{display:"grid",gap:20}}>
      <div style={{display:"flex",gap:12,alignItems:"start",justifyContent:"space-between",
        flexWrap:"wrap"}}>
        <div>
          <p className="tos-settings__eyebrow">PAYMENTS AND COLLECTIONS</p>
          <h2>Payment providers</h2>
          <p>Choose how this business would like to accept electronic payments.
            Cash works independently of any payment service.</p>
        </div>
        <Button type="button" variant="outline"
          onClick={()=>setRefreshKey(v=>v+1)} disabled={!online||loading||saving}>
          Refresh
        </Button>
      </div>
      {!online?<p className="tos-callout" role="status">
        You are offline. Payment provider settings require an online connection.
        Existing offline cash sales are unaffected.
      </p>:null}
      {loading?<p role="status">Checking supported gateways for your business…</p>:null}
      {error?<p className="tos-banner tos-banner--danger" role="alert">{error}</p>:null}
      {snapshot?<><p className="tos-callout" role="status">
        Registered country: <strong>{snapshot.countryCode}</strong> · Currency:
        <strong> {snapshot.currencyCode}</strong>. Availability refers to your
        business registration, not where a cardholder happens to live.
        Changing currency or country may change your available providers.
      </p>
      <p className="tos-callout" role="status">
        Current collection status: <strong>{snapshot.collectionReady?
          "Verified merchant connection enabled":"Not enabled"}</strong>.
        Your preferred provider is a separate configuration choice.
      </p>
      <div style={{display:"grid",gap:12,maxWidth:720,minWidth:0}}>
        <label htmlFor="tradeos-selected-payment-provider">
          Choose payment provider</label>
        <select id="tradeos-selected-payment-provider" className="tos-input"
          value={choice} disabled={!online||!canManage||saving}
          onChange={e=>{setChoice(e.target.value);setError(null);
            setSuccess(null);}}>
          <option value="" disabled>Select payment provider</option>
          {snapshot.providers.map(provider=>(
            <option key={provider.code} value={provider.code}
              disabled={!provider.eligible}>
              {provider.name}{provider.eligible?"":" (not available for this market)"}
            </option>
          ))}
        </select>
        {selected?<div style={{display:"grid",gap:8,padding:14,
          border:"1px solid var(--tos-color-border, #cbd5e1)",borderRadius:12}}>
          <strong>{selected.name}</strong>
          <p style={{margin:0}}>{selected.description}</p>
          <p style={{margin:0}}>Regions: {selected.region} · Methods:
            {" "+selected.methods.join(" · ")}</p>
          <p style={{margin:0}}>Connection:
            <strong>{" "+(selected.integrationStage==="PLANNED"?
              "Planned / gated":"Existing gated integration")}</strong></p>
          {selected.code==="HUBTEL"?<div className="tos-callout tos-callout--label-and-content"
            style={{margin:0}}>
            <strong className="tos-callout__label">Hubtel Online Checkout is integrated.</strong>
            <p className="tos-callout__content">Connect your Payment API ID, API Key
              and Collection Account in the secure form below. Once authorized,
              the POS creates a hosted Hubtel checkout link for Mobile Money or
              card payments. The checkout redirect and callback alone never
              mark a sale paid: TradeOS verifies it directly through Hubtel
              Transaction Status before posting a receipt.</p>
          </div>:<a href={selected.docsUrl} target="_blank" rel="noopener noreferrer">
            View provider setup instructions</a>}
        </div>:null}
      </div>
      {selected&&canManage&&businessId?
        <GatewayMerchantConnectionPanel key={businessId+selected.code}
          businessId={businessId} online={online}
          providerCode={selected.code}/>:null}
      {!canManage?<p className="tos-callout">
        Only the owner or a business administrator may change its preferred gateway.
      </p>:null}
      {selected&&!selected.eligible?<p className="tos-callout" role="alert">
        This provider is not currently listed for your business country and currency.
      </p>:null}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
        <Button type="button" variant="primary" onClick={()=>void save()}
          loading={saving} disabled={!canManage||!online||!selected?.eligible||
            loading||choice===current}>Save preferred provider</Button>
        <span style={{fontSize:13}}>
          {current?"Current preference: "+(snapshot.providers.find(x=>x.code===current)?.name??current):
            "No preference saved"}
        </span>
      </div>
      {success?<p className="tos-callout" role="status">{success}</p>:null}

      {canManage&&businessId?<GatewayAttemptMonitor
        businessId={businessId} online={online}/>:null}
      <div className="tos-callout tos-callout--label-and-content" role="status">
        <strong className="tos-callout__label">Payment security:</strong>
        <p className="tos-callout__content">{snapshot.notice} Provider API keys,
          webhook secrets and merchant verification must be handled through
          a secure connection process. Never enter a secret in an ordinary text field
          or send it in chat. Existing outstanding payments remain tied to
          the provider that originally created them.</p>
      </div></>:null}
    </section>
  );
}
