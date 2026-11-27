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
