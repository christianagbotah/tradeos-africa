"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/ui/button";
import styles from "./programme.module.css";

type Organisation={id:string;name:string;role:string};
type Programme={id:string;name:string;objective:string;status:string};
type Cohort={id:string;programmeId:string;name:string;capacity:number};
type Participant={id:string;displayName:string;consentedAt:string;withdrawnAt?:string|null};
type Enrolment={id:string;cohortId:string;cohortName:string;programmeName:string;participantId:string;displayName:string};
type Pathway={id:string;cohortId:string;cohortName:string;name:string;description:string;plannedHours:number};
type Mentor={id:string;displayName:string};
type Placement={id:string;status:string;pathwayName:string;plannedHours:number;participantName:string;mentorName:string;enrolmentId:string;pathwayId:string};
type EquipmentUnit={id:string;assetCode:string;name:string;condition:string;status:string};
type Allocation={id:string;status:string;equipmentName:string;assetCode:string;condition:string;participantName:string|null;reservedAt:string;approvedAt:string|null;handedOverAt:string|null;canApprove:boolean};
type Lesson={id:string;cohortId:string;cohortName:string;title:string;topic:string;lessonText:string;question:string;options:string[];version:number;enrolmentId?:string;passed?:boolean;attempts?:number};
const literacyTopics:Record<string,string>={RECORD_KEEPING:"Record keeping",COSTING_PRICING:"Costing and pricing",BUDGETING:"Budgeting",SAVINGS:"Savings",CASH_RECONCILIATION:"Cash and MoMo reconciliation",BUSINESS_FINANCE:"Business finance",STOCK_CONTROL:"Stock control",CREDIT_BASICS:"Credit basics"};
type LinkedBusiness={id:string;name:string;businessType:string;linkId:string|null;linkedAt:string|null};
type BusinessSummary={suppressed:boolean;minimumCellSize:number;participants:number|null;linked:number|null};
type OutcomeSummary={minimumCellSize:number;participants:number|null;metrics:{key:string;count:number|null;suppressed:boolean}[]};
const outcomeLabels:Record<string,string>={enrolled:"Enrolled in a cohort",trained:"Completed a training placement",equipped:"Confirmed equipment receipt",learned:"Passed a literacy lesson"};
type Overview={programmes:Programme[];cohorts:Cohort[];participants:Participant[];enrolments:Enrolment[];self:Participant|null;pathways:Pathway[];mentors:Mentor[];placements:Placement[];units:EquipmentUnit[];allocations:Allocation[];lessons:Lesson[];businesses:LinkedBusiness[];businessSummary:BusinessSummary|null;outcomes:OutcomeSummary|null};
const empty:Overview={programmes:[],cohorts:[],participants:[],enrolments:[],self:null,pathways:[],mentors:[],placements:[],units:[],allocations:[],lessons:[],businesses:[],businessSummary:null,outcomes:null};
const managers=["ORG_ADMIN","COORDINATOR"];
const roleLabel:Record<string,string>={ORG_ADMIN:"Administrator",COORDINATOR:"Coordinator",MENTOR:"Mentor",PARTICIPANT:"Participant",REPORT_VIEWER:"Report viewer"};
type Session={accessToken:string;refreshToken:string};

