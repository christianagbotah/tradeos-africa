import { randomUUID } from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
process.env.DATABASE_URL??="postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE programme_organisations,app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});
async function user(key:string){
  const r=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Synthetic "+key,email:key+"@tradeos.test",password:"Programme-QA-1234!",
    platform:"WEB",deviceKey:key,appVersion:"test"}});
  expect(r.statusCode).toBe(201);
  return {id:r.json().user.id as string,headers:{authorization:"Bearer "+r.json().session.accessToken}};
}
async function fixture(){
  const admin=await user("programme-admin"),foreign=await user("programme-foreign"),person=await user("programme-person"),
    second=await user("programme-second"),mentor=await user("programme-mentor"),merchant=await user("programme-merchant");
  const org=(await pool.query<{id:string}>("INSERT INTO programme_organisations(name) VALUES('Synthetic Training A') RETURNING id")).rows[0]!.id;
  const other=(await pool.query<{id:string}>("INSERT INTO programme_organisations(name) VALUES('Synthetic Training B') RETURNING id")).rows[0]!.id;
  for(const [o,u,role] of [[org,admin.id,"ORG_ADMIN"],[other,foreign.id,"ORG_ADMIN"],[org,person.id,"PARTICIPANT"],[org,second.id,"PARTICIPANT"],[org,mentor.id,"MENTOR"]])
    await pool.query("INSERT INTO programme_memberships(organisation_id,user_id,role) VALUES($1,$2,$3)",[o,u,role]);
  const post=(actor:typeof admin,base:string,path:string,payload:Record<string,unknown>)=>app.inject({
    method:"POST",url:"/v1/programmes/"+base+"/"+path,headers:actor.headers,payload});
  const get=(actor:typeof admin,base:string,path:string)=>app.inject({method:"GET",url:"/v1/programmes/"+base+"/"+path,headers:actor.headers});
  const createProgramme=async(actor=admin,base=org)=>{
    const r=await post(actor,base,"programmes",{clientRequestId:randomUUID(),name:"Enterprise skills",objective:"Synthetic training"});
    expect(r.statusCode).toBe(201);return r.json().id as string;
  };
  const createCohort=async(programmeId:string,capacity=1)=>{
    const r=await post(admin,org,"cohorts",{clientRequestId:randomUUID(),programmeId,name:"Cohort A",capacity});
    expect(r.statusCode).toBe(201);return r.json().id as string;
  };
  const consent=async(actor=person)=>{
    const r=await post(actor,org,"participants/self",{clientRequestId:randomUUID(),displayName:"Fictional adult",
      consentVersion:"v1",adultConfirmed:true,consent:true});
    expect(r.statusCode).toBe(201);return r.json().id as string;
  };
  return {admin,foreign,person,second,mentor,merchant,org,other,post,get,createProgramme,createCohort,consent};
}
describe("independent opt-in programme foundation",()=>{
  it("requires explicit organisation membership, not merchant ownership",async()=>{
    const f=await fixture();
    const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",headers:f.merchant.headers,
      payload:{name:"Unrelated merchant",branchName:"Main",businessType:"RETAIL_HARDWARE"}});
    expect(onboard.statusCode).toBe(201);
    const result=await app.inject({method:"GET",url:"/v1/programmes/organisations",headers:f.merchant.headers});
    expect(result.json().organisations).toEqual([]);
    for(const actor of [f.merchant,f.foreign,f.mentor,f.person])
      expect((await f.get(actor,f.org,"programmes")).statusCode).toBe(403);
    expect((await f.get(f.admin,f.org,"programmes")).statusCode).toBe(200);
    const businessAccess=await app.inject({method:"GET",url:"/v1/catalog/items?businessId="+onboard.json().business.id,headers:f.admin.headers});
    expect(businessAccess.statusCode).toBe(403);
    const noAuth=await app.inject({method:"GET",url:"/v1/programmes/organisations"});
    expect(noAuth.statusCode).toBe(401);
  });
  it("serializes exact duplicate writes, rejects altered requests and prevents cross-org cohorts",async()=>{
    const f=await fixture(),clientRequestId=randomUUID();
    const payload={clientRequestId,name:"Enterprise skills"};
    const both=await Promise.all([f.post(f.admin,f.org,"programmes",payload),f.post(f.admin,f.org,"programmes",payload)]);
    expect(both.map(r=>r.statusCode)).toEqual([201,201]);
    expect(both[0]!.json().id).toBe(both[1]!.json().id);
    expect(both.map(r=>r.json().replayed).sort()).toEqual([false,true]);
    expect((await f.post(f.admin,f.org,"programmes",{...payload,name:"Altered"})).statusCode).toBe(409);
    const foreignId=await f.createProgramme(f.foreign,f.other);
    expect((await f.post(f.admin,f.org,"cohorts",{clientRequestId:randomUUID(),programmeId:foreignId,name:"Foreign",capacity:1})).statusCode).toBe(403);
    const audit=await pool.query("SELECT id FROM programme_audit_events WHERE organisation_id=$1 AND event_type='PROGRAMME_CREATED'",[f.org]);
    expect(audit.rowCount).toBe(1);
    expect((await f.get(f.admin,f.org,"programmes")).json().programmes).toHaveLength(1);
  });
  it("requires participant self-consent; enforces capacity, withdrawal and revocation",async()=>{
    const f=await fixture(),programme=await f.createProgramme(),cohortId=await f.createCohort(programme);
    const claim={clientRequestId:randomUUID(),displayName:"Fictional adult",consentVersion:"v1",adultConfirmed:true,consent:true};
    expect((await f.post(f.admin,f.org,"participants/self",claim)).statusCode).toBe(403);
    expect((await f.post(f.person,f.org,"participants/self",{...claim,consent:false})).statusCode).toBe(400);
    const participantId=await f.consent(),secondId=await f.consent(f.second);
    const payload={clientRequestId:randomUUID(),cohortId,participantId};
    const enrolled=await f.post(f.admin,f.org,"enrolments",payload);
    expect(enrolled.statusCode).toBe(201);
    expect((await f.post(f.admin,f.org,"enrolments",payload)).json().id).toBe(enrolled.json().id);
    expect((await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId,participantId:secondId})).statusCode).toBe(409);
    expect((await f.get(f.admin,f.org,"participants")).json().participants).toHaveLength(2);
    expect((await f.post(f.person,f.org,"participants/self/withdraw",{clientRequestId:randomUUID()})).statusCode).toBe(200);
    expect((await f.get(f.admin,f.org,"participants")).json().participants.map((p:{id:string})=>p.id)).toEqual([secondId]);
    const newCohort=await f.createCohort(programme);
    expect((await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId:newCohort,participantId})).statusCode).toBe(403);
    await pool.query("UPDATE programme_memberships SET status='REVOKED' WHERE organisation_id=$1 AND user_id=$2",[f.org,f.admin.id]);
    expect((await f.post(f.admin,f.org,"enrolments",payload)).statusCode).toBe(403);
    expect((await pool.query("SELECT id FROM programme_enrolments WHERE organisation_id=$1",[f.org])).rowCount).toBe(1);
  });
});

