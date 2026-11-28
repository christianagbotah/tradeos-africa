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
      await c.query("UPDATE programme_business_links SET revoked_at=now() WHERE organisation_id=$1 AND participant_id=$2 AND revoked_at IS NULL",[org,r.rows[0].id]);
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

  // Grant assets are distinct from merchant stock and never post cash or ledger entries.
  app.get("/v1/programmes/:orgId/equipment/units",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const result=await c.query(`SELECT e.id,e.asset_code AS "assetCode",e.name,e.condition,
      COALESCE(a.status,'AVAILABLE') AS status FROM programme_equipment_units e
      LEFT JOIN programme_equipment_allocations a ON a.organisation_id=e.organisation_id AND a.equipment_id=e.id AND a.status<>'CANCELLED'
      WHERE e.organisation_id=$1 ORDER BY e.created_at DESC,e.id LIMIT 100`,[org]);
    return {units:result.rows};
  }));
  app.post("/v1/programmes/:orgId/equipment/units",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","assetCode","name","condition"]);
    const requestId=identifier(b.clientRequestId),assetCode=str(b.assetCode,80).toUpperCase(),name=str(b.name,160),condition=b.condition;
    if(condition!=="NEW"&&condition!=="GOOD"&&condition!=="REFURBISHED")throw invalid("Invalid equipment condition");
    return write(c,org,u,requestId,"EQUIPMENT_REGISTERED",{assetCode,name,condition},async()=>{
      const result=await c.query<{id:string}>("INSERT INTO programme_equipment_units(organisation_id,asset_code,name,condition) VALUES($1,$2,$3,$4) RETURNING id",[org,assetCode,name,condition]);
      return result.rows[0]!.id;
    });
  },201));
  app.post("/v1/programmes/:orgId/equipment/allocations",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","equipmentId","enrolmentId"]);
    const requestId=identifier(b.clientRequestId),equipmentId=identifier(b.equipmentId),enrolmentId=identifier(b.enrolmentId);
    return write(c,org,u,requestId,"EQUIPMENT_RESERVED",{equipmentId,enrolmentId},async()=>{
      const asset=await c.query("SELECT id FROM programme_equipment_units WHERE organisation_id=$1 AND id=$2 FOR UPDATE",[org,equipmentId]);
      const enrol=await c.query<{cohort_id:string}>(`SELECT e.cohort_id FROM programme_enrolments e
        JOIN programme_participants p ON p.organisation_id=e.organisation_id AND p.id=e.participant_id
        JOIN programme_memberships m ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
        JOIN programme_cohorts co ON co.organisation_id=e.organisation_id AND co.id=e.cohort_id
        JOIN programmes pr ON pr.organisation_id=co.organisation_id AND pr.id=co.programme_id
        WHERE e.organisation_id=$1 AND e.id=$2 AND p.withdrawn_at IS NULL AND m.role='PARTICIPANT' AND m.status='ACTIVE' AND pr.status<>'CLOSED'
        FOR SHARE OF e,p,m,co,pr`,[org,enrolmentId]);
      if(!asset.rowCount||!enrol.rows[0])throw denied();
      const result=await c.query<{id:string}>("INSERT INTO programme_equipment_allocations(organisation_id,cohort_id,enrolment_id,equipment_id,reserved_by) VALUES($1,$2,$3,$4,$5) RETURNING id",[org,enrol.rows[0].cohort_id,enrolmentId,equipmentId,u]);
      return result.rows[0]!.id;
    });
  },201));
  app.get("/v1/programmes/:orgId/equipment/allocations",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req),role=await access(c,org,u,[...managers,"PARTICIPANT"]);
    const result=await c.query(`SELECT a.id,a.status,e.name AS "equipmentName",e.asset_code AS "assetCode",e.condition,
      CASE WHEN p.withdrawn_at IS NULL AND m.status='ACTIVE' THEN p.display_name ELSE NULL END AS "participantName",
      a.created_at AS "reservedAt",a.approved_at AS "approvedAt",a.handed_over_at AS "handedOverAt",
      (a.reserved_by<>$3 AND $4='ORG_ADMIN' AND a.status='RESERVED' AND p.withdrawn_at IS NULL AND m.status='ACTIVE') AS "canApprove"
      FROM programme_equipment_allocations a
      JOIN programme_equipment_units e ON e.organisation_id=a.organisation_id AND e.id=a.equipment_id
      JOIN programme_enrolments en ON en.organisation_id=a.organisation_id AND en.cohort_id=a.cohort_id AND en.id=a.enrolment_id
      JOIN programme_participants p ON p.organisation_id=en.organisation_id AND p.id=en.participant_id
      JOIN programme_memberships m ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
      WHERE a.organisation_id=$1 AND ($2::boolean OR (p.user_id=$3 AND p.withdrawn_at IS NULL AND m.status='ACTIVE'))
      ORDER BY a.created_at DESC,a.id LIMIT 100`,[org,managers.includes(role),u,role]);
    return {allocations:result.rows};
  }));
  app.post("/v1/programmes/:orgId/equipment/transitions",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req),role=await access(c,org,u,[...managers,"PARTICIPANT"]);
    const b=body(req,["clientRequestId","allocationId","action"]);
    const requestId=identifier(b.clientRequestId),allocationId=identifier(b.allocationId),action=b.action;
    if(action!=="APPROVE"&&action!=="CANCEL"&&action!=="ACKNOWLEDGE")throw invalid("Invalid equipment action");
    if((action==="APPROVE"&&role!=="ORG_ADMIN")||(action==="CANCEL"&&!managers.includes(role))||(action==="ACKNOWLEDGE"&&role!=="PARTICIPANT"))throw denied();
    // Revalidate current scope before executing or returning replay evidence.
    const target=await c.query<{status:string;reserved_by:string;user_id:string;active:boolean;open:boolean}>(`SELECT a.status,a.reserved_by,p.user_id,
      (p.withdrawn_at IS NULL AND m.status='ACTIVE' AND m.role='PARTICIPANT') AS active,(pr.status<>'CLOSED') AS open
      FROM programme_equipment_allocations a
      JOIN programme_enrolments en ON en.organisation_id=a.organisation_id AND en.cohort_id=a.cohort_id AND en.id=a.enrolment_id
      JOIN programme_participants p ON p.organisation_id=en.organisation_id AND p.id=en.participant_id
      JOIN programme_memberships m ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
      JOIN programme_cohorts co ON co.organisation_id=en.organisation_id AND co.id=en.cohort_id
      JOIN programmes pr ON pr.organisation_id=co.organisation_id AND pr.id=co.programme_id
      WHERE a.organisation_id=$1 AND a.id=$2 FOR UPDATE OF a FOR SHARE OF p,m,en,co,pr`,[org,allocationId]);
    const row=target.rows[0];
    if(!row||(action==="ACKNOWLEDGE"&&row.user_id!==u)||(action!=="CANCEL"&&(!row.active||!row.open)))throw denied();
    if(action==="APPROVE"&&row.reserved_by===u)throw denied();
    return write(c,org,u,requestId,"EQUIPMENT_"+action,{allocationId,action},async()=>{
      if(action==="APPROVE"&&row.status==="RESERVED")
        await c.query("UPDATE programme_equipment_allocations SET status='APPROVED',approved_by=$3,approved_at=now() WHERE organisation_id=$1 AND id=$2",[org,allocationId,u]);
      else if(action==="ACKNOWLEDGE"&&row.status==="APPROVED")
        await c.query("UPDATE programme_equipment_allocations SET status='HANDED_OVER',acknowledged_by=$3,handed_over_at=now() WHERE organisation_id=$1 AND id=$2",[org,allocationId,u]);
      else if(action==="CANCEL"&&["RESERVED","APPROVED"].includes(row.status))
        await c.query("UPDATE programme_equipment_allocations SET status='CANCELLED',cancelled_at=now() WHERE organisation_id=$1 AND id=$2",[org,allocationId]);
      else throw conflict("Equipment action is not valid for the current status");
      return allocationId;
    });
  },201));

  // Immutable cohort lesson versions; practice results are not grant eligibility.
  // The answer key is never returned to participant clients.
  app.get("/v1/programmes/:orgId/literacy/lessons",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req),role=await access(c,org,u,[...managers,"PARTICIPANT"]);
    if(managers.includes(role)){
      const result=await c.query(`SELECT l.id,l.cohort_id AS "cohortId",co.name AS "cohortName",l.title,l.topic,
        l.lesson_text AS "lessonText",l.question,l.options,l.version
        FROM programme_literacy_lessons l JOIN programme_cohorts co ON co.organisation_id=l.organisation_id AND co.id=l.cohort_id
        WHERE l.organisation_id=$1 ORDER BY l.created_at DESC,l.id LIMIT 100`,[org]);
      return {lessons:result.rows};
    }
    const result=await c.query(`SELECT l.id,l.cohort_id AS "cohortId",co.name AS "cohortName",l.title,l.topic,l.lesson_text AS "lessonText",
       l.question,l.options,l.version,e.id AS "enrolmentId",
       EXISTS(SELECT 1 FROM programme_literacy_attempts a WHERE a.organisation_id=l.organisation_id AND a.enrolment_id=e.id AND a.lesson_id=l.id AND a.passed) AS passed,
       (SELECT count(*)::integer FROM programme_literacy_attempts a WHERE a.organisation_id=l.organisation_id AND a.enrolment_id=e.id AND a.lesson_id=l.id) AS attempts
      FROM programme_literacy_lessons l
      JOIN programme_cohorts co ON co.organisation_id=l.organisation_id AND co.id=l.cohort_id
      JOIN programmes pr ON pr.organisation_id=co.organisation_id AND pr.id=co.programme_id
      JOIN programme_enrolments e ON e.organisation_id=l.organisation_id AND e.cohort_id=l.cohort_id
      JOIN programme_participants p ON p.organisation_id=e.organisation_id AND p.id=e.participant_id
      WHERE l.organisation_id=$1 AND p.user_id=$2 AND p.withdrawn_at IS NULL AND pr.status<>'CLOSED'
      ORDER BY l.created_at DESC,l.id LIMIT 100`,[org,u]);
    return {lessons:result.rows};
  }));
  app.post("/v1/programmes/:orgId/literacy/lessons",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,managers);
    const b=body(req,["clientRequestId","cohortId","title","topic","lessonText","question","options","correctOption","version"]);
    const requestId=identifier(b.clientRequestId),cohortId=identifier(b.cohortId),title=str(b.title,160),topic=b.topic,version=b.version,
      lessonText=typeof b.lessonText==="string"?b.lessonText.trim():"",question=str(b.question,500),correctOption=b.correctOption;
    if(!lessonText||lessonText.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(lessonText))throw invalid("Invalid lesson content");
    if(typeof topic!=="string"||!["RECORD_KEEPING","COSTING_PRICING","BUDGETING","SAVINGS","CASH_RECONCILIATION","BUSINESS_FINANCE","STOCK_CONTROL","CREDIT_BASICS"].includes(topic))throw invalid("Invalid lesson topic");
    if(typeof version!=="number"||!Number.isInteger(version)||version<1||version>1000)throw invalid("Invalid lesson version");
    if(!Array.isArray(b.options)||b.options.length!==3)throw invalid("Three answer options required");
    const options=b.options.map(x=>str(x,250));
    if(new Set(options.map(x=>x.toLowerCase())).size!==3)throw invalid("Answer options must differ");
    if(typeof correctOption!=="number"||!Number.isInteger(correctOption)||correctOption<0||correctOption>2)throw invalid("Select a correct answer");
    return write(c,org,u,requestId,"LITERACY_LESSON_PUBLISHED",{cohortId,title,topic,lessonText,question,options,correctOption,version},async()=>{
      const cohort=await c.query(`SELECT co.id FROM programme_cohorts co JOIN programmes pr ON pr.organisation_id=co.organisation_id AND pr.id=co.programme_id
        WHERE co.organisation_id=$1 AND co.id=$2 AND pr.status<>'CLOSED' FOR UPDATE OF co FOR SHARE OF pr`,[org,cohortId]);
      if(!cohort.rowCount)throw denied();
      const latest=await c.query<{version:number}>("SELECT COALESCE(max(version),0)::integer AS version FROM programme_literacy_lessons WHERE organisation_id=$1 AND cohort_id=$2 AND title=$3",[org,cohortId,title]);
      if(version!==latest.rows[0]!.version+1)throw conflict("Lesson version must follow the previous published version");
      const result=await c.query<{id:string}>("INSERT INTO programme_literacy_lessons(organisation_id,cohort_id,title,topic,lesson_text,question,options,correct_option,version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING id",[org,cohortId,title,topic,lessonText,question,JSON.stringify(options),correctOption,version,u]);
      return result.rows[0]!.id;
    });
  },201));
  app.post("/v1/programmes/:orgId/literacy/attempts",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const b=body(req,["clientRequestId","lessonId","enrolmentId","answerOption"]);
    const requestId=identifier(b.clientRequestId),lessonId=identifier(b.lessonId),enrolmentId=identifier(b.enrolmentId),answerOption=b.answerOption;
    if(typeof answerOption!=="number"||!Number.isInteger(answerOption)||answerOption<0||answerOption>2)throw invalid("Select an answer");
    const lesson=await c.query<{cohort_id:string;correct_option:number}>(`SELECT l.cohort_id,l.correct_option FROM programme_literacy_lessons l
      JOIN programme_enrolments e ON e.organisation_id=l.organisation_id AND e.cohort_id=l.cohort_id AND e.id=$3
      JOIN programme_participants p ON p.organisation_id=e.organisation_id AND p.id=e.participant_id
      JOIN programme_cohorts co ON co.organisation_id=l.organisation_id AND co.id=l.cohort_id
      JOIN programmes pr ON pr.organisation_id=co.organisation_id AND pr.id=co.programme_id
      WHERE l.organisation_id=$1 AND l.id=$2 AND p.user_id=$4 AND p.withdrawn_at IS NULL AND pr.status<>'CLOSED'
      FOR SHARE OF l,e,p,co,pr`,[org,lessonId,enrolmentId,u]);
    if(!lesson.rows[0])throw denied();
    const receipt=await write(c,org,u,requestId,"LITERACY_ATTEMPT_RECORDED",{lessonId,enrolmentId,answerOption},async()=>{
      const result=await c.query<{id:string}>("INSERT INTO programme_literacy_attempts(organisation_id,cohort_id,lesson_id,enrolment_id,answer_option,passed) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[org,lesson.rows[0]!.cohort_id,lessonId,enrolmentId,answerOption,answerOption===lesson.rows[0]!.correct_option]);
      return result.rows[0]!.id;
    });
    const stored=await c.query<{passed:boolean}>("SELECT passed FROM programme_literacy_attempts WHERE organisation_id=$1 AND id=$2 AND enrolment_id=$3 AND lesson_id=$4",[org,receipt.id,enrolmentId,lessonId]);
    if(!stored.rows[0])throw conflict("Attempt receipt unavailable");
    return {...receipt,passed:stored.rows[0].passed};
  },201));

  // Participant-owned businesses remain independent. No sponsor endpoint returns
  // merchant identities, branch IDs, sales, stock, balances or customer details.
  app.get("/v1/programmes/:orgId/businesses/self",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const result=await c.query(`SELECT b.id,b.name,b.business_type AS "businessType",
      l.id AS "linkId",l.linked_at AS "linkedAt"
      FROM programme_participants p
      JOIN business_memberships bm ON bm.user_id=p.user_id AND bm.role='OWNER' AND bm.status='ACTIVE'
      JOIN businesses b ON b.id=bm.business_id AND b.status='ACTIVE'
      LEFT JOIN programme_business_links l ON l.organisation_id=p.organisation_id AND l.participant_id=p.id
        AND l.business_id=b.id AND l.owner_user_id=p.user_id AND l.revoked_at IS NULL
      WHERE p.organisation_id=$1 AND p.user_id=$2 AND p.withdrawn_at IS NULL
      ORDER BY b.name,b.id LIMIT 100`,[org,u]);
    return {businesses:result.rows};
  }));
  app.post("/v1/programmes/:orgId/businesses/link",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const b=body(req,["clientRequestId","businessId","consentVersion","consent"]);
    const requestId=identifier(b.clientRequestId),businessId=identifier(b.businessId);
    if(b.consentVersion!=="v1"||b.consent!==true)throw invalid("Explicit business linking consent required");
    const participant=await c.query<{id:string}>(`SELECT p.id FROM programme_participants p
      JOIN business_memberships bm ON bm.user_id=p.user_id AND bm.business_id=$3
      JOIN businesses b ON b.id=bm.business_id
      WHERE p.organisation_id=$1 AND p.user_id=$2 AND p.withdrawn_at IS NULL
        AND bm.role='OWNER' AND bm.status='ACTIVE' AND b.status='ACTIVE'
      FOR UPDATE OF p FOR SHARE OF bm,b`,[org,u,businessId]);
    if(!participant.rows[0])throw denied();
    const participantId=participant.rows[0].id;
    return write(c,org,u,requestId,"BUSINESS_LINK_CONSENTED",{businessId,consentVersion:"v1"},async()=>{
      const result=await c.query<{id:string}>("INSERT INTO programme_business_links(organisation_id,participant_id,business_id,owner_user_id,consent_version) VALUES($1,$2,$3,$4,'v1') RETURNING id",[org,participantId,businessId,u]);
      return result.rows[0]!.id;
    });
  },201));
  app.post("/v1/programmes/:orgId/businesses/unlink",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,["PARTICIPANT"]);
    const b=body(req,["clientRequestId","linkId"]);
    const requestId=identifier(b.clientRequestId),linkId=identifier(b.linkId);
    // Revocation is allowed even after merchant membership or consent ends.
    const owned=await c.query("SELECT id FROM programme_business_links WHERE organisation_id=$1 AND id=$2 AND owner_user_id=$3 FOR UPDATE",[org,linkId,u]);
    if(!owned.rowCount)throw denied();
    return write(c,org,u,requestId,"BUSINESS_LINK_REVOKED",{linkId},async()=>{
      const result=await c.query<{id:string}>("UPDATE programme_business_links SET revoked_at=now() WHERE organisation_id=$1 AND id=$2 AND owner_user_id=$3 AND revoked_at IS NULL RETURNING id",[org,linkId,u]);
      if(!result.rows[0])throw conflict("Business link is already revoked");
      return result.rows[0].id;
    });
  },201));
  app.get("/v1/programmes/:orgId/businesses/summary",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,[...managers,"REPORT_VIEWER"]);
    // Fixed organisation-wide snapshot; no participant/cohort filters.
    // Suppress small populations and small nonzero positive/negative cells.
    const result=await c.query<{participants:number;linked:number}>(`SELECT count(*)::integer AS participants,
      count(*) FILTER(WHERE EXISTS(
        SELECT 1 FROM programme_business_links l
        JOIN businesses b ON b.id=l.business_id AND b.status='ACTIVE'
        JOIN business_memberships bm ON bm.business_id=b.id AND bm.user_id=l.owner_user_id AND bm.role='OWNER' AND bm.status='ACTIVE'
        WHERE l.organisation_id=p.organisation_id AND l.participant_id=p.id AND l.owner_user_id=p.user_id AND l.revoked_at IS NULL
      ))::integer AS linked
      FROM programme_participants p JOIN programme_memberships m ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
      JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
      WHERE p.organisation_id=$1 AND p.withdrawn_at IS NULL AND m.role='PARTICIPANT' AND m.status='ACTIVE'`,[org]);
    const {participants,linked}=result.rows[0]!;
    const other=participants-linked;
    const suppressed=participants<5||(linked>0&&linked<5)||(other>0&&other<5);
    return {suppressed,minimumCellSize:5,participants:suppressed?null:participants,linked:suppressed?null:linked};
  }));


  // Fixed organisation-wide, participant-deduplicated recorded milestones.
  // No arbitrary slices, per-person outcomes, financial figures or causal claims.
  app.get("/v1/programmes/:orgId/outcomes",(req,reply)=>handle(req,reply,async(c,u)=>{
    const org=orgOf(req);await access(c,org,u,[...managers,"REPORT_VIEWER"]);
    if(Object.keys((req.query??{}) as object).length)throw invalid("Outcome filters are not supported");
    const result=await c.query<{participants:number;enrolled:number;trained:number;equipped:number;learned:number}>(`WITH eligible AS (
      SELECT p.id,p.organisation_id FROM programme_participants p
      JOIN programme_memberships m ON m.organisation_id=p.organisation_id AND m.user_id=p.user_id
      JOIN app_users au ON au.id=p.user_id AND au.status='ACTIVE'
      WHERE p.organisation_id=$1 AND p.withdrawn_at IS NULL AND m.role='PARTICIPANT' AND m.status='ACTIVE'
    ), milestones AS (
      SELECT p.id,
        EXISTS(SELECT 1 FROM programme_enrolments e WHERE e.organisation_id=p.organisation_id AND e.participant_id=p.id) AS enrolled,
        EXISTS(SELECT 1 FROM programme_enrolments e JOIN programme_training_placements t
          ON t.organisation_id=e.organisation_id AND t.cohort_id=e.cohort_id AND t.enrolment_id=e.id
          WHERE e.organisation_id=p.organisation_id AND e.participant_id=p.id AND t.status='COMPLETED') AS trained,
        EXISTS(SELECT 1 FROM programme_enrolments e JOIN programme_equipment_allocations a
          ON a.organisation_id=e.organisation_id AND a.cohort_id=e.cohort_id AND a.enrolment_id=e.id
          WHERE e.organisation_id=p.organisation_id AND e.participant_id=p.id AND a.status='HANDED_OVER') AS equipped,
        EXISTS(SELECT 1 FROM programme_enrolments e JOIN programme_literacy_attempts a
          ON a.organisation_id=e.organisation_id AND a.cohort_id=e.cohort_id AND a.enrolment_id=e.id
          WHERE e.organisation_id=p.organisation_id AND e.participant_id=p.id AND a.passed) AS learned
      FROM eligible p
    ) SELECT count(*)::integer AS participants,
      count(*) FILTER(WHERE enrolled)::integer AS enrolled,
      count(*) FILTER(WHERE trained)::integer AS trained,
      count(*) FILTER(WHERE equipped)::integer AS equipped,
      count(*) FILTER(WHERE learned)::integer AS learned FROM milestones`,[org]);
    const r=result.rows[0]!,minimumCellSize=5;
    const metric=(key:"enrolled"|"trained"|"equipped"|"learned")=>{
      const n=r[key],suppressed=n<minimumCellSize||r.participants-n<minimumCellSize;
      return {key,count:suppressed?null:n,suppressed};
    };
    return {minimumCellSize,participants:r.participants<2*minimumCellSize?null:r.participants,
      metrics:[metric("enrolled"),metric("trained"),metric("equipped"),metric("learned")]};
  }));

}
