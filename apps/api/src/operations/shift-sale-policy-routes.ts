import type {FastifyInstance} from "fastify";
import {authenticateAccessToken,AuthError} from "../auth/security.js";
import {requireBusinessRole,type BusinessRole} from "../auth/authorization.js";
import {requireBranchScope} from "../auth/branch-scope.js";
import {withTransaction,type DatabasePool} from "../db.js";
import {readBranchShiftSalePolicy} from "./shift-sale-policy.js";

const READ_ROLES:readonly BusinessRole[]=[
  "OWNER","ADMIN","MANAGER","CASHIER","POS_ATTENDANT","SALES",
  "STAFF","INVENTORY","ACCOUNTANT","VIEWER",
];
const WRITE_ROLES:readonly BusinessRole[]=["OWNER","ADMIN"];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class PolicyRequestError extends Error {
  constructor(message:string,readonly code:string,readonly statusCode:number){
    super(message);
  }
}
function ids(query:{businessId?:string;branchId?:string}){
  if(!query.businessId || !uuid.test(query.businessId)||
    !query.branchId || !uuid.test(query.branchId))
    throw new PolicyRequestError("Valid business and branch IDs are required.",
      "INVALID_POLICY_SCOPE",400);
  return {businessId:query.businessId,branchId:query.branchId};
}
function sendError(error:unknown,reply:{
  code:(code:number)=>{send:(payload:unknown)=>unknown};
}){
  if(error instanceof AuthError||error instanceof PolicyRequestError)
    return reply.code(error.statusCode).send({
      error:error.code,message:error.message,
    });
  throw error;
}

export function registerShiftSalePolicyRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get<{Querystring:{businessId?:string;branchId?:string}}>(
    "/v1/operations/sale-shift-policy",async(request,reply)=>{
      try{
        const {businessId,branchId}=ids(request.query);
        const auth=await authenticateAccessToken(pool,request.headers.authorization);
        const access=await requireBusinessRole(pool,auth,businessId,READ_ROLES);
        await requireBranchScope(pool,access,branchId);
        if(!(await pool.query(
          "SELECT id FROM branches WHERE business_id=$1 AND id=$2 AND is_active=true",
          [businessId,branchId])).rowCount)
          throw new PolicyRequestError("Active branch not found.","BRANCH_NOT_FOUND",404);
        reply.header("Cache-Control","private, no-store, max-age=0");
        return {policy:await readBranchShiftSalePolicy(
          pool,businessId,branchId,
        )};
      }catch(error){return sendError(error,reply);}
    },
  );
  app.patch<{
    Querystring:{businessId?:string;branchId?:string};
    Body:{required?:unknown;expectedRevision?:unknown;reason?:unknown};
  }>("/v1/operations/sale-shift-policy",async(request,reply)=>{
    try{
      const {businessId,branchId}=ids(request.query);
      const auth=await authenticateAccessToken(pool,request.headers.authorization);
      const access=await requireBusinessRole(pool,auth,businessId,WRITE_ROLES);
      await requireBranchScope(pool,access,branchId);
      if(!access.staffId)throw new AuthError(
        "An active staff actor is required.",403,"STAFF_ACTOR_REQUIRED");
      const body=request.body;
      if(!body||typeof body!=="object"||Array.isArray(body)||
        Object.keys(body).some(key=>!["required","expectedRevision","reason"].includes(key))||
        typeof body.required!=="boolean"||
        !Object.prototype.hasOwnProperty.call(body,"expectedRevision")||
        (body.expectedRevision!==null &&
          (typeof body.expectedRevision!=="string" || !uuid.test(body.expectedRevision)))||
        typeof body.reason!=="string"||
        body.reason.trim().length<10||body.reason.trim().length>500)
        throw new PolicyRequestError(
          "Choose a policy, provide its current revision, and explain the change in 10–500 characters.",
          "INVALID_SHIFT_POLICY",400);
      const required=body.required;
      const expectedRevision=body.expectedRevision;
      const reason=body.reason.trim();
      const policy=await withTransaction(pool,async(client)=>{
        // Lock one branch row to serialize concurrent admins and protect the
        // optimistic revision. This never locks cashbook or sale posting paths.
        const branch=await client.query(
          "SELECT id FROM branches WHERE business_id=$1 AND id=$2 AND is_active=true FOR UPDATE",
          [businessId,branchId],
        );
        if(!branch.rowCount)throw new PolicyRequestError(
          "Active branch not found.","BRANCH_NOT_FOUND",404);
        const previous=await readBranchShiftSalePolicy(client,businessId,branchId);
        if(previous.revision!==expectedRevision)
          throw new PolicyRequestError(
            "This branch policy changed. Refresh before updating it.",
            "SHIFT_POLICY_REVISION_CONFLICT",409);
        if(previous.required===required)return previous;
        const row=(await client.query<{id:string;effective_at:Date}>(
          `INSERT INTO branch_shift_sale_policy_events
           (business_id,branch_id,required,changed_by_staff_id,reason)
           VALUES($1,$2,$3,$4,$5) RETURNING id,effective_at`,
          [businessId,branchId,required,access.staffId,reason],
        )).rows[0]!;
        const action=required?"ENABLED":"DISABLED";
        const payload=JSON.stringify({
          branchId,required,reason,previousRevision:previous.revision,
          policyRevision:row.id,
        });
        await client.query(
          `INSERT INTO audit_events
           (business_id,branch_id,actor_staff_id,event_type,entity_type,
            entity_id,correlation_id,payload,occurred_at)
           VALUES($1,$2,$3,$4,'BRANCH',$2,$5,$6::jsonb,$7)`,
          [businessId,branchId,access.staffId,
            "SHIFT_SALE_POLICY_"+action,row.id,payload,row.effective_at],
        );
        await client.query(
          `INSERT INTO outbox_events
           (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
           VALUES($1,$2,'BRANCH',$2,$3,$4::jsonb,$5)`,
          [businessId,branchId,"SHIFT_SALE_POLICY_"+action,payload,row.effective_at],
        );
        return {required,revision:row.id,changedAt:row.effective_at.toISOString()};
      });
      reply.header("Cache-Control","private, no-store, max-age=0");
      return {policy};
    }catch(error){return sendError(error,reply);}
  });
}