describe("apprenticeship pathway and mentor scope",()=>{
  it("assigns an enrolled participant to a same-cohort pathway and restricts progress to the assigned mentor",async()=>{
    const f=await fixture(),programme=await f.createProgramme(),cohortId=await f.createCohort(programme,2);
    const participantId=await f.consent();
    const enrol=(await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId,participantId})).json().id;
    const pathway=await f.post(f.admin,f.org,"training/pathways",{clientRequestId:randomUUID(),cohortId,name:"Tailoring basics",description:"Practical training",plannedHours:40});
    expect(pathway.statusCode).toBe(201);
    const pathwayId=pathway.json().id;
    const payload={clientRequestId:randomUUID(),pathwayId,enrolmentId:enrol,mentorId:f.mentor.id};
    expect((await f.post(f.admin,f.org,"training/placements",{...payload,mentorId:f.foreign.id})).statusCode).toBe(403);
    const placement=await f.post(f.admin,f.org,"training/placements",payload);
    expect(placement.statusCode).toBe(201);
    const placementId=placement.json().id;
    expect((await f.post(f.admin,f.org,"training/placements",payload)).json().id).toBe(placementId);
    const unassigned=await user("unassigned-mentor");
    await pool.query("INSERT INTO programme_memberships(organisation_id,user_id,role) VALUES($1,$2,'MENTOR')",[f.org,unassigned.id]);
    expect((await f.get(unassigned,f.org,"training/placements")).json().placements).toEqual([]);
    expect((await f.get(f.second,f.org,"training/placements")).json().placements).toEqual([]);
    expect((await f.get(f.person,f.org,"training/placements")).json().placements[0].id).toBe(placementId);
    expect((await f.get(f.mentor,f.org,"training/placements")).json().placements[0].id).toBe(placementId);
    const progress={clientRequestId:randomUUID(),placementId,status:"IN_PROGRESS",note:"Started practical training"};
    expect((await f.post(f.person,f.org,"training/progress",progress)).statusCode).toBe(403);
    expect((await f.post(unassigned,f.org,"training/progress",progress)).statusCode).toBe(403);
    expect((await f.post(f.mentor,f.org,"training/progress",{...progress,status:"COMPLETED"})).statusCode).toBe(409);
    expect((await f.post(f.mentor,f.org,"training/progress",progress)).statusCode).toBe(201);
    const done={clientRequestId:randomUUID(),placementId,status:"COMPLETED",note:"Practical milestone completed"};
    const result=await f.post(f.mentor,f.org,"training/progress",done);
    expect(result.statusCode).toBe(201);
    expect((await f.post(f.mentor,f.org,"training/progress",done)).json().id).toBe(result.json().id);
    expect((await f.get(f.person,f.org,"training/placements")).json().placements[0].status).toBe("COMPLETED");
    expect((await pool.query("SELECT id FROM programme_training_progress WHERE organisation_id=$1",[f.org])).rowCount).toBe(2);
    await f.post(f.person,f.org,"participants/self/withdraw",{clientRequestId:randomUUID()});
    expect((await f.get(f.mentor,f.org,"training/placements")).json().placements).toEqual([]);
    expect((await f.post(f.mentor,f.org,"training/progress",done)).statusCode).toBe(403);
  });
});

