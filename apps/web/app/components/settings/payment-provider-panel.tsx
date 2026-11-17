"use client";

import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";
import {useWorkspace} from "../workspace/use-workspace";
import {GatewayConnectionsPanel} from "./gateway-connections-panel";
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
        setChoice(data.preferredProvider??data.effectiveLegacyProvider??"");
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
      <div style={{display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,255px),1fr))",
        gap:12}} role="group" aria-label="Choose payment provider">
        {snapshot.providers.map(provider=>(
          <div key={provider.code} style={{
            border:choice===provider.code?"2px solid var(--tos-color-primary, #176785)":
              "1px solid var(--tos-color-border, #cbd5e1)",
            borderRadius:12,padding:14,display:"grid",gap:8,minWidth:0}}>
            <div style={{display:"flex",gap:8,justifyContent:"space-between",
              alignItems:"center",flexWrap:"wrap"}}>
              <strong style={{fontSize:17}}>{provider.name}</strong>
              <span style={{fontSize:12,fontWeight:700}}>
                {provider.code===current?"Selected":!provider.eligible?
                  "Not listed for this market":"Available to request"}
              </span>
            </div>
            <p style={{fontSize:13,margin:0}}>{provider.region}</p>
            <p style={{fontSize:13,margin:0}}>{provider.description}</p>
            <p style={{fontSize:12,margin:0}}>
              Methods: {provider.methods.join(" · ")}
            </p>
            {provider.integrationStage==="PLANNED"?
              <p style={{fontSize:12,margin:0}}>
                Integration in development. Selecting it reserves your preference
                but does not yet allow charging customers.
              </p>:<p style={{fontSize:12,margin:0}}>
                Existing provider connector; merchant authorization and verification required.
              </p>}
            <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer"
              style={{fontSize:13}}>Provider documentation</a>
            <button type="button" className="tos-pay-card"
              style={{width:"100%",minHeight:42,justifyContent:"center",cursor:
                canManage&&online&&provider.eligible?"pointer":"not-allowed"}}
              aria-pressed={choice===provider.code}
              disabled={!provider.eligible||!online||!canManage||saving}
              onClick={()=>{setChoice(provider.code);setError(null);setSuccess(null);}}>
              {choice===provider.code?"Chosen":"Choose "+provider.name}
            </button>
          </div>
        ))}
      </div>
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
      {canManage&&businessId?<GatewayConnectionsPanel
        businessId={businessId} online={online}/>:null}
      {canManage&&businessId?<GatewayAttemptMonitor
        businessId={businessId} online={online}/>:null}
      <p className="tos-callout" role="status">
        <strong>Payment security:</strong> {snapshot.notice} Provider API keys,
        webhook secrets and merchant verification must be handled through
        a secure connection process. Never enter a secret in an ordinary text field
        or send it in chat. Existing outstanding payments remain tied to
        the provider that originally created them.
      </p></>:null}
    </section>
  );
}