export default function ProgrammePage(){
  const [ready,setReady]=useState(false);
  useEffect(()=>setReady(true),[]);
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
  const [trainingCohort,setTrainingCohort]=useState("");
  const [pathwayName,setPathwayName]=useState("");
  const [hours,setHours]=useState("40");
  const [pathwayId,setPathwayId]=useState("");
  const [trainingEnrolment,setTrainingEnrolment]=useState("");
  const [mentorId,setMentorId]=useState("");
  const [progressId,setProgressId]=useState("");
  const [progressNote,setProgressNote]=useState("");
  const [progressStatus,setProgressStatus]=useState("IN_PROGRESS");
  const [assetCode,setAssetCode]=useState("");
  const [assetName,setAssetName]=useState("");
  const [condition,setCondition]=useState("NEW");
  const [equipmentId,setEquipmentId]=useState("");
  const [equipmentEnrolment,setEquipmentEnrolment]=useState("");
  const [equipmentAction,setEquipmentAction]=useState<{id:string;action:"APPROVE"|"CANCEL"|"ACKNOWLEDGE";name:string}|null>(null);
  const [lessonCohort,setLessonCohort]=useState("");
  const [lessonTitle,setLessonTitle]=useState("");
  const [lessonTopic,setLessonTopic]=useState("RECORD_KEEPING");
  const [lessonVersion,setLessonVersion]=useState("1");
  const [lessonText,setLessonText]=useState("");
  const [question,setQuestion]=useState("");
  const [options,setOptions]=useState(["","",""]);
  const [correctOption,setCorrectOption]=useState("0");
  const [selectedLesson,setSelectedLesson]=useState("");
  const [answer,setAnswer]=useState("");
  const [businessToLink,setBusinessToLink]=useState("");
  const [businessConsent,setBusinessConsent]=useState(false);
  const [unlinkTarget,setUnlinkTarget]=useState<LinkedBusiness|null>(null);
  function resetTraining(){
    setBusinessToLink("");setBusinessConsent(false);setUnlinkTarget(null);
    setLessonCohort("");setLessonTitle("");setLessonTopic("RECORD_KEEPING");setLessonVersion("1");setLessonText("");setQuestion("");setOptions(["","",""]);setCorrectOption("0");setSelectedLesson("");setAnswer("");
    setAssetCode("");setAssetName("");setCondition("NEW");setEquipmentId("");setEquipmentEnrolment("");setEquipmentAction(null);
    setTrainingCohort("");setPathwayName("");setHours("40");setPathwayId("");setTrainingEnrolment("");setMentorId("");setProgressId("");setProgressNote("");setProgressStatus("IN_PROGRESS");
  }
  function reset(){
    resetTraining();token.current=null;requestIds.current.clear();setAuthenticated(false);setOrganisations([]);setOrg(null);setData(empty);
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
      const [p,c,b,e,t,m,a,eq,al,le,bs,ou]=await Promise.all([
        json<{programmes:Programme[]}>(prefix(o)+"/programmes"),json<{cohorts:Cohort[]}>(prefix(o)+"/cohorts"),
        json<{participants:Participant[]}>(prefix(o)+"/participants"),json<{enrolments:Enrolment[]}>(prefix(o)+"/enrolments"),json<{pathways:Pathway[]}>(prefix(o)+"/training/pathways"),json<{mentors:Mentor[]}>(prefix(o)+"/training/mentors"),json<{placements:Placement[]}>(prefix(o)+"/training/placements"),json<{units:EquipmentUnit[]}>(prefix(o)+"/equipment/units"),json<{allocations:Allocation[]}>(prefix(o)+"/equipment/allocations"),json<{lessons:Lesson[]}>(prefix(o)+"/literacy/lessons"),json<BusinessSummary>(prefix(o)+"/businesses/summary"),json<OutcomeSummary>(prefix(o)+"/outcomes")]);
      setData({...empty,programmes:p.programmes,cohorts:c.cohorts,participants:b.participants,enrolments:e.enrolments,pathways:t.pathways,mentors:m.mentors,placements:a.placements,units:eq.units,allocations:al.allocations,lessons:le.lessons,businessSummary:bs,outcomes:ou});
    }else if(o.role==="PARTICIPANT"){
      const [p,e,a,al,le,bu]=await Promise.all([json<{participant:Participant|null}>(prefix(o)+"/participants/self"),
        json<{enrolments:Enrolment[]}>(prefix(o)+"/enrolments"),json<{placements:Placement[]}>(prefix(o)+"/training/placements"),json<{allocations:Allocation[]}>(prefix(o)+"/equipment/allocations"),json<{lessons:Lesson[]}>(prefix(o)+"/literacy/lessons"),json<{businesses:LinkedBusiness[]}>(prefix(o)+"/businesses/self")]);
      setData({...empty,self:p.participant,enrolments:e.enrolments,placements:a.placements,allocations:al.allocations,lessons:le.lessons,businesses:bu.businesses});
    }else if(o.role==="MENTOR"){const a=await json<{placements:Placement[]}>(prefix(o)+"/training/placements");setData({...empty,placements:a.placements});}else if(o.role==="REPORT_VIEWER"){const [bs,ou]=await Promise.all([json<BusinessSummary>(prefix(o)+"/businesses/summary"),json<OutcomeSummary>(prefix(o)+"/outcomes")]);setData({...empty,businessSummary:bs,outcomes:ou});}else setData(empty);
  }
  async function selectOrg(o:Organisation){
    resetTraining();setOrg(null);setData(empty);setTab("Overview");setProgrammeId("");setCohortId("");setParticipantId("");
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
  async function write(path:string,payload:Record<string,unknown>,message:string|((receipt:{passed?:boolean})=>string),after?:()=>void){
    if(!org)return;
    const current=org;
    await run(async()=>{
      const key=JSON.stringify([current.id,path,payload]);
      const id=requestIds.current.get(key)??crypto.randomUUID();
      requestIds.current.set(key,id);
      const receipt=await json<{passed?:boolean}>(prefix(current)+path,{...payload,clientRequestId:id});
      // Keep the ID until refresh also succeeds; retry after lost reply is exact.
      await load(current);requestIds.current.delete(key);after?.();setNotice(typeof message==="function"?message(receipt):message);
    });
  }
  const manager=org&&managers.includes(org.role);
  const selected=org?.role==="PARTICIPANT";
  const mentor=org?.role==="MENTOR";
  const activePathway=data.pathways.find(p=>p.id===pathwayId);
  const progressPlacement=data.placements.find(p=>p.id===progressId);
  const activeLesson=data.lessons.find(l=>l.id===selectedLesson);
  const submit=(f:()=>void)=>(e:FormEvent)=>{e.preventDefault();f();};
  const list=(rows:{id:string;title:string;subtitle:string}[],fallback:string)=><div className={styles.rows}>{rows.length?rows.map(x=><div className={styles.row} key={x.id}><strong>{x.title}</strong><span>{x.subtitle}</span></div>):<p className={styles.muted}>{fallback}</p>}</div>;
  return <main className={styles.shell} data-programme-ready={ready?"true":"false"}>
    <header className={styles.header}><div className={styles.brand}><span className={styles.mark}>T</span><div><strong>TradeOS Africa</strong><small>Empowerment workspace</small></div></div>
      {authenticated?<Button variant="outline" size="sm" onClick={()=>void signOut()} disabled={busy}>Sign out</Button>:<a href="/">Business sign in</a>}
    </header>
    <div className={styles.content}>
      {error&&<div className={styles.error} role="alert">{error}</div>}
      {notice&&<div className={styles.success} role="status">{notice}</div>}
      {!authenticated?<section className={styles.signin}><span className={styles.eyebrow}>Programme access</span><h1>Build skills. Grow enterprises.</h1><p>Sign in with your invited programme account.</p>
        <form onSubmit={signIn} className={styles.form}><label>Email or phone<input className="tos-input" autoComplete="username" required value={identifier} onChange={e=>setIdentifier(e.target.value)} disabled={busy}/></label>
        <label>Password<input className="tos-input" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
        <Button variant="primary" type="submit" block disabled={!ready} loading={busy}>Sign in</Button></form>
        <p className={styles.muted}>Programme access is invitation-only. Business accounts remain separate.</p></section>:
      <>
        <div className={styles.heading}><div><span className={styles.eyebrow}>Programme management</span><h1>{org?.name??"Choose your organisation"}</h1><p>{org?roleLabel[org.role]??org.role:"Select an assigned programme workspace."}</p></div>
          {organisations.length>0&&<label className={styles.selector}>Organisation<select className="tos-select" disabled={busy} value={org?.id??""} onChange={e=>{const o=organisations.find(x=>x.id===e.target.value);if(o)void run(()=>selectOrg(o));}}><option value="" disabled>Select organisation</option>{organisations.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label>}
        </div>
        {!organisations.length&&<section className={styles.card}><h2>No programme access</h2><p>Contact the programme administrator for an invitation. No business membership is created here.</p></section>}
        {manager&&org&&<>
          <nav className={styles.tabs} aria-label="Programme sections">{["Overview","Programmes","Cohorts","Beneficiaries","Enrolments","Apprenticeship","Equipment","Financial literacy","Business activation","Outcomes"].map(t=><button key={t} type="button" aria-current={tab===t?"page":undefined} disabled={busy} onClick={()=>setTab(t)}>{t}</button>)}</nav>
          {tab==="Overview"&&<><div className={styles.metrics}>{[["Programmes",data.programmes.length],["Cohorts",data.cohorts.length],["Beneficiaries",data.participants.length],["Enrolments",data.enrolments.length]].map(([label,value])=><button key={label} disabled={busy} onClick={()=>setTab(String(label))}><span>{label}</span><strong>{value}</strong><small>Loaded records</small></button>)}</div><section className={styles.card}><h2>Getting started</h2><p>Create a programme, add a cohort, then enrol a participant who has accepted the programme consent.</p><Button variant="primary" onClick={()=>setTab("Programmes")}>Manage programmes</Button></section></>}
          {tab==="Programmes"&&<div className={styles.grid}><section className={styles.card}><h2>New programme</h2><form className={styles.form} onSubmit={submit(()=>void write("/programmes",{name:name.trim(),objective:objective.trim()},"Programme created.",()=>{setName("");setObjective("");}))}><label>Programme name<input className="tos-input" required maxLength={160} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label><label>Objective<textarea className="tos-input" maxLength={1000} value={objective} onChange={e=>setObjective(e.target.value)} disabled={busy}/></label><Button type="submit" variant="primary" loading={busy}>Create programme</Button></form></section><section className={styles.card}><h2>Programmes</h2>{list(data.programmes.map(p=>({id:p.id,title:p.name,subtitle:p.status+" · "+(p.objective||"No objective")})),"No programmes yet.")}</section></div>}
          {tab==="Cohorts"&&<div className={styles.grid}><section className={styles.card}><h2>New cohort</h2><form className={styles.form} onSubmit={submit(()=>void write("/cohorts",{programmeId,name:cohortName.trim(),capacity:Number(capacity)},"Cohort created.",()=>setCohortName("")))}><label>Programme<select className="tos-select" aria-label="Programme" required value={programmeId} onChange={e=>setProgrammeId(e.target.value)} disabled={busy}><option value="">Select programme</option>{data.programmes.filter(p=>p.status!=="CLOSED").map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Cohort name<input className="tos-input" required maxLength={160} value={cohortName} onChange={e=>setCohortName(e.target.value)} disabled={busy}/></label><label>Capacity<input className="tos-input" type="number" min={1} max={10000} step={1} required value={capacity} onChange={e=>setCapacity(e.target.value)} disabled={busy}/></label><Button type="submit" variant="primary" loading={busy}>Create cohort</Button></form></section><section className={styles.card}><h2>Cohorts</h2>{list(data.cohorts.map(c=>({id:c.id,title:c.name,subtitle:(data.programmes.find(p=>p.id===c.programmeId)?.name??"Programme")+" · "+c.capacity+" seats"})),"No cohorts yet.")}</section></div>}
          {tab==="Beneficiaries"&&<section className={styles.card}><h2>Consenting participants</h2><p className={styles.muted}>Only participants with active consent and membership are listed.</p>{list(data.participants.map(p=>({id:p.id,title:p.displayName,subtitle:"Consent recorded"})),"No consenting participants yet.")}</section>}
          {tab==="Enrolments"&&<div className={styles.grid}><section className={styles.card}><h2>Enrol participant</h2><form className={styles.form} onSubmit={submit(()=>void write("/enrolments",{cohortId,participantId},"Participant enrolled.",()=>setParticipantId("")))}><label>Cohort<select className="tos-select" aria-label="Cohort" required value={cohortId} onChange={e=>setCohortId(e.target.value)} disabled={busy}><option value="">Select cohort</option>{data.cohorts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Beneficiary<select className="tos-select" aria-label="Beneficiary" required value={participantId} onChange={e=>setParticipantId(e.target.value)} disabled={busy}><option value="">Select participant</option>{data.participants.map(p=><option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label><Button type="submit" variant="primary" loading={busy}>Enrol participant</Button></form></section><section className={styles.card}><h2>Active enrolments</h2>{list(data.enrolments.map(e=>({id:e.id,title:e.displayName,subtitle:e.programmeName+" · "+e.cohortName})),"No active enrolments.")}</section></div>}
        </>}
        {((manager&&tab==="Apprenticeship")||mentor)&&<>
          {manager&&<div className={styles.grid}>
            <section className={styles.card}><h2>Training pathway</h2><form className={styles.form} onSubmit={submit(()=>void write("/training/pathways",{cohortId:trainingCohort,name:pathwayName.trim(),plannedHours:Number(hours)},"Training pathway created.",()=>setPathwayName("")))}>
              <label>Cohort<select aria-label="Training cohort" className="tos-select" required value={trainingCohort} onChange={e=>setTrainingCohort(e.target.value)} disabled={busy}><option value="">Select cohort</option>{data.cohorts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Pathway name<input className="tos-input" required maxLength={160} value={pathwayName} onChange={e=>setPathwayName(e.target.value)} disabled={busy}/></label>
              <label>Planned hours<input className="tos-input" type="number" required min={1} max={10000} value={hours} onChange={e=>setHours(e.target.value)} disabled={busy}/></label>
              <Button type="submit" variant="primary" loading={busy}>Create pathway</Button>
            </form></section>
            <section className={styles.card}><h2>Training pathways</h2>{list(data.pathways.map(p=>({id:p.id,title:p.name,subtitle:p.cohortName+" · "+p.plannedHours+" hours"})),"No pathways yet.")}</section>
            <section className={styles.card}><h2>Assign apprentice</h2><form className={styles.form} onSubmit={submit(()=>void write("/training/placements",{pathwayId,enrolmentId:trainingEnrolment,mentorId},"Training placement assigned.",()=>setTrainingEnrolment("")))}>
              <label>Pathway<select aria-label="Training pathway" className="tos-select" required value={pathwayId} onChange={e=>{setPathwayId(e.target.value);setTrainingEnrolment("");}} disabled={busy}><option value="">Select pathway</option>{data.pathways.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>Apprentice<select aria-label="Apprentice" className="tos-select" required value={trainingEnrolment} onChange={e=>setTrainingEnrolment(e.target.value)} disabled={busy||!activePathway}><option value="">Select enrolled participant</option>{data.enrolments.filter(e=>e.cohortId===activePathway?.cohortId&&!data.placements.some(p=>p.enrolmentId===e.id&&p.pathwayId===pathwayId)).map(e=><option key={e.id} value={e.id}>{e.displayName}</option>)}</select></label>
              <label>Mentor<select aria-label="Assigned mentor" className="tos-select" required value={mentorId} onChange={e=>setMentorId(e.target.value)} disabled={busy}><option value="">Select mentor</option>{data.mentors.map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
              <Button type="submit" variant="primary" loading={busy}>Assign placement</Button>
            </form></section>
            <section className={styles.card}><h2>Mentors</h2>{list(data.mentors.map(m=>({id:m.id,title:m.displayName,subtitle:"Active mentor"})),"No active mentors yet.")}</section>
          </div>}
          <div className={styles.grid}><section className={styles.card}><h2>{mentor?"My apprentices":"Training placements"}</h2>{list(data.placements.map(p=>({id:p.id,title:p.participantName+" · "+p.pathwayName,subtitle:p.mentorName+" · "+p.status.replaceAll("_"," ")})),"No active training placements.")}</section>
          <section className={styles.card}><h2>Record progress</h2><form className={styles.form} onSubmit={submit(()=>void write("/training/progress",{placementId:progressId,status:progressStatus,note:progressNote.trim()},"Training progress recorded.",()=>{setProgressNote("");setProgressId("");setProgressStatus("IN_PROGRESS");}))}>
            <label>Placement<select aria-label="Training placement" className="tos-select" required value={progressId} onChange={e=>{setProgressId(e.target.value);setProgressStatus("IN_PROGRESS");}} disabled={busy}><option value="">Select placement</option>{data.placements.filter(p=>p.status!=="COMPLETED").map(p=><option key={p.id} value={p.id}>{p.participantName+" · "+p.pathwayName}</option>)}</select></label>
            <label>Progress status<select aria-label="Progress status" className="tos-select" value={progressStatus} onChange={e=>setProgressStatus(e.target.value)} disabled={busy||!progressPlacement}><option value="IN_PROGRESS">In progress</option>{progressPlacement?.status==="IN_PROGRESS"&&<option value="COMPLETED">Completed</option>}</select></label>
            <label>Progress note<textarea className="tos-input" required maxLength={500} value={progressNote} onChange={e=>setProgressNote(e.target.value)} disabled={busy}/></label>
            <Button type="submit" variant="primary" loading={busy}>Save progress</Button>
          </form></section></div>
        </>}
        {manager&&tab==="Equipment"&&<div className={styles.grid}>
          <section className={styles.card}><h2>Register equipment</h2><form className={styles.form} onSubmit={submit(()=>void write("/equipment/units",{assetCode:assetCode.trim(),name:assetName.trim(),condition},"Equipment registered.",()=>{setAssetCode("");setAssetName("");}))}>
            <label>Asset code<input className="tos-input" required maxLength={80} value={assetCode} onChange={e=>setAssetCode(e.target.value)} disabled={busy}/></label>
            <label>Equipment name<input className="tos-input" required maxLength={160} value={assetName} onChange={e=>setAssetName(e.target.value)} disabled={busy}/></label>
            <label>Condition<select aria-label="Equipment condition" className="tos-select" value={condition} onChange={e=>setCondition(e.target.value)} disabled={busy}><option value="NEW">New</option><option value="GOOD">Good</option><option value="REFURBISHED">Refurbished</option></select></label>
            <Button variant="primary" type="submit" loading={busy}>Register equipment</Button>
          </form></section>
          <section className={styles.card}><h2>Equipment register</h2>{list(data.units.map(x=>({id:x.id,title:x.name,subtitle:x.assetCode+" · "+x.condition+" · "+x.status.replaceAll("_"," ")})),"No equipment registered.")}</section>
          <section className={styles.card}><h2>Reserve equipment</h2><form className={styles.form} onSubmit={submit(()=>void write("/equipment/allocations",{equipmentId,enrolmentId:equipmentEnrolment},"Equipment reserved for approval.",()=>{setEquipmentId("");setEquipmentEnrolment("");}))}>
            <label>Available equipment<select aria-label="Available equipment" className="tos-select" required value={equipmentId} onChange={e=>setEquipmentId(e.target.value)} disabled={busy}><option value="">Select equipment</option>{data.units.filter(x=>x.status==="AVAILABLE").map(x=><option key={x.id} value={x.id}>{x.assetCode+" · "+x.name}</option>)}</select></label>
            <label>Beneficiary enrolment<select aria-label="Equipment beneficiary" className="tos-select" required value={equipmentEnrolment} onChange={e=>setEquipmentEnrolment(e.target.value)} disabled={busy}><option value="">Select participant</option>{data.enrolments.map(e=><option key={e.id} value={e.id}>{e.displayName+" · "+e.cohortName}</option>)}</select></label>
            <Button variant="primary" type="submit" loading={busy}>Reserve equipment</Button>
          </form></section>
          <section className={styles.card}><h2>Allocations and handovers</h2><p className={styles.muted}>Another administrator must approve a reservation. Only the beneficiary confirms receipt.</p>{data.allocations.length?data.allocations.map(a=><div className={styles.row} key={a.id}><strong>{a.equipmentName}</strong><span>{a.assetCode+" · "+(a.participantName??"Inactive participant")+" · "+a.status.replaceAll("_"," ")}</span>{a.handedOverAt&&<span>Receipt confirmed: {new Date(a.handedOverAt).toLocaleDateString()}</span>}
          {a.status==="RESERVED"||a.status==="APPROVED"?<div className={styles.actions}>{a.canApprove&&<Button variant="primary" disabled={busy} onClick={()=>setEquipmentAction({id:a.id,action:"APPROVE",name:a.equipmentName})}>Approve allocation</Button>}<Button variant="outline" disabled={busy} onClick={()=>setEquipmentAction({id:a.id,action:"CANCEL",name:a.equipmentName})}>Cancel reservation</Button></div>:null}</div>):<p className={styles.muted}>No equipment allocations.</p>}</section>
        </div>}
        {manager&&tab==="Financial literacy"&&<div className={styles.grid}>
          <section className={styles.card}><h2>Publish a learning lesson</h2><p className={styles.muted}>Publish a new immutable lesson version for an assigned cohort. Practice is for learning, not eligibility decisions.</p>
            <form className={styles.form} onSubmit={submit(()=>void write("/literacy/lessons",{cohortId:lessonCohort,title:lessonTitle.trim(),topic:lessonTopic,version:Number(lessonVersion),lessonText:lessonText.trim(),question:question.trim(),options:options.map(o=>o.trim()),correctOption:Number(correctOption)},"Lesson published.",()=>{setLessonTitle("");setLessonText("");setQuestion("");setOptions(["","",""]);setLessonVersion("1");setCorrectOption("0");}))}>
              <label>Cohort<select aria-label="Learning cohort" className="tos-select" required value={lessonCohort} onChange={e=>setLessonCohort(e.target.value)} disabled={busy}><option value="">Select cohort</option>{data.cohorts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Lesson title<input className="tos-input" required maxLength={160} value={lessonTitle} onChange={e=>setLessonTitle(e.target.value)} disabled={busy}/></label>
              <label>Topic<select aria-label="Lesson topic" className="tos-select" value={lessonTopic} onChange={e=>setLessonTopic(e.target.value)} disabled={busy}>{Object.entries(literacyTopics).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
              <label>Version<input className="tos-input" type="number" min={1} max={1000} step={1} required value={lessonVersion} onChange={e=>setLessonVersion(e.target.value)} disabled={busy}/></label>
              <label>Lesson content<textarea className="tos-input" required maxLength={4000} value={lessonText} onChange={e=>setLessonText(e.target.value)} disabled={busy}/></label>
              <label>Practice question<input className="tos-input" required maxLength={500} value={question} onChange={e=>setQuestion(e.target.value)} disabled={busy}/></label>
              {options.map((option,i)=><label key={i}>Answer option {i+1}<input className="tos-input" required maxLength={250} value={option} onChange={e=>setOptions(prev=>prev.map((v,j)=>i===j?e.target.value:v))} disabled={busy}/></label>)}
              <label>Correct answer<select aria-label="Correct answer" className="tos-select" value={correctOption} onChange={e=>setCorrectOption(e.target.value)} disabled={busy}>{options.map((_,i)=><option key={i} value={i}>Option {i+1}</option>)}</select></label>
              <Button type="submit" variant="primary" loading={busy}>Publish lesson</Button>
            </form></section>
          <section className={styles.card}><h2>Published lessons</h2>{list(data.lessons.map(l=>({id:l.id,title:l.title,subtitle:l.cohortName+" · "+(literacyTopics[l.topic]??l.topic)+" · Version "+l.version})),"No published lessons.")}</section>
        </div>}
        {((manager&&tab==="Outcomes")||org?.role==="REPORT_VIEWER")&&<section className={styles.card}><h2>Recorded programme outcomes</h2>
          <p className={styles.muted}>Organisation-wide recorded milestones among currently consenting participants. Each participant is counted once per milestone. These are not estimates of income, employment or causal impact.</p>
          {data.outcomes?<><div className={styles.rows}><div className={styles.row}><span>Consenting participants</span><strong>{data.outcomes.participants??"Withheld"}</strong></div>
            {data.outcomes.metrics.map(m=><div className={styles.row} key={m.key}><span>{outcomeLabels[m.key]??m.key}</span><strong>{m.suppressed?"Withheld":m.count}</strong></div>)}</div>
            <p className={styles.muted}>A milestone is withheld unless both the recorded and remaining groups contain at least {data.outcomes.minimumCellSize} participants. Counts may change after consent withdrawal.</p></>:<p className={styles.muted}>Outcomes unavailable.</p>}
        </section>}
        {((manager&&tab==="Business activation")||org?.role==="REPORT_VIEWER")&&<section className={styles.card}><h2>Business activation</h2><p className={styles.muted}>Organisation-wide count of consenting participants with an active, linked business. Business names, sales and financial records are not shared.</p>
          {data.businessSummary?.suppressed?<p className={styles.muted} role="status">Aggregate withheld to protect small groups.</p>:data.businessSummary?<div className={styles.metrics}><div className={styles.row}><strong>{data.businessSummary.participants}</strong><span>Consenting participants</span></div><div className={styles.row}><strong>{data.businessSummary.linked}</strong><span>Participants with a linked business</span></div></div>:<p className={styles.muted}>Summary unavailable.</p>}
        </section>}
        {selected&&data.self&&!data.self.withdrawnAt&&<section className={styles.card}><h2>My business</h2><p className={styles.muted}>Start or manage your independent business in TradeOS. Use the same email or phone and password. Linking is optional and only contributes to an aggregate activation count; your business name, records, sales and finances are not shared with programme administrators.</p>
          <div className={styles.actions}><a className="tos-btn tos-btn--primary" href="/" target="_blank" rel="noopener noreferrer">Open business workspace</a><Button variant="outline" disabled={busy} onClick={()=>{if(org)void run(()=>load(org));}}>Refresh my businesses</Button></div>
          {data.businesses.length?data.businesses.map(b=><div className={styles.row} key={b.id}><strong>{b.name}</strong><span>{b.linkId?"Linked to programme":"Not linked"}</span>{b.linkId&&<Button variant="outline" disabled={busy} onClick={()=>setUnlinkTarget(b)}>Remove business link</Button>}</div>):<p className={styles.muted}>No active businesses owned by this account. Open the business workspace to create one, then refresh here.</p>}
          {data.businesses.some(b=>!b.linkId)&&<form className={styles.form} onSubmit={submit(()=>void write("/businesses/link",{businessId:businessToLink,consentVersion:"v1",consent:businessConsent},"Business linked.",()=>{setBusinessToLink("");setBusinessConsent(false);}))}>
            <label>Owned business<select aria-label="Owned business" className="tos-select" required value={businessToLink} onChange={e=>{setBusinessToLink(e.target.value);setBusinessConsent(false);}} disabled={busy}><option value="">Select business</option>{data.businesses.filter(b=>!b.linkId).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className={styles.check}><input type="checkbox" required checked={businessConsent} onChange={e=>setBusinessConsent(e.target.checked)} disabled={busy}/>I consent to include my business activation in the programme aggregate.</label>
            <Button type="submit" variant="primary" loading={busy} disabled={!businessConsent||!businessToLink}>Link my business</Button>
          </form>}
        </section>}
        {unlinkTarget&&<div className={styles.modalBackdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="unlink-business-title"><h2 id="unlink-business-title">Remove business link</h2><p>{unlinkTarget.name}</p><p className={styles.muted}>Your business account, stock and financial records remain unchanged. The programme will no longer count this link.</p><div className={styles.actions}><Button variant="outline" disabled={busy} onClick={()=>setUnlinkTarget(null)}>Back</Button><Button variant="primary" loading={busy} onClick={()=>{if(unlinkTarget.linkId)void write("/businesses/unlink",{linkId:unlinkTarget.linkId},"Business link removed.",()=>setUnlinkTarget(null));}}>Confirm</Button></div></section></div>}
        {selected&&<section className={styles.card}><h2>Financial literacy learning centre</h2><p className={styles.muted}>Build practical business skills. Your practice answers are private and do not determine grant eligibility.</p>
          {data.lessons.length?<div className={styles.form}>
            <label>Choose lesson<select aria-label="Choose lesson" className="tos-select" value={selectedLesson} onChange={e=>{setSelectedLesson(e.target.value);setAnswer("");}} disabled={busy}><option value="">Select lesson</option>{data.lessons.map(l=><option value={l.id} key={l.id}>{l.title+" · v"+l.version+(l.passed?" · Completed":"")}</option>)}</select></label>
            {activeLesson&&<><div className={styles.row}><strong>{activeLesson.title}</strong><span>{literacyTopics[activeLesson.topic]??activeLesson.topic} · {activeLesson.passed?"Completed":"Practice pending"} · {activeLesson.attempts??0} attempt(s)</span></div><p className={styles.lessonText}>{activeLesson.lessonText}</p>
              <form className={styles.form} onSubmit={submit(()=>{if(activeLesson.enrolmentId&&answer!=="")void write("/literacy/attempts",{lessonId:activeLesson.id,enrolmentId:activeLesson.enrolmentId,answerOption:Number(answer)},r=>r.passed?"Correct answer. Lesson completed.":"Not quite. Review the lesson and try again.",()=>setAnswer(""));})}>
                <fieldset className={styles.question}><legend>{activeLesson.question}</legend>{activeLesson.options.map((option,i)=><label className={styles.check} key={i}><input type="radio" name="literacy-answer" value={i} checked={answer===String(i)} onChange={()=>setAnswer(String(i))} disabled={busy} required/>{option}</label>)}</fieldset>
                <Button type="submit" variant="primary" loading={busy} disabled={answer===""}>Submit answer</Button>
              </form></>}
          </div>:<p className={styles.muted}>No lessons assigned yet.</p>}
        </section>}
        {selected&&<section className={styles.card}><h2>My startup equipment</h2>{data.allocations.length?data.allocations.map(a=><div className={styles.row} key={a.id}><strong>{a.equipmentName}</strong><span>{a.assetCode+" · "+a.condition+" · "+a.status.replaceAll("_"," ")}</span>{a.handedOverAt&&<span>Receipt confirmed: {new Date(a.handedOverAt).toLocaleDateString()}</span>}{a.status==="APPROVED"&&<Button variant="primary" disabled={busy} onClick={()=>setEquipmentAction({id:a.id,action:"ACKNOWLEDGE",name:a.equipmentName})}>Confirm equipment received</Button>}</div>):<p className={styles.muted}>No equipment allocated yet.</p>}</section>}
        {equipmentAction&&<div className={styles.modalBackdrop}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="equipment-action-title"><h2 id="equipment-action-title">{equipmentAction.action==="APPROVE"?"Approve allocation":equipmentAction.action==="CANCEL"?"Cancel reservation":"Confirm physical receipt"}</h2><p>{equipmentAction.name}</p><p className={styles.muted}>{equipmentAction.action==="ACKNOWLEDGE"?"Confirm only if the equipment has actually been handed over to you. This records your receipt.":equipmentAction.action==="CANCEL"?"This releases the equipment for another reservation.":"This approves the reservation for handover; it does not confirm delivery."}</p><div className={styles.actions}><Button variant="outline" disabled={busy} onClick={()=>setEquipmentAction(null)}>Back</Button><Button variant="primary" loading={busy} onClick={()=>{const a=equipmentAction;void write("/equipment/transitions",{allocationId:a.id,action:a.action},a.action==="APPROVE"?"Allocation approved.":a.action==="CANCEL"?"Reservation cancelled.":"Equipment receipt confirmed.",()=>setEquipmentAction(null));}}>Confirm</Button></div></section></div>}
        {selected&&<section className={styles.card}><h2>My training</h2>{list(data.placements.map(p=>({id:p.id,title:p.pathwayName,subtitle:p.mentorName+" · "+p.plannedHours+" hours · "+p.status.replaceAll("_"," ")})),"No training placements yet.")}</section>}
        {selected&&<div className={styles.grid}><section className={styles.card}><h2>My participation</h2>{data.self?<><p>{data.self.displayName}</p><p className={styles.muted}>{data.self.withdrawnAt?"Consent withdrawn":"Consent recorded"}</p>{!data.self.withdrawnAt&&<Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm("Withdraw programme participation consent? Active participation and aggregate reporting will stop. Audit and equipment accountability records are retained."))void write("/participants/self/withdraw",{},"Consent withdrawn.");}}>Withdraw consent</Button>}</>:<form className={styles.form} onSubmit={submit(()=>void write("/participants/self",{displayName:displayName.trim(),consentVersion:"v1",adultConfirmed:adult,consent},"Participation consent recorded."))}><label>Display name<input className="tos-input" required maxLength={160} value={displayName} onChange={e=>setDisplayName(e.target.value)} disabled={busy}/></label><p className={styles.muted}>Your programme coordinators can view your display name, enrolments, training placement and equipment allocation. Your assigned mentor can see your name and training placement to support your training. Individual literacy practice results are private; authorised programme staff can see privacy-limited aggregate milestones. Your independent business records are not shared. You can withdraw participation consent at any time; active participation and reporting will stop, but audit and equipment accountability records are retained.</p><label className={styles.check}><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)} disabled={busy} required/>I am an adult.</label><label className={styles.check}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy} required/>I agree to participate and share this profile with my programme coordinators.</label><Button type="submit" variant="primary" disabled={!adult||!consent} loading={busy}>Confirm participation</Button></form>}</section><section className={styles.card}><h2>My enrolments</h2>{list(data.enrolments.map(e=>({id:e.id,title:e.programmeName,subtitle:e.cohortName})),"No active enrolments.")}</section></div>}
        {org&&!manager&&!selected&&!mentor&&org.role!=="REPORT_VIEWER"&&<section className={styles.card}><h2>Workspace access</h2><p>This role has no available programme actions yet.</p></section>}
      </>}
    </div>
  </main>;
}