describe("startup equipment custody and participant handover",()=>{
  it("prevents double allocation, foreign access and self-approval; records one acknowledged handover",async()=>{
    const f=await fixture(),coordinator=await user("equipment-coordinator");
    await pool.query("INSERT INTO programme_memberships(organisation_id,user_id,role) VALUES($1,$2,'COORDINATOR')",[f.org,coordinator.id]);
    const programme=await f.createProgramme(),cohortId=await f.createCohort(programme,2),participantId=await f.consent(),secondId=await f.consent(f.second);
    const enrol=await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId,participantId});
    const otherEnrol=await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId,participantId:secondId});
    const unit=await f.post(coordinator,f.org,"equipment/units",{clientRequestId:randomUUID(),assetCode:"QA-SEW-01",name:"Sewing machine",condition:"NEW"});
    expect(unit.statusCode).toBe(201);const equipmentId=unit.json().id;
    const reserve={clientRequestId:randomUUID(),equipmentId,enrolmentId:enrol.json().id};
    const allocation=await f.post(coordinator,f.org,"equipment/allocations",reserve);
    expect(allocation.statusCode).toBe(201);const allocationId=allocation.json().id;
    expect((await f.post(coordinator,f.org,"equipment/allocations",reserve)).json().id).toBe(allocationId);
    expect((await f.post(coordinator,f.org,"equipment/allocations",{...reserve,clientRequestId:randomUUID(),enrolmentId:otherEnrol.json().id})).statusCode).toBe(409);
    expect((await f.get(f.foreign,f.org,"equipment/allocations")).statusCode).toBe(403);
    expect((await f.get(f.second,f.org,"equipment/allocations")).json().allocations).toEqual([]);
    const approval={clientRequestId:randomUUID(),allocationId,action:"APPROVE"};
    expect((await f.post(coordinator,f.org,"equipment/transitions",approval)).statusCode).toBe(403);
    const ack={clientRequestId:randomUUID(),allocationId,action:"ACKNOWLEDGE"};
    expect((await f.post(f.person,f.org,"equipment/transitions",ack)).statusCode).toBe(409);
    expect((await f.post(f.admin,f.org,"equipment/transitions",approval)).statusCode).toBe(201);
    expect((await f.post(f.second,f.org,"equipment/transitions",ack)).statusCode).toBe(403);
    expect((await f.post(f.person,f.org,"equipment/transitions",ack)).statusCode).toBe(201);
    expect((await f.post(f.person,f.org,"equipment/transitions",ack)).json().replayed).toBe(true);
    const handed=(await f.get(f.person,f.org,"equipment/allocations")).json().allocations[0];
    expect(handed.status).toBe("HANDED_OVER");expect(handed.handedOverAt).toBeTruthy();
    expect((await f.post(f.admin,f.org,"equipment/transitions",{clientRequestId:randomUUID(),allocationId,action:"CANCEL"})).statusCode).toBe(409);
    expect((await pool.query("SELECT id FROM programme_audit_events WHERE organisation_id=$1 AND event_type='EQUIPMENT_ACKNOWLEDGE'",[f.org])).rowCount).toBe(1);
    const adminUnit=await f.post(f.admin,f.org,"equipment/units",{clientRequestId:randomUUID(),assetCode:"QA-SEW-02",name:"Second machine",condition:"GOOD"});
    const adminAllocation=await f.post(f.admin,f.org,"equipment/allocations",{clientRequestId:randomUUID(),equipmentId:adminUnit.json().id,enrolmentId:enrol.json().id});
    expect((await f.post(f.admin,f.org,"equipment/transitions",{clientRequestId:randomUUID(),allocationId:adminAllocation.json().id,action:"APPROVE"})).statusCode).toBe(403);
    expect((await f.post(f.admin,f.org,"equipment/transitions",{clientRequestId:randomUUID(),allocationId:adminAllocation.json().id,action:"CANCEL"})).statusCode).toBe(201);
    expect((await f.get(f.admin,f.org,"equipment/units")).json().units.find((x:{assetCode:string})=>x.assetCode==="QA-SEW-02").status).toBe("AVAILABLE");
  });
});

