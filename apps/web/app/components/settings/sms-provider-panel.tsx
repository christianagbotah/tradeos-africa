"use client";

import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {Button} from "../ui/button";
import {useWorkspace} from "../workspace/use-workspace";

type Provider="ARKESEL"|"NALO"|"HUBTEL_SMS"|"TWILIO";
type Connection={providerCode:Provider;accountId:string|null;
  senderId:string;status:"SAVED_UNVERIFIED"|"REVOKED";
  revision:number;enabled:false;updatedAt:string};
type Snapshot={businessId:string;vaultReady:boolean;
  sendingEnabled:false;connections:Connection[];notice:string};
const PROVIDERS:readonly {
  code:Provider;name:string;secretLabel:string;accountLabel?:string;
  senderLabel:string;docs:string;hint:string;
}[]=[
  {code:"ARKESEL",name:"Arkesel",secretLabel:"SMS API key",
    senderLabel:"Approved Sender ID",docs:"https://developers.arkesel.com/",
    hint:"Create your SMS API key and register a sender ID in Arkesel."},
  {code:"NALO",name:"Nalo Solutions",secretLabel:"SMS API key",
    senderLabel:"Approved Sender ID",
    docs:"https://help.nalosolutions.com/en/requesting-sender-ids/",
    hint:"Use the SMS API key provided by Nalo and your approved sender ID."},
  {code:"HUBTEL_SMS",name:"Hubtel SMS",secretLabel:"SMS Client Secret",
    accountLabel:"SMS Client ID",senderLabel:"Approved Sender ID",
    docs:"https://code.hubtel.com/docs/guides/sms",
    hint:"SMS Client ID and Secret are different from payment API credentials."},
  {code:"TWILIO",name:"Twilio",secretLabel:"Auth Token",
    accountLabel:"Account SID",senderLabel:"Sender phone (E.164)",
    docs:"https://www.twilio.com/docs/messaging/quickstart",
    hint:"Use your Twilio Account SID, Auth Token, and an approved sender number."},
];
export function SmsProviderPanel(){
  const {session,role,queue}=useWorkspace();
  const businessId=session?.businessId??null;
  const online=queue.online;
  const canManage=role==="OWNER"||role==="ADMIN";
  const [provider,setProvider]=useState<Provider>("ARKESEL");
  const [data,setData]=useState<Snapshot|null>(null);
  const [apiSecret,setApiSecret]=useState("");
  const [senderId,setSenderId]=useState("");
  const [accountId,setAccountId]=useState("");
  const [password,setPassword]=useState("");
  const [showSecret,setShowSecret]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const selected=PROVIDERS.find(x=>x.code===provider)!;
  const current=data?.connections.find(x=>x.providerCode===provider);

  useEffect(()=>{
    setData(null);setError(null);setApiSecret("");setPassword("");
    if(!businessId||!online||!canManage){setLoading(false);return;}
    let active=true;setLoading(true);
    void getOfflineQueue().authenticatedFetch(
      "/v1/businesses/"+encodeURIComponent(businessId)+
      "/sms-providers/connections").then(async response=>{
        if(!response.ok)throw new Error(await readApiErrorMessage(response));
        const snapshot=await response.json() as Snapshot;
        if(snapshot.businessId!==businessId||snapshot.sendingEnabled!==false)
          throw new Error("Messaging configuration did not match the business.");
        if(active)setData(snapshot);
      }).catch(e=>{if(active)setError(e instanceof Error?e.message:
        "Could not load SMS settings.");}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[businessId,online,canManage,refresh]);

  useEffect(()=>{
    const record=data?.connections.find(x=>x.providerCode===provider);
    setSenderId(record?.senderId??"");setAccountId(record?.accountId??"");
    setApiSecret("");setPassword("");setError(null);setMessage(null);
  },[data,provider]);

  async function mutate(kind:"save"|"revoke"){
    if(!businessId||!online||!data||busy||!password)return;
    if(kind==="save"&&(!data.vaultReady||!apiSecret||!senderId))return;
    if(kind==="revoke"&&(!current||current.status==="REVOKED"||
      !window.confirm("Revoke this SMS API credential?")))return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        "/v1/businesses/"+encodeURIComponent(businessId)+
        "/sms-providers/connections/"+provider,{
          method:kind==="save"?"PUT":"DELETE",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(kind==="save"?{
            apiSecret,senderId,accountId:selected.accountLabel?accountId:null,
            expectedRevision:current?.revision??0,currentPassword:password,
          }:{
            expectedRevision:current?.revision??0,currentPassword:password,
          }),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      setMessage(kind==="save"?
        "SMS API credentials encrypted and saved. Sending is not yet enabled.":
        "SMS API credential revoked. Sending remains disabled.");
      setApiSecret("");setPassword("");
      setRefresh(x=>x+1);
    }catch(e){setError(e instanceof Error?e.message:
      "Could not save SMS connection.");}
    finally{setBusy(false);setApiSecret("");setPassword("");}
  }
  if(!session)return null;
  return <section className="tos-settings__panel" aria-label="SMS and messaging providers"
    style={{display:"grid",gap:16,minWidth:0}}>
    <div>
      <p className="tos-settings__eyebrow">COMMUNICATIONS</p>
      <h2>SMS & messaging providers</h2>
      <p>Enter this business's own SMS API credentials. TradeOS encrypts
        them separately from payment gateway credentials.</p>
    </div>
    {!canManage?<p className="tos-callout">Only the business owner or
      administrator can manage messaging credentials.</p>:null}
    {!online?<p className="tos-callout">Connect to the internet to manage
      sensitive API credentials.</p>:null}
    {loading?<p role="status">Loading messaging connections…</p>:null}
    {error?<p className="tos-banner tos-banner--danger" role="alert">{error}</p>:null}
    {canManage&&data?<div style={{display:"grid",gap:12,
      maxWidth:680,minWidth:0}}>
      <label htmlFor="sms-provider-select">SMS service provider</label>
      <select id="sms-provider-select" className="tos-input" value={provider}
        disabled={!online||busy}
        onChange={e=>setProvider(e.target.value as Provider)}>
        {PROVIDERS.map(x=><option value={x.code} key={x.code}>{x.name}</option>)}
      </select>
      <p>{selected.hint} <a href={selected.docs} target="_blank"
        rel="noopener noreferrer">Open provider instructions</a></p>
      <p>Status: <strong>{!current?"No credentials saved":
        current.status==="REVOKED"?"Revoked":
          "Credentials saved — account not verified"}</strong>.
        SMS sending: <strong>Not enabled</strong>.</p>
      {!data.vaultReady?<p role="alert" className="tos-callout">
        TradeOS encrypted credential storage is not yet provisioned
        by the platform administrator. The API key field is temporarily
        disabled to avoid storing secrets insecurely.</p>:null}
      {selected.accountLabel?<><label htmlFor="sms-account-id">
        {selected.accountLabel}</label>
        <input id="sms-account-id" className="tos-input" value={accountId}
          maxLength={128} disabled={busy||!online||!data.vaultReady}
          placeholder={selected.code==="TWILIO"?"AC…":"Your SMS client ID"}
          onChange={e=>setAccountId(e.target.value)}/></>:null}
      <label htmlFor="sms-sender-id">{selected.senderLabel}</label>
      <input id="sms-sender-id" className="tos-input" value={senderId}
        maxLength={40} disabled={busy||!online||!data.vaultReady}
        placeholder={provider==="TWILIO"?"+233XXXXXXXXX":"Your approved brand name"}
        onChange={e=>setSenderId(e.target.value)}/>
      <label htmlFor="sms-api-secret">{selected.secretLabel}</label>
      <div style={{display:"flex",gap:8,minWidth:0,flexWrap:"wrap"}}>
        <input id="sms-api-secret" className="tos-input"
          style={{flex:"1 1 240px",minWidth:0}}
          type={showSecret?"text":"password"} autoComplete="off"
          maxLength={256} value={apiSecret}
          disabled={busy||!online||!data.vaultReady}
          placeholder="Paste API secret from provider dashboard"
          onChange={e=>setApiSecret(e.target.value)}/>
        <Button type="button" variant="outline"
          onClick={()=>setShowSecret(x=>!x)}>
          {showSecret?"Hide":"Show"}
        </Button>
      </div>
      <label htmlFor="sms-account-password">Current TradeOS password
        (authorize sensitive change)</label>
      <input id="sms-account-password" className="tos-input" type="password"
        autoComplete="current-password" maxLength={200}
        value={password} disabled={busy||!online}
        onChange={e=>setPassword(e.target.value)}/>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <Button type="button" variant="primary" loading={busy}
          disabled={busy||!online||!data.vaultReady||!apiSecret||
            !senderId||!password||Boolean(selected.accountLabel&&!accountId)}
          onClick={()=>void mutate("save")}>Save encrypted credentials</Button>
        <Button type="button" variant="outline"
          disabled={busy||!online||!password||!current||
            current.status==="REVOKED"}
          onClick={()=>void mutate("revoke")}>Revoke credentials</Button>
        <Button type="button" variant="outline"
          disabled={busy||!online} onClick={()=>setRefresh(x=>x+1)}>Refresh</Button>
      </div>
      {message?<p className="tos-callout" role="status">{message}</p>:null}
      <p className="tos-callout">{data.notice} No SMS will be sent by saving
        a credential. Sender approval, recipient consent, delivery logs
        and real API verification are required before sending is activated.</p>
    </div>:null}
  </section>;
}
