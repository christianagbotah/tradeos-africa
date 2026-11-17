"use client";
import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";

type Provider="PAYSTACK"|"FLUTTERWAVE";
type Connection={providerCode:Provider;environment:"TEST";
  status:"PENDING_VERIFICATION"|"REVOKED";revision:number;enabled:false};
type Snapshot={businessId:string;vaultReady:boolean;connections:Connection[];notice:string};

export function GatewayConnectionsPanel({businessId,online}:{
  businessId:string;online:boolean;
}){
  const [provider,setProvider]=useState<Provider>("PAYSTACK");
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [secretKey,setSecretKey]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [reload,setReload]=useState(0);

  useEffect(()=>{
    setSnapshot(null);setSecretKey("");setPassword("");setError(null);
    if(!online)return;
    let active=true;
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+
      "/payment-gateways/connections").then(async response=>{
      if(!response.ok)throw new Error(
        await readApiErrorMessage(response,"Cannot load gateway connections"));
      const data=await response.json() as Snapshot;
      if(data.businessId!==businessId)throw new Error("Connection business mismatch");
      if(active)setSnapshot(data);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:"Unavailable");});
    return ()=>{active=false;};
  },[businessId,online,reload]);

  const current=snapshot?.connections.find(x=>x.providerCode===provider);
  async function update(kind:"save"|"revoke"){
    if(!snapshot||!online||busy||!password)return;
    if(kind==="save"&&(!secretKey||!snapshot.vaultReady))return;
    if(kind==="revoke"&&(!current||current.status==="REVOKED"||
      !window.confirm("Revoke this test credential?")))return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        "/v1/businesses/"+encodeURIComponent(businessId)+
        "/payment-gateways/connections/"+provider,{
          method:kind==="save"?"PUT":"DELETE",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(kind==="save"?{
            expectedRevision:current?.revision??0,currentPassword:password,secretKey,
          }:{expectedRevision:current?.revision??0,currentPassword:password}),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(
        response,"Could not update gateway connection"));
      setMessage(kind==="save"?"Encrypted TEST key saved. No collections enabled.":
        "Saved TEST key revoked. No collections enabled.");
      setReload(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:"Connection update failed");}
    finally{setBusy(false);setSecretKey("");setPassword("");}
  }
  return <section aria-label="Secure merchant test gateway connections"
    style={{padding:16,border:"1px solid var(--tos-color-border,#cbd5e1)",
      borderRadius:12,display:"grid",gap:12}}>
    <h3>Connect your provider test account</h3>
    <p>Paystack and Flutterwave merchant TEST keys only. Saved keys are
      encrypted on the server and cannot activate real customer payments.</p>
    {!online?<p role="status">Connect to manage your test credentials.</p>:null}
    {snapshot&&!snapshot.vaultReady?<p className="tos-callout" role="alert">
      Secure credential storage is not configured. Ask the TradeOS platform
      administrator to provision the server encryption master key.</p>:null}
    {snapshot?<><label htmlFor="gateway-connect-provider">Provider</label>
      <select id="gateway-connect-provider" className="tos-input"
        value={provider} disabled={!online||busy}
        onChange={e=>{setProvider(e.target.value as Provider);
          setSecretKey("");setPassword("");setMessage(null);setError(null);}}>
        <option value="PAYSTACK">Paystack</option>
        <option value="FLUTTERWAVE">Flutterwave</option>
      </select>
      <p>Status: <strong>{!current?"Not configured":
        current.status==="REVOKED"?"Revoked":"TEST credentials saved — pending verification"}
      </strong>. Real collections: <strong>Disabled</strong>.</p>
      <label htmlFor="gateway-test-secret">Provider TEST secret key</label>
      <input id="gateway-test-secret" type="password" className="tos-input"
        autoComplete="off" value={secretKey}
        placeholder={provider==="PAYSTACK"?"sk_test_…":"FLWSECK_TEST-…"}
        disabled={!online||busy||!snapshot.vaultReady} maxLength={256}
        onChange={e=>setSecretKey(e.target.value)}/>
      <label htmlFor="gateway-account-password">Current TradeOS password
        (confirm sensitive change)</label>
      <input id="gateway-account-password" type="password" className="tos-input"
        autoComplete="current-password" value={password} maxLength={200}
        disabled={!online||busy} onChange={e=>setPassword(e.target.value)}/>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <Button type="button" variant="primary" loading={busy}
          disabled={!online||busy||!snapshot.vaultReady||!secretKey||!password}
          onClick={()=>void update("save")}>Save TEST credential</Button>
        <Button type="button" variant="outline"
          disabled={!online||busy||!password||!current||
            current.status==="REVOKED"}
          onClick={()=>void update("revoke")}>Revoke TEST credential</Button>
      </div>
      <p className="tos-callout">{snapshot.notice}
        Credentials cannot be viewed again after saving. Live keys are not
        accepted. Earlier encrypted backup copies remain governed by the
        platform's data-retention policy.</p>
    </>:null}
    {error?<p role="alert" className="tos-banner tos-banner--danger">{error}</p>:null}
    {message?<p role="status" className="tos-callout">{message}</p>:null}
  </section>;
}