describe("financial literacy lesson versions and participant practice",()=>{
  it("publishes immutable cohort lessons and grades only the participant's own attempts",async()=>{
    const f=await fixture(),programme=await f.createProgramme(),cohortId=await f.createCohort(programme,2),participantId=await f.consent(),secondId=await f.consent(f.second);
    const enrol=await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId,participantId});
    const second=await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId,participantId:secondId});
    const payload={clientRequestId:randomUUID(),cohortId,title:"Daily cash records",topic:"RECORD_KEEPING",
      lessonText:"Record each sale and expense. Sales of 100 cedis minus costs of 60 cedis leave 40 cedis before other expenses.",
      question:"What remains before other expenses?",options:["20 cedis","40 cedis","100 cedis"],correctOption:1,version:1};
    expect((await f.post(f.person,f.org,"literacy/lessons",payload)).statusCode).toBe(403);
    const created=await f.post(f.admin,f.org,"literacy/lessons",payload);
    expect(created.statusCode).toBe(201);const lessonId=created.json().id;
    expect((await f.post(f.admin,f.org,"literacy/lessons",payload)).json().id).toBe(lessonId);
    expect((await f.post(f.admin,f.org,"literacy/lessons",{...payload,clientRequestId:randomUUID(),version:3})).statusCode).toBe(409);
    expect((await f.get(f.foreign,f.org,"literacy/lessons")).statusCode).toBe(403);
    expect((await f.get(f.mentor,f.org,"literacy/lessons")).statusCode).toBe(403);
    const visible=(await f.get(f.person,f.org,"literacy/lessons")).json().lessons[0];
    expect(visible.id).toBe(lessonId);expect(visible).not.toHaveProperty("correctOption");expect(visible).not.toHaveProperty("correct_option");
    const attempt={clientRequestId:randomUUID(),lessonId,enrolmentId:enrol.json().id,answerOption:0};
    expect((await f.post(f.second,f.org,"literacy/attempts",attempt)).statusCode).toBe(403);
    expect((await f.post(f.person,f.org,"literacy/attempts",{...attempt,enrolmentId:second.json().id})).statusCode).toBe(403);
    const wrong=await f.post(f.person,f.org,"literacy/attempts",attempt);
    expect(wrong.statusCode).toBe(201);expect(wrong.json().passed).toBe(false);
    expect((await f.post(f.person,f.org,"literacy/attempts",attempt)).json().id).toBe(wrong.json().id);
    expect((await f.post(f.person,f.org,"literacy/attempts",{...attempt,answerOption:1})).statusCode).toBe(409);
    const right=await f.post(f.person,f.org,"literacy/attempts",{...attempt,clientRequestId:randomUUID(),answerOption:1});
    expect(right.statusCode).toBe(201);expect(right.json().passed).toBe(true);
    const completed=(await f.get(f.person,f.org,"literacy/lessons")).json().lessons[0];
    expect(completed.passed).toBe(true);expect(completed.attempts).toBe(2);
    expect((await f.get(f.second,f.org,"literacy/lessons")).json().lessons[0].attempts).toBe(0);
    expect((await f.post(f.admin,f.org,"literacy/lessons",{...payload,clientRequestId:randomUUID(),version:2})).statusCode).toBe(201);
    expect((await f.get(f.person,f.org,"literacy/lessons")).json().lessons).toHaveLength(2);
    await f.post(f.person,f.org,"participants/self/withdraw",{clientRequestId:randomUUID()});
    expect((await f.get(f.person,f.org,"literacy/lessons")).json().lessons).toEqual([]);
    expect((await f.post(f.person,f.org,"literacy/attempts",attempt)).statusCode).toBe(403);
  });
});

