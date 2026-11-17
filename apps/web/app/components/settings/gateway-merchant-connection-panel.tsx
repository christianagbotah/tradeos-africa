"use client";

import {useEffect,useState} from "react";
import {Button} from "../ui/button";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";

type Env="TEST"|"LIVE";
type ProviderField={id:string;label:string;required:boolean;secret:boolean;hint?:string};
type Schema={providerCode:string;fields:ProviderField[];
  canVerifyConnection:boolean;verificationRequiresLiveKey:boolean};
type Connection={providerCode:string;environment:Env;accountReference:string|null;
  status:"SAVED_UNVERIFIED"|"VERIFIED"|"REVOKED";revision:number;
  collectionEnabled:false;verifiedAt:string|null;activationRequestedAt:string|null};
type Snapshot={businessId:string;vaultReady:boolean;
  schemas:Schema[];connections:Connection[];collectionEnabled:false;notice:string};

export function GatewayMerchantConnectionPanel({businessId,providerCode,online}:{
  businessId:string;providerCode:string;online:boolean;
}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [environment,setEnvironment]=useState<Env>("LIVE");
  const [values,setValues]=useState<Record<string,string>>({});
  const [password,setPassword]=useState("");
  const [showSecret,setShowSecret]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const schema=snapshot?.schemas.find(x=>x.providerCode===providerCode);
  const current=snapshot?.connections.find(x=>
    x.providerCode===providerCode&&x.environment===environment);

  useEffect(()=>{
    setSnapshot(null);setValues({});setPassword("");setError(null);setMessage(null);
    if(!online){setLoading(false);return;}
    let active=true;setLoading(true);
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+
      "/payment-gateways/merchant-connections").then(async response=>{
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const data=await response.json() as Snapshot;
      if(data.businessId!==businessId||data.collectionEnabled!==false)
        throw new Error("Merchant payment settings do not match this business.");
      if(active)setSnapshot(data);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:
      "Merchant credentials could not be loaded.");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,online,refresh]);
  useEffect(()=>{
    setValues({});setPassword("");setShowSecret({});
    setError(null);setMessage(null);
  },[providerCode,environment]);

  async function perform(action:"save"|"verify"|"request"|"revoke"){
    if(busy||!online||!snapshot||!schema||!password)return;
    if(action==="save"&&(!snapshot.vaultReady||
      schema.fields.some(f=>f.required&&!values[f.id]?.trim())))return;
    if(action==="verify"&&(providerCode!=="HUBTEL"||environment!=="LIVE"||
      current?.status!=="SAVED_UNVERIFIED"))return;
    if(action==="request"&&(current?.status!=="VERIFIED"||
      current.activationRequestedAt))return;
    if(action==="revoke"&&(!current||current.status==="REVOKED"||
      !window.confirm("Revoke these provider credentials? Existing payments still "+
        "require reconciliation with their original provider.")))return;
    const base="/v1/businesses/"+encodeURIComponent(businessId)+
      "/payment-gateways/merchant-connections";
    const credentialPath=base+"/"+providerCode+"/"+environment;
    const url=action==="verify"?base+"/HUBTEL/verify":
      action==="request"?credentialPath+"/request-activation":credentialPath;
    const fields=Object.fromEntries(Object.entries(values)
      .filter(([,v])=>v.trim().length>0).map(([k,v])=>[k,v.trim()]));
    setBusy(true);setError(null);setMessage(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(url,{
        method:action==="save"?"PUT":action==="revoke"?"DELETE":"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          expectedRevision:current?.revision??0,currentPassword:password,
          ...(action==="verify"?{environment}:
            action==="save"?{fields}:{}),
        }),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(
        response,"Provider configuration could not be updated"));
      const result=await response.json() as {connection?:Connection};
      if(!result.connection)throw new Error("Incomplete provider response.");
      setValues({});setPassword("");
      setMessage(action==="save"?
        "Merchant credentials saved securely. Verify the account before activation.":
        action==="verify"?
          "Hubtel collection-account access verified. No customer was charged.":
        action==="request"?
          "Activation request recorded. Collections remain disabled until "+
          "the payment and settlement checks have been approved.":
          "Credentials revoked; new collections remain disabled.");
      setRefresh(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:
      "Could not update this connection.");}
    finally{setBusy(false);setValues({});setPassword("");}
  }

  return <section aria-label="Merchant payment provider API credentials"
    style={{border:"1px solid var(--tos-color-border,#cbd5e1)",
      borderRadius:12,padding:16,display:"grid",gap:12,maxWidth:760,minWidth:0}}>
    <div>
      <h3>Connect & activate your merchant account</h3>
      <p>Enter the credentials issued to your own business. They are
        encrypted server-side and never shown again after saving.</p>
    </div>
    {!online?<p className="tos-callout">Go online to manage API credentials.</p>:null}
    {loading?<p role="status">Loading secure provider connection…</p>:null}
    {error?<p className="tos-banner tos-banner--danger" role="alert">{error}</p>:null}
    {snapshot&&schema?<div style={{display:"grid",gap:12,minWidth:0}}>
      {!snapshot.vaultReady?<p className="tos-callout" role="alert">
        Secure key storage is not configured on this server.
        The credential form is disabled until the platform vault is ready.</p>:null}
      <label htmlFor="merchant-gateway-environment">Credentials environment</label>
      <select className="tos-input" id="merchant-gateway-environment"
        value={environment} disabled={!online||busy}
        onChange={e=>setEnvironment(e.target.value as Env)}>
        <option value="LIVE">LIVE — production merchant account</option>
        <option value="TEST">TEST — provider sandbox account</option>
      </select>
      <p>Status: <strong>{!current?"No credentials saved":
        current.status==="REVOKED"?"Revoked":
        current.status==="VERIFIED"?"Account access verified":
          "Saved — verification required"}</strong>.
        {current?.activationRequestedAt?
          " Activation requested — awaiting approval.":""}
        {" "}Real collections: <strong>Disabled</strong>.</p>
      {current?.accountReference?<p>Hubtel Collection Account:
        <strong>{" "+current.accountReference}</strong></p>:null}
      {schema.fields.map(field=><div key={field.id}
        style={{display:"grid",gap:6,minWidth:0}}>
        <label htmlFor={"merchant-gateway-"+field.id}>
          {field.label}{field.required?" *":""}</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",minWidth:0}}>
          <input className="tos-input" style={{flex:"1 1 220px",minWidth:0}}
            id={"merchant-gateway-"+field.id}
            type={field.secret&&!showSecret[field.id]?"password":"text"}
            autoComplete="off" maxLength={512}
            placeholder={field.secret?"Paste from your provider portal":
              field.hint??"Enter "+field.label}
            value={values[field.id]??""}
            disabled={!online||busy||!snapshot.vaultReady}
            onChange={e=>setValues(old=>({...old,[field.id]:e.target.value}))}/>
          {field.secret?<Button type="button" variant="outline"
            onClick={()=>setShowSecret(old=>({...old,
              [field.id]:!old[field.id]}))}>
            {showSecret[field.id]?"Hide":"Show"}</Button>:null}
        </div>
        {field.hint?<small>{field.hint}</small>:null}
      </div>)}
      <label htmlFor="merchant-gateway-confirm-password">Current TradeOS password
        (authorize this sensitive change)</label>
      <input className="tos-input" id="merchant-gateway-confirm-password"
        type="password" autoComplete="current-password"
        value={password} maxLength={200}
        disabled={!online||busy}
        onChange={e=>setPassword(e.target.value)}/>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Button type="button" variant="primary" loading={busy}
          disabled={!online||busy||!snapshot.vaultReady||!password||
            schema.fields.some(f=>f.required&&!values[f.id]?.trim())}
          onClick={()=>void perform("save")}>Save credentials</Button>
        {providerCode==="HUBTEL"&&environment==="LIVE"?
          <Button type="button" variant="outline"
            disabled={!online||busy||!password||current?.status!=="SAVED_UNVERIFIED"}
            onClick={()=>void perform("verify")}>
            Verify Hubtel account (no charge)</Button>:null}
        <Button type="button" variant="outline"
          disabled={!online||busy||!password||current?.status!=="VERIFIED"||
            Boolean(current?.activationRequestedAt)}
          onClick={()=>void perform("request")}>Request activation</Button>
        <Button type="button" variant="outline"
          disabled={!online||busy||!password||!current||current.status==="REVOKED"}
          onClick={()=>void perform("revoke")}>Revoke credentials</Button>
        <Button type="button" variant="outline"
          disabled={busy||!online} onClick={()=>setRefresh(x=>x+1)}>
          Refresh status</Button>
      </div>
      {message?<p role="status" className="tos-callout">{message}</p>:null}
      <p className="tos-callout">{snapshot.notice}</p>
      {providerCode==="HUBTEL"?<p className="tos-callout">
        Hubtel Payment API ID + API Key + Collection Account Number are needed
        to accept sales. Disbursement Account is separate for payouts.
        Hubtel SMS uses separate credentials under SMS & messaging.
        A successful account check verifies read-only collection access;
        it is not permission to charge customers.</p>:null}
    </div>:null}
  </section>;
}
