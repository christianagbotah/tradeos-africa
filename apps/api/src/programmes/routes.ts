import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const managers=["ORG_ADMIN","COORDINATOR"];
const denied=()=>new AuthError("Programme access unavailable",403,"PROGRAMME_ACCESS_DENIED");
const invalid=(message:string)=>new AuthError(message,400,"PROGRAMME_INVALID");
const conflict=(message:string)=>new AuthError(message,409,"PROGRAMME_CONFLICT");
function identifier(value:unknown):string{
  if(typeof value!=="string"||!uuid.test(value))throw invalid("Valid identifier required");
  return value.toLowerCase();
}
function str(value:unknown,max:number,optional=false):string{
  if(value===undefined&&optional)return "";
  if(typeof value!=="string"||value.length>max||(!optional&&!value.trim())||/[\u0000-\u001f\u007f]/.test(value))throw invalid("Invalid text field");
  return value.trim();
}
function body(req:FastifyRequest,allowed:string[]):Record<string,unknown>{
  const b=req.body;
  if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k)))throw invalid("Invalid request fields");
  return b as Record<string,unknown>;
}
async function access(client:DatabaseClient,org:string,user:string,roles:string[]){
  // Lock current membership and organisation through the operation. No access
  // derives from business membership, branch selection or client-supplied roles.
  const r=await client.query<{role:string}>(`SELECT m.role FROM programme_memberships m
    JOIN programme_organisations o ON o.id=m.organisation_id
    WHERE m.organisation_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND o.status='ACTIVE'
    FOR SHARE OF m,o`,[org,user]);
  if(!r.rows[0]||!roles.includes(r.rows[0].role))throw denied();
  return r.rows[0].role;
}
async function write(client:DatabaseClient,org:string,user:string,requestId:string,event:string,fields:unknown,
  insert:()=>Promise<string>){
  const fingerprint=createHash("sha256").update(JSON.stringify([event,fields])).digest("hex");
  // Serialize only the same actor/request within the same organisation.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[org+":"+user+":"+requestId]);
  const prior=await client.query<{fingerprint:string;entity_id:string}>(
    "SELECT fingerprint,entity_id FROM programme_requests WHERE organisation_id=$1 AND actor_user_id=$2 AND request_id=$3",
    [org,user,requestId]);
  if(prior.rows[0]){
    if(prior.rows[0].fingerprint!==fingerprint)throw conflict("Request identifier already used for different details");
    return {id:prior.rows[0].entity_id,replayed:true};
  }
  const id=await insert();
  await client.query("INSERT INTO programme_requests(organisation_id,actor_user_id,request_id,fingerprint,entity_id) VALUES($1,$2,$3,$4,$5)",[org,user,requestId,fingerprint,id]);
  await client.query("INSERT INTO programme_audit_events(organisation_id,actor_user_id,event_type,entity_id) VALUES($1,$2,$3,$4)",[org,user,event,id]);
  return {id,replayed:false};
}
export function registerProgrammeRoutes(app:FastifyInstance,pool:DatabasePool){
  async function handle(req:FastifyRequest,reply:FastifyReply,work:(client:DatabaseClient,user:string)=>Promise<unknown>,status=200){
    reply.header("Cache-Control","no-store");
    try{
      const auth=await authenticateAccessToken(pool,req.headers.authorization);
      const result=await withTransaction(pool,client=>work(client,auth.userId));
      return reply.code(status).send(result);
    }catch(e){
      if(e instanceof AuthError)return reply.code(e.statusCode).send({error:e.code,message:e.message});
      if((e as {code?:string})?.code==="23505")return reply.code(409).send({error:"PROGRAMME_CONFLICT",message:"A matching record already exists."});
      // Never log participant request bodies or database error details.
      req.log.error("Programme operation failed");
      return reply.code(500).send({error:"PROGRAMME_FAILED",message:"Programme operation could not be completed"});
    }
  }
  const orgOf=(req:FastifyRequest)=>identifier((req.params as {orgId?:unknown}).orgId);
  app.get("/v1/programmes/organisations",(req,reply)=>handle(req,reply,async(c,u)=>{
    const r=await c.query(`SELECT o.id,o.name,m.role FROM programme_organisations o
      JOIN programme_memberships m ON m.organisation_id=o.id
      WHERE m.user_id=$1 AND m.status='ACTIVE' AND o.status='ACTIVE' ORDER BY o.name,o.id LIMIT 100`,[u]);
    return {organisations:r.rows};
  }));
  app.get("/v1/programmes/:orgId/programmes",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const r=await c.query("SELECT id,name,objective,status,created_at AS \"createdAt\" FROM programmes WHERE organisation_id=$1 ORDER BY created_at DESC,id LIMIT 100",[org]);
    return {programmes:r.rows};
  }));
  app.post("/v1/programmes/:orgId/programmes",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","name","objective"]);
    const requestId=identifier(b.clientRequestId),name=str(b.name,160),objective=str(b.objective,1000,true);
    return write(c,org,u,requestId,"PROGRAMME_CREATED",{name,objective},async()=>{
      const r=await c.query<{id:string}>("INSERT INTO programmes(organisation_id,name,objective) VALUES($1,$2,$3) RETURNING id",[org,name,objective]);
      return r.rows[0]!.id;
    });
  },201));
  app.get("/v1/programmes/:orgId/cohorts",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const r=await c.query("SELECT id,programme_id AS \"programmeId\",name,capacity FROM programme_cohorts WHERE organisation_id=$1 ORDER BY created_at DESC,id LIMIT 100",[org]);
    return {cohorts:r.rows};
  }));
  app.post("/v1/programmes/:orgId/cohorts",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","programmeId","name","capacity"]);
    const requestId=identifier(b.clientRequestId),programmeId=identifier(b.programmeId),name=str(b.name,160);
    const capacity=b.capacity;
    if(typeof capacity!=="number"||!Number.isInteger(capacity)||capacity<1||capacity>10000)throw invalid("Capacity must be 1–10000");
    return write(c,org,u,requestId,"COHORT_CREATED",{programmeId,name,capacity},async()=>{
      const found=await c.query("SELECT id FROM programmes WHERE organisation_id=$1 AND id=$2 AND status!='CLOSED' FOR SHARE",[org,programmeId]);
      if(!found.rowCount)throw denied();
      const r=await c.query<{id:string}>("INSERT INTO programme_cohorts(organisation_id,programme_id,name,capacity) VALUES($1,$2,$3,$4) RETURNING id",[org,programmeId,name,capacity]);
      return r.rows[0]!.id;
    });
  },201));
  // Organisation/membership provisioning is intentionally not exposed publicly.
  // Participant self-consent only; no administrator can impersonate a person.
  app.post("/v1/programmes/:orgId/participants/self",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const b=body(req,["clientRequestId","displayName","consentVersion","adultConfirmed","consent"]);
    const requestId=identifier(b.clientRequestId),displayName=str(b.displayName,160);
    if(b.consentVersion!=="v1"||b.adultConfirmed!==true||b.consent!==true)throw invalid("Adult participant consent required");
    return write(c,org,u,requestId,"PARTICIPANT_CONSENTED",{displayName,consentVersion:"v1"},async()=>{
      const r=await c.query<{id:string}>("INSERT INTO programme_participants(organisation_id,user_id,display_name,consent_version) VALUES($1,$2,$3,'v1') RETURNING id",[org,u,displayName]);
      return r.rows[0]!.id;
    });
  },201));
  app.get("/v1/programmes/:orgId/participants/self",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const r=await c.query("SELECT id,display_name AS \"displayName\",consent_version AS \"consentVersion\",consented_at AS \"consentedAt\",withdrawn_at AS \"withdrawnAt\" FROM programme_participants WHERE organisation_id=$1 AND user_id=$2",[org,u]);
    return {participant:r.rows[0]??null};
  }));
  app.post("/v1/programmes/:orgId/participants/self/withdraw",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const b=body(req,["clientRequestId"]),requestId=identifier(b.clientRequestId);
    return write(c,org,u,requestId,"PARTICIPANT_WITHDREW",{},async()=>{
      const r=await c.query<{id:string}>("UPDATE programme_participants SET withdrawn_at=now() WHERE organisation_id=$1 AND user_id=$2 AND withdrawn_at IS NULL RETURNING id",[org,u]);
      if(!r.rows[0])throw conflict("No active participant consent");
      return r.rows[0].id;
    });
  }));
  app.get("/v1/programmes/:orgId/participants",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const r=await c.query("SELECT id,display_name AS \"displayName\",consented_at AS \"consentedAt\" FROM programme_participants p WHERE organisation_id=$1 AND withdrawn_at IS NULL AND EXISTS (SELECT 1 FROM programme_memberships m WHERE m.organisation_id=p.organisation_id AND m.user_id=p.user_id AND m.status='ACTIVE' AND m.role='PARTICIPANT') ORDER BY consented_at DESC,id LIMIT 100", [org]);
    return {participants:r.rows};
  }));
  app.get("/v1/programmes/:orgId/enrolments",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);const role=await access(c,org,u,[...managers,"PARTICIPANT"]);
    const r=await c.query(`SELECT e.id,e.cohort_id AS "cohortId",c.name AS "cohortName",p.name AS "programmeName",
      e.participant_id AS "participantId",pp.display_name AS "displayName"
      FROM programme_enrolments e
      JOIN programme_cohorts c ON c.organisation_id=e.organisation_id AND c.id=e.cohort_id
      JOIN programmes p ON p.organisation_id=c.organisation_id AND p.id=c.programme_id
      JOIN programme_participants pp ON pp.organisation_id=e.organisation_id AND pp.id=e.participant_id
      JOIN programme_memberships m ON m.organisation_id=pp.organisation_id AND m.user_id=pp.user_id
      WHERE e.organisation_id=$1 AND pp.withdrawn_at IS NULL AND m.status='ACTIVE' AND m.role='PARTICIPANT'
        AND ($2::boolean OR pp.user_id=$3)
      ORDER BY e.created_at DESC,e.id LIMIT 100`,[org,managers.includes(role),u]);
    return {enrolments:r.rows};
  }));
  app.post("/v1/programmes/:orgId/enrolments",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","cohortId","participantId"]);
    const requestId=identifier(b.clientRequestId),cohortId=identifier(b.cohortId),participantId=identifier(b.participantId);
    return write(c,org,u,requestId,"PARTICIPANT_ENROLLED",{cohortId,participantId},async()=>{
      const cohort=await c.query<{capacity:number}>(`SELECT c.capacity FROM programme_cohorts c JOIN programmes p
        ON p.organisation_id=c.organisation_id AND p.id=c.programme_id
        WHERE c.organisation_id=$1 AND c.id=$2 AND p.status!='CLOSED' FOR UPDATE OF c`,[org,cohortId]);
      const person=await c.query(`SELECT p.id FROM programme_participants p JOIN programme_memberships m
        ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
        WHERE p.organisation_id=$1 AND p.id=$2 AND p.withdrawn_at IS NULL AND m.status='ACTIVE' AND m.role='PARTICIPANT' FOR SHARE OF p,m`,[org,participantId]);
      if(!cohort.rows[0]||!person.rowCount)throw denied();
      const count=await c.query<{count:string}>("SELECT count(*) AS count FROM programme_enrolments WHERE organisation_id=$1 AND cohort_id=$2",[org,cohortId]);
      if(Number(count.rows[0]!.count)>=cohort.rows[0].capacity)throw conflict("Cohort capacity reached");
      const r=await c.query<{id:string}>("INSERT INTO programme_enrolments(organisation_id,cohort_id,participant_id) VALUES($1,$2,$3) RETURNING id",[org,cohortId,participantId]);
      return r.rows[0]!.id;
    });
  },201));
  // Training roles are intentionally separate from merchant access.
  app.get("/v1/programmes/:orgId/training/mentors",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const r=await c.query(`SELECT m.user_id AS id,u.display_name AS "displayName"
      FROM programme_memberships m JOIN app_users u ON u.id=m.user_id
      WHERE m.organisation_id=$1 AND m.role='MENTOR' AND m.status='ACTIVE' AND u.status='ACTIVE'
      ORDER BY u.display_name,m.user_id LIMIT 100`,[org]);
    return {mentors:r.rows};
  }));
  app.get("/v1/programmes/:orgId/training/pathways",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const r=await c.query(`SELECT t.id,t.cohort_id AS "cohortId",c.name AS "cohortName",t.name,t.description,t.planned_hours AS "plannedHours"
      FROM programme_training_pathways t JOIN programme_cohorts c ON c.organisation_id=t.organisation_id AND c.id=t.cohort_id
      WHERE t.organisation_id=$1 ORDER BY t.created_at DESC,t.id LIMIT 100`,[org]);
    return {pathways:r.rows};
  }));
  app.post("/v1/programmes/:orgId/training/pathways",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","cohortId","name","description","plannedHours"]);
    const requestId=identifier(b.clientRequestId),cohortId=identifier(b.cohortId),name=str(b.name,160),description=str(b.description,1000,true),hours=b.plannedHours;
    if(typeof hours!=="number"||!Number.isInteger(hours)||hours<1||hours>10000)throw invalid("Planned hours must be 1–10000");
    return write(c,org,u,requestId,"TRAINING_PATHWAY_CREATED",{cohortId,name,description,hours},async()=>{
      const cohort=await c.query(`SELECT c.id FROM programme_cohorts c JOIN programmes p ON p.organisation_id=c.organisation_id AND p.id=c.programme_id
        WHERE c.organisation_id=$1 AND c.id=$2 AND p.status!='CLOSED' FOR SHARE OF c,p`,[org,cohortId]);
      if(!cohort.rowCount)throw denied();
      const r=await c.query<{id:string}>("INSERT INTO programme_training_pathways(organisation_id,cohort_id,name,description,planned_hours) VALUES($1,$2,$3,$4,$5) RETURNING id",[org,cohortId,name,description,hours]);
      return r.rows[0]!.id;
    });
  },201));
  app.post("/v1/programmes/:orgId/training/placements",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","pathwayId","enrolmentId","mentorId"]);
    const requestId=identifier(b.clientRequestId),pathwayId=identifier(b.pathwayId),enrolmentId=identifier(b.enrolmentId),mentorId=identifier(b.mentorId);
    return write(c,org,u,requestId,"TRAINING_PLACEMENT_ASSIGNED",{pathwayId,enrolmentId,mentorId},async()=>{
      const row=await c.query<{cohort_id:string}>(`SELECT e.cohort_id FROM programme_enrolments e
        JOIN programme_training_pathways t ON t.organisation_id=e.organisation_id AND t.cohort_id=e.cohort_id AND t.id=$3
        JOIN programme_participants pp ON pp.organisation_id=e.organisation_id AND pp.id=e.participant_id
        JOIN programme_memberships pm ON pm.organisation_id=pp.organisation_id AND pm.user_id=pp.user_id
        JOIN programme_memberships mm ON mm.organisation_id=e.organisation_id AND mm.user_id=$4
        JOIN app_users mu ON mu.id=mm.user_id
        JOIN programme_cohorts c ON c.organisation_id=e.organisation_id AND c.id=e.cohort_id
        JOIN programmes p ON p.organisation_id=c.organisation_id AND p.id=c.programme_id
        WHERE e.organisation_id=$1 AND e.id=$2 AND pp.withdrawn_at IS NULL AND pm.role='PARTICIPANT' AND pm.status='ACTIVE'
          AND mm.role='MENTOR' AND mm.status='ACTIVE' AND mu.status='ACTIVE' AND p.status!='CLOSED'
        FOR SHARE OF e,t,pp,pm,mm,mu,c,p`,[org,enrolmentId,pathwayId,mentorId]);
      if(!row.rows[0])throw denied();
      const r=await c.query<{id:string}>("INSERT INTO programme_training_placements(organisation_id,cohort_id,enrolment_id,pathway_id,mentor_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id",[org,row.rows[0].cohort_id,enrolmentId,pathwayId,mentorId]);
      return r.rows[0]!.id;
    });
  },201));
  app.get("/v1/programmes/:orgId/training/placements",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req),role=await access(c,org,u,[...managers,"MENTOR","PARTICIPANT"]);
    const r=await c.query(`SELECT t.id,t.status,p.name AS "pathwayName",p.planned_hours AS "plannedHours",
       pp.display_name AS "participantName",mu.display_name AS "mentorName",
       t.enrolment_id AS "enrolmentId",t.pathway_id AS "pathwayId"
      FROM programme_training_placements t
      JOIN programme_training_pathways p ON p.organisation_id=t.organisation_id AND p.cohort_id=t.cohort_id AND p.id=t.pathway_id
      JOIN programme_enrolments e ON e.organisation_id=t.organisation_id AND e.cohort_id=t.cohort_id AND e.id=t.enrolment_id
      JOIN programme_participants pp ON pp.organisation_id=e.organisation_id AND pp.id=e.participant_id
      JOIN programme_memberships pm ON pm.organisation_id=pp.organisation_id AND pm.user_id=pp.user_id
      JOIN programme_memberships mm ON mm.organisation_id=t.organisation_id AND mm.user_id=t.mentor_user_id
      JOIN app_users mu ON mu.id=mm.user_id
      WHERE t.organisation_id=$1 AND pp.withdrawn_at IS NULL AND pm.status='ACTIVE' AND pm.role='PARTICIPANT'
        AND mm.status='ACTIVE' AND mm.role='MENTOR' AND mu.status='ACTIVE'
        AND ($2::boolean OR ($3='MENTOR' AND t.mentor_user_id=$4) OR ($3='PARTICIPANT' AND pp.user_id=$4))
      ORDER BY t.created_at DESC,t.id LIMIT 100`,[org,managers.includes(role),role,u]);
    return {placements:r.rows};
  }));
  app.post("/v1/programmes/:orgId/training/progress",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req),role=await access(c,org,u,[...managers,"MENTOR"]);
    const b=body(req,["clientRequestId","placementId","status","note"]);
    const requestId=identifier(b.clientRequestId),placementId=identifier(b.placementId),status=b.status,note=str(b.note,500);
    if(status!=="IN_PROGRESS"&&status!=="COMPLETED")throw invalid("Invalid training status");
    // Recheck the live placement scope before idempotent replay too.
    const row=await c.query<{status:string}>(`SELECT t.status FROM programme_training_placements t
      JOIN programme_enrolments e ON e.organisation_id=t.organisation_id AND e.cohort_id=t.cohort_id AND e.id=t.enrolment_id
      JOIN programme_participants pp ON pp.organisation_id=e.organisation_id AND pp.id=e.participant_id
      JOIN programme_memberships pm ON pm.organisation_id=pp.organisation_id AND pm.user_id=pp.user_id
      JOIN programme_memberships mm ON mm.organisation_id=t.organisation_id AND mm.user_id=t.mentor_user_id
      JOIN programme_cohorts c ON c.organisation_id=e.organisation_id AND c.id=e.cohort_id
      JOIN programmes p ON p.organisation_id=c.organisation_id AND p.id=c.programme_id
      WHERE t.organisation_id=$1 AND t.id=$2 AND pp.withdrawn_at IS NULL AND pm.status='ACTIVE' AND pm.role='PARTICIPANT'
        AND mm.status='ACTIVE' AND mm.role='MENTOR' AND p.status!='CLOSED'
        AND ($3::boolean OR t.mentor_user_id=$4) FOR UPDATE OF t FOR SHARE OF pp,pm,mm,e,c,p`,[org,placementId,managers.includes(role),u]);
    if(!row.rows[0])throw denied();
    return write(c,org,u,requestId,"TRAINING_PROGRESS_RECORDED",{placementId,status,note},async()=>{
      if((row.rows[0]!.status==="ASSIGNED"&&status!=="IN_PROGRESS")||row.rows[0]!.status==="COMPLETED")throw conflict("Invalid training status transition");
      const r=await c.query<{id:string}>("INSERT INTO programme_training_progress(organisation_id,placement_id,actor_user_id,status,note) VALUES($1,$2,$3,$4,$5) RETURNING id",[org,placementId,u,status,note]);
      await c.query("UPDATE programme_training_placements SET status=$3 WHERE organisation_id=$1 AND id=$2",[org,placementId,status]);
      return r.rows[0]!.id;
    });
  },201));

}