describe("participant owned business consent and aggregate disclosure",()=>{
  it("links only the participant's owned merchant, denies sponsor access and revokes on withdrawal",async()=>{
    const f=await fixture();await f.consent();await f.consent(f.second);
    const onboard=async(actor:typeof f.person,name:string)=>{
      const result=await app.inject({method:"POST",url:"/v1/onboarding/business",headers:actor.headers,payload:{name,branchName:"Main",businessType:"SERVICES"}});
      expect(result.statusCode).toBe(201);return result.json().business.id as string;
    };
    const own=await onboard(f.person,"Fictional workshop"),foreign=await onboard(f.second,"Other workshop");
    const list=await f.get(f.person,f.org,"businesses/self");
    expect(list.json().businesses.map((x:{id:string})=>x.id)).toEqual([own]);
    expect((await f.get(f.admin,f.org,"businesses/self")).statusCode).toBe(403);
    expect((await f.get(f.foreign,f.org,"businesses/summary")).statusCode).toBe(403);
    const payload={clientRequestId:randomUUID(),businessId:own,consentVersion:"v1",consent:true};
    expect((await f.post(f.admin,f.org,"businesses/link",payload)).statusCode).toBe(403);
    expect((await f.post(f.person,f.org,"businesses/link",{...payload,businessId:foreign})).statusCode).toBe(403);
    expect((await f.post(f.person,f.org,"businesses/link",{...payload,consent:false})).statusCode).toBe(400);
    const result=await f.post(f.person,f.org,"businesses/link",payload);
    expect(result.statusCode).toBe(201);const linkId=result.json().id;
    expect((await f.post(f.person,f.org,"businesses/link",payload)).json().id).toBe(linkId);
    expect((await f.post(f.person,f.org,"businesses/link",{...payload,clientRequestId:randomUUID()})).statusCode).toBe(409);
    expect((await f.get(f.person,f.org,"businesses/self")).json().businesses[0].linkId).toBe(linkId);
    const summary=await f.get(f.admin,f.org,"businesses/summary");
    expect(summary.json()).toEqual({suppressed:true,minimumCellSize:5,participants:null,linked:null});
    const context=await app.inject({method:"GET",url:"/v1/businesses/"+own+"/context",headers:f.admin.headers});
    expect(context.statusCode).toBe(403);
    expect((await f.post(f.second,f.org,"businesses/unlink",{clientRequestId:randomUUID(),linkId})).statusCode).toBe(403);
    const revoke={clientRequestId:randomUUID(),linkId};
    expect((await f.post(f.person,f.org,"businesses/unlink",revoke)).statusCode).toBe(201);
    expect((await f.post(f.person,f.org,"businesses/unlink",revoke)).json().replayed).toBe(true);
    expect((await f.get(f.person,f.org,"businesses/self")).json().businesses[0].linkId).toBeNull();
    expect((await f.post(f.person,f.org,"businesses/link",{...payload,clientRequestId:randomUUID()})).statusCode).toBe(201);
    await f.post(f.person,f.org,"participants/self/withdraw",{clientRequestId:randomUUID()});
    expect((await f.get(f.person,f.org,"businesses/self")).json().businesses).toEqual([]);
    expect((await f.post(f.person,f.org,"businesses/link",payload)).statusCode).toBe(403);
    expect((await pool.query("SELECT id FROM programme_business_links WHERE organisation_id=$1 AND revoked_at IS NULL",[f.org])).rowCount).toBe(0);
    expect((await app.inject({method:"GET",url:"/v1/businesses/"+own+"/context",headers:f.person.headers})).statusCode).toBe(200);
    expect((await pool.query("SELECT id FROM business_memberships WHERE business_id=$1",[own])).rowCount).toBe(1);
  });
});

