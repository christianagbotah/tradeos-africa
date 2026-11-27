"use client";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "../components/ui/button";
import styles from "./programme.module.css";

type Organisation={id:string;name:string;role:string};
type Programme={id:string;name:string;objective:string;status:string};
type Cohort={id:string;programmeId:string;name:string;capacity:number};
type Participant={id:string;displayName:string;consentedAt:string;withdrawnAt?:string|null};
type Enrolment={id:string;cohortId:string;cohortName:string;programmeName:string;participantId:string;displayName:string};
type Overview={programmes:Programme[];cohorts:Cohort[];participants:Participant[];enrolments:Enrolment[];self:Participant|null};
const empty:Overview={programmes:[],cohorts:[],participants:[],enrolments:[],self:null};
const managers=["ORG_ADMIN","COORDINATOR"];
const roleLabel:Record<string,string>={ORG_ADMIN:"Administrator",COORDINATOR:"Coordinator",MENTOR:"Mentor",PARTICIPANT:"Participant",REPORT_VIEWER:"Report viewer"};
type Session={accessToken:string;refreshToken:string};

export default function ProgrammePage(){
  const token=useRef<Session|null>(null);
  const pending=useRef(false);
  const requestIds=useRef(new Map<string,string>());
  const [organisations,setOrganisations]=useState<Organisation[]>([]);
  const [org,setOrg]=useState<Organisation|null>(null);
  const [data,setData]=useState<Overview>(empty);
  const [authenticated,setAuthenticated]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [tab,setTab]=useState("Overview");
  const [identifier,setIdentifier]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [objective,setObjective]=useState("");
  const [cohortName,setCohortName]=useState("");
  const [programmeId,setProgrammeId]=useState("");
  const [capacity,setCapacity]=useState("20");
  const [participantId,setParticipantId]=useState("");
  const [cohortId,setCohortId]=useState("");
  const [displayName,setDisplayName]=useState("");
  const [consent,setConsent]=useState(false);
  const [adult,setAdult]=useState(false);
  function reset(){
    token.current=null;requestIds.current.clear();setAuthenticated(false);setOrganisations([]);setOrg(null);setData(empty);
    setPassword("");setDisplayName("");setConsent(false);setAdult(false);setNotice("");setTab("Overview");
  }
  async function json<T>(url:string,body?:unknown):Promise<T>{
    const response=await fetch(url,{cache:"no-store",method:body===undefined?"GET":"POST",
      headers:{...(token.current?{Authorization:"Bearer "+token.current.accessToken}:{}),
        ...(body===undefined?{}:{"Content-Type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      if(response.status===401&&token.current){reset();throw new Error("Session expired. Sign in again.");}
      throw new Error(typeof result?.message==="string"?result.message:"Request could not be completed.");
    }
    return result as T;
  }
  async function run(work:()=>Promise<void>){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");setNotice("");
    try{await work();}catch(e){setError(e instanceof Error?e.message:"Unable to complete request.");}
    finally{pending.current=false;setBusy(false);}
  }
  const prefix=(o:Organisation)=>"/v1/programmes/"+encodeURIComponent(o.id);
  async function load(o:Organisation){
    if(managers.includes(o.role)){
      const [p,c,b,e]=await Promise.all([
        json<{programmes:Programme[]}>(prefix(o)+"/programmes"),json<{cohorts:Cohort[]}>(prefix(o)+"/cohorts"),
        json<{participants:Participant[]}>(prefix(o)+"/participants"),json<{enrolments:Enrolment[]}>(prefix(o)+"/enrolments")]);
      setData({...empty,programmes:p.programmes,cohorts:c.cohorts,participants:b.participants,enrolments:e.enrolments});
    }else if(o.role==="PARTICIPANT"){
      const [p,e]=await Promise.all([json<{participant:Participant|null}>(prefix(o)+"/participants/self"),
        json<{enrolments:Enrolment[]}>(prefix(o)+"/enrolments")]);
      setData({...empty,self:p.participant,enrolments:e.enrolments});
    }else setData(empty);
  }
  async function selectOrg(o:Organisation){
    setOrg(null);setData(empty);setTab("Overview");setProgrammeId("");setCohortId("");setParticipantId("");
    setName("");setObjective("");setCohortName("");setDisplayName("");setConsent(false);setAdult(false);
    await load(o);setOrg(o);
  }
  async function signIn(e:FormEvent){
    e.preventDefault();
    await run(async()=>{
      const r=await json<{session:Session}>("/v1/auth/login",{identifier:identifier.trim(),password,platform:"WEB",deviceKey:"programme-"+crypto.randomUUID(),appVersion:"programme-preview"});
      if(!r.session?.accessToken)throw new Error("Session unavailable");
      token.current=r.session;setPassword("");
      try{
        const result=await json<{organisations:Organisation[]}>("/v1/programmes/organisations");
        setOrganisations(result.organisations);setAuthenticated(true);
        if(result.organisations.length===1)await selectOrg(result.organisations[0]!);
      }catch(e){reset();throw e;}
    });
  }
  async function signOut(){
    await run(async()=>{try{if(token.current)await json("/v1/auth/logout",{});}finally{reset();}});
  }
  async function write(path:string,payload:Record<string,unknown>,message:string,after?:()=>void){
    if(!org)return;
    const current=org;
    await run(async()=>{
      const key=JSON.stringify([current.id,path,payload]);
      const id=requestIds.current.get(key)??crypto.randomUUID();
      requestIds.current.set(key,id);
      await json(prefix(current)+path,{...payload,clientRequestId:id});
      // Keep the ID until refresh also succeeds; retry after lost reply is exact.
      await load(current);requestIds.current.delete(key);after?.();setNotice(message);
    });
  }
  const manager=org&&managers.includes(org.role);
  const selected=org?.role==="PARTICIPANT";
  const submit=(f:()=>void)=>(e:FormEvent)=>{e.preventDefault();f();};
  const list=(rows:{id:string;title:string;subtitle:string}[],fallback:string)=><div className={styles.rows}>{rows.length?rows.map(x=><div className={styles.row} key={x.id}><strong>{x.title}</strong><span>{x.subtitle}</span></div>):<p className={styles.muted}>{fallback}</p>}</div>;
  return <main className={styles.shell}>
    <header className={styles.header}><div className={styles.brand}><span className={styles.mark}>T</span><div><strong>TradeOS Africa</strong><small>Empowerment workspace</small></div></div>
      {authenticated?<Button variant="outline" size="sm" onClick={()=>void signOut()} disabled={busy}>Sign out</Button>:<a href="/">Business sign in</a>}
    </header>
    <div className={styles.content}>
      {error&&<div className={styles.error} role="alert">{error}</div>}
      {notice&&<div className={styles.success} role="status">{notice}</div>}
      {!authenticated?<section className={styles.signin}><span className={styles.eyebrow}>Programme access</span><h1>Build skills. Grow enterprises.</h1><p>Sign in with your invited programme account.</p>
        <form onSubmit={signIn} className={styles.form}><label>Email or phone<input className="tos-input" autoComplete="username" required value={identifier} onChange={e=>setIdentifier(e.target.value)} disabled={busy}/></label>
        <label>Password<input className="tos-input" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
        <Button variant="primary" type="submit" block loading={busy}>Sign in</Button></form>
        <p className={styles.muted}>Programme access is invitation-only. Business accounts remain separate.</p></section>:
      <>
        <div className={styles.heading}><div><span className={styles.eyebrow}>Programme management</span><h1>{org?.name??"Choose your organisation"}</h1><p>{org?roleLabel[org.role]??org.role:"Select an assigned programme workspace."}</p></div>
          {organisations.length>0&&<label className={styles.selector}>Organisation<select className="tos-select" disabled={busy} value={org?.id??""} onChange={e=>{const o=organisations.find(x=>x.id===e.target.value);if(o)void run(()=>selectOrg(o));}}><option value="" disabled>Select organisation</option>{organisations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
        </div>
        {!organisations.length&&<section className={styles.card}><h2>No programme access</h2><p>Contact the programme administrator for an invitation. No business membership is created here.</p></section>}
        {manager&&org&&<>
          <nav className={styles.tabs} aria-label="Programme sections">{["Overview","Programmes","Cohorts","Beneficiaries","Enrolments"].map(t=><button key={t} type="button" aria-current={tab===t?"page":undefined} disabled={busy} onClick={()=>setTab(t)}>{t}</button>)}</nav>
          {tab==="Overview"&&<><div className={styles.metrics}>{[["Programmes",data.programmes.length],["Cohorts",data.cohorts.length],["Beneficiaries",data.participants.length],["Enrolments",data.enrolments.length]].map(([label,value])=><button key={label} disabled={busy} onClick={()=>setTab(String(label))}><span>{label}</span><strong>{value}</strong><small>Loaded records</small></button>)}</div><section className={styles.card}><h2>Getting started</h2><p>Create a programme, add a cohort, then enrol a participant who has accepted the programme consent.</p><Button variant="primary" onClick={()=>setTab("Programmes")}>Manage programmes</Button></section></>}
          {tab==="Programmes"&&<div className={styles.grid}><section className={styles.card}><h2>New programme</h2><form className={styles.form} onSubmit={submit(()=>void write("/programmes",{name:name.trim(),objective:objective.trim()},"Programme created.",()=>{setName("");setObjective("");}))}><label>Programme name<input className="tos-input" required maxLength={160} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label><label>Objective<textarea className="tos-input" maxLength={1000} value={objective} onChange={e=>setObjective(e.target.value)} disabled={busy}/></label><Button type="submit" variant="primary" loading={busy}>Create programme</Button></form></section><section className={styles.card}><h2>Programmes</h2>{list(data.programmes.map(p=>({id:p.id,title:p.name,subtitle:p.status+" · "+(p.objective||"No objective")})),"No programmes yet.")}</section></div>}
          {tab==="Cohorts"&&<div className={styles.grid}><section className={styles.card}><h2>New cohort</h2><form className={styles.form} onSubmit={submit(()=>void write("/cohorts",{programmeId,name:cohortName.trim(),capacity:Number(capacity)},"Cohort created.",()=>setCohortName("")))}><label>Programme<select className="tos-select" aria-label="Programme" required value={programmeId} onChange={e=>setProgrammeId(e.target.value)} disabled={busy}><option value="">Select programme</option>{data.programmes.filter(p=>p.status!=="CLOSED").map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Cohort name<input className="tos-input" required maxLength={160} value={cohortName} onChange={e=>setCohortName(e.target.value)} disabled={busy}/></label><label>Capacity<input className="tos-input" type="number" min={1} max={10000} step={1} required value={capacity} onChange={e=>setCapacity(e.target.value)} disabled={busy}/></label><Button type="submit" variant="primary" loading={busy}>Create cohort</Button></form></section><section className={styles.card}><h2>Cohorts</h2>{list(data.cohorts.map(c=>({id:c.id,title:c.name,subtitle:(data.programmes.find(p=>p.id===c.programmeId)?.name??"Programme")+" · "+c.capacity+" seats"})),"No cohorts yet.")}</section></div>}
          {tab==="Beneficiaries"&&<section className={styles.card}><h2>Consenting participants</h2><p className={styles.muted}>Only participants with active consent and membership are listed.</p>{list(data.participants.map(p=>({id:p.id,title:p.displayName,subtitle:"Consent recorded"})),"No consenting participants yet.")}</section>}
          {tab==="Enrolments"&&<div className={styles.grid}><section className={styles.card}><h2>Enrol participant</h2><form className={styles.form} onSubmit={submit(()=>void write("/enrolments",{cohortId,participantId},"Participant enrolled.",()=>setParticipantId("")))}><label>Cohort<select className="tos-select" aria-label="Cohort" required value={cohortId} onChange={e=>setCohortId(e.target.value)} disabled={busy}><option value="">Select cohort</option>{data.cohorts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Beneficiary<select className="tos-select" aria-label="Beneficiary" required value={participantId} onChange={e=>setParticipantId(e.target.value)} disabled={busy}><option value="">Select participant</option>{data.participants.map(p=><option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label><Button type="submit" variant="primary" loading={busy}>Enrol participant</Button></form></section><section className={styles.card}><h2>Active enrolments</h2>{list(data.enrolments.map(e=>({id:e.id,title:e.displayName,subtitle:e.programmeName+" · "+e.cohortName})),"No active enrolments.")}</section></div>}
        </>}
        {selected&&<div className={styles.grid}><section className={styles.card}><h2>My participation</h2>{data.self?<><p>{data.self.displayName}</p><p className={styles.muted}>{data.self.withdrawnAt?"Consent withdrawn":"Consent recorded"}</p>{!data.self.withdrawnAt&&<Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm("Withdraw programme participation consent? Your active profile will no longer appear to coordinators."))void write("/participants/self/withdraw",{},"Consent withdrawn.");}}>Withdraw consent</Button>}</>:<form className={styles.form} onSubmit={submit(()=>void write("/participants/self",{displayName:displayName.trim(),consentVersion:"v1",adultConfirmed:adult,consent},"Participation consent recorded."))}><label>Display name<input className="tos-input" required maxLength={160} value={displayName} onChange={e=>setDisplayName(e.target.value)} disabled={busy}/></label><p className={styles.muted}>Your assigned programme coordinators can view your display name and enrolments. Your independent business records are not shared.</p><label className={styles.check}><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)} disabled={busy} required/>I am an adult.</label><label className={styles.check}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy} required/>I agree to participate and share this profile with my programme coordinators.</label><Button type="submit" variant="primary" disabled={!adult||!consent} loading={busy}>Confirm participation</Button></form>}</section><section className={styles.card}><h2>My enrolments</h2>{list(data.enrolments.map(e=>({id:e.id,title:e.programmeName,subtitle:e.cohortName})),"No active enrolments.")}</section></div>}
        {org&&!manager&&!selected&&<section className={styles.card}><h2>Workspace access</h2><p>This role has no available programme actions yet.</p></section>}
      </>}
    </div>
  </main>;
}
