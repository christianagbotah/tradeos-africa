import type {FastifyInstance} from "fastify";
import type {DatabasePool} from "../db.js";
import {authenticateAccessToken,AuthError} from "../auth/security.js";
import {requireBusinessRole} from "../auth/authorization.js";
import {listMerchantSmsConnections,saveMerchantSmsConnection,
  revokeMerchantSmsConnection} from "./connections.js";
import {sendHubtelSmsConnectionTest} from "./hubtel-sms-test.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function badId(id:string){
  if(!UUID.test(id))throw new AuthError("Invalid business identifier.",
    400,"SMS_BUSINESS_ID_INVALID");
}
export function registerSmsProviderRoutes(app:FastifyInstance,pool:DatabasePool):void{
  app.get<{Params:{businessId:string}}>(
    "/v1/businesses/:businessId/sms-providers/connections",
    async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        badId(req.params.businessId);
        await requireBusinessRole(pool,auth,req.params.businessId,["OWNER","ADMIN"]);
        return await listMerchantSmsConnections(pool,req.params.businessId);
      }catch(error){return sendError(req,reply,error);}
    });
  app.post<{Params:{businessId:string};Body:{
    clientRequestId?:string;recipient?:string;currentPassword?:string;
    confirmOwnership?:boolean;
  }}>("/v1/businesses/:businessId/sms-providers/HUBTEL_SMS/test-send",
    {bodyLimit:1024},async(req,reply)=>{
      reply.header("Cache-Control","no-store");
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        badId(req.params.businessId);
        await requireBusinessRole(pool,auth,req.params.businessId,["OWNER","ADMIN"]);
        return await sendHubtelSmsConnectionTest(pool,{
          businessId:req.params.businessId,actorUserId:auth.userId,
          clientRequestId:req.body?.clientRequestId??"",
          recipient:req.body?.recipient,
          confirmOwnership:req.body?.confirmOwnership,
          currentPassword:req.body?.currentPassword,
        });
      }catch(error){return sendError(req,reply,error);}
    });
  app.put<{Params:{businessId:string;providerCode:string};Body:{
    apiSecret?:unknown;senderId?:unknown;accountId?:unknown;
    currentPassword?:unknown;expectedRevision?:unknown;
  }}>(
    "/v1/businesses/:businessId/sms-providers/connections/:providerCode",
    {bodyLimit:3072},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        badId(req.params.businessId);
        await requireBusinessRole(pool,auth,req.params.businessId,["OWNER","ADMIN"]);
        const connection=await saveMerchantSmsConnection(pool,{
          businessId:req.params.businessId,providerCode:req.params.providerCode,
          actorUserId:auth.userId,apiSecret:req.body?.apiSecret,
          senderId:req.body?.senderId,accountId:req.body?.accountId,
          currentPassword:req.body?.currentPassword,
          expectedRevision:req.body?.expectedRevision,
        });
        return {connection};
      }catch(error){return sendError(req,reply,error);}
    });
  app.delete<{Params:{businessId:string;providerCode:string};Body:{
    currentPassword?:unknown;expectedRevision?:unknown;
  }}>(
    "/v1/businesses/:businessId/sms-providers/connections/:providerCode",
    {bodyLimit:1024},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        badId(req.params.businessId);
        await requireBusinessRole(pool,auth,req.params.businessId,["OWNER","ADMIN"]);
        const connection=await revokeMerchantSmsConnection(pool,{
          businessId:req.params.businessId,providerCode:req.params.providerCode,
          actorUserId:auth.userId,currentPassword:req.body?.currentPassword,
          expectedRevision:req.body?.expectedRevision,
        });
        return {connection};
      }catch(error){return sendError(req,reply,error);}
    });
}
function sendError(req:{log:{error:(error:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},
  error:unknown){
  if(error instanceof AuthError)return reply.code(error.statusCode).send({
    error:error.code,message:error.message});
  req.log.error(error);
  return reply.code(500).send({error:"SMS_PROVIDER_FAILED",
    message:"Messaging provider configuration is temporarily unavailable."});
}