describe("privacy-limited recorded programme outcomes",()=>{
  it("counts distinct consenting participants, suppresses both small cells and rejects slicing or unauthorized viewers",async()=>{
    const f=await fixture(),viewer=await user("outcome-viewer");
    await pool.query("INSERT INTO programme_memberships(organisation_id,user_id,role) VALUES($1,$2,'REPORT_VIEWER')",[f.org,viewer.id]);
    const actors=[f.person,f.second];
    for(let i=0;i<8;i++){
      const actor=await user("outcome-person-"+i);
      await pool.query("INSERT INTO programme_memberships(organisation_id,user_id,role) VALUES($1,$2,'PARTICIPANT')",[f.org,actor.id]);
      actors.push(actor);
    }
    const ids:string[]=[];
    for(const actor of actors)ids.push(await f.consent(actor));
    const programme=await f.createProgramme(),cohort=await f.createCohort(programme,10),secondCohort=await f.createCohort(programme,10);
    for(const participantId of ids.slice(0,5)){
      expect((await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId:cohort,participantId})).statusCode).toBe(201);
    }
    expect((await f.post(f.admin,f.org,"enrolments",{clientRequestId:randomUUID(),cohortId:secondCohort,participantId:ids[0]})).statusCode).toBe(201);
    const response=await f.get(viewer,f.org,"outcomes");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({minimumCellSize:5,participants:10,metrics:[
      {key:"enrolled",count:5,suppressed:false},{key:"trained",count:null,suppressed:true},
      {key:"equipped",count:null,suppressed:true},{key:"learned",count:null,suppressed:true}
    ]});
    expect((await f.get(f.admin,f.org,"outcomes")).json()).toEqual(response.json());
    for(const actor of [f.person,f.mentor,f.foreign,f.merchant])expect((await f.get(actor,f.org,"outcomes")).statusCode).toBe(403);
    expect((await f.get(viewer,f.org,"outcomes?cohortId="+cohort)).statusCode).toBe(400);
    expect((await f.get(viewer,f.org,"participants")).statusCode).toBe(403);
    expect((await f.post(f.person,f.org,"participants/self/withdraw",{clientRequestId:randomUUID()})).statusCode).toBe(200);
    const after=(await f.get(viewer,f.org,"outcomes")).json();
    expect(after.participants).toBeNull();
    expect(after.metrics.every((m:{count:number|null;suppressed:boolean})=>m.count===null&&m.suppressed)).toBe(true);
  });
});
