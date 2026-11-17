import type {FastifyInstance} from "fastify";
import type {DatabasePool} from "../db.js";
import {authenticateAccessToken,AuthError} from "../auth/security.js";
import {requireBusinessRole,type BusinessRole} from "../auth/authorization.js";
import {paymentGatewayOptions,savePreferredGateway} from "./service.js";

const READ:readonly BusinessRole[]=[
  "OWNER","ADMIN","MANAGER","CASHIER","SALES",
  "INVENTORY","ACCOUNTANT","STAFF","VIEWER"];
const MANAGE:readonly BusinessRole[]=["OWNER","ADMIN"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function registerPaymentProviderRoutes(app:FastifyInstance,pool:DatabasePool):void{
  app.get<{Params:{businessId:string}}>(
    "/v1/businesses/:businessId/payment-gateways",async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,READ);
        return await paymentGatewayOptions(pool,req.params.businessId);
      }catch(error){return sendError(req,reply,error);}
    });
  app.put<{Params:{businessId:string};Body:{
      providerCode?:unknown;expectedRevision?:unknown;
    }}>("/v1/businesses/:businessId/payment-gateways/preference",
    async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        const changed=await savePreferredGateway(pool,{
          businessId:req.params.businessId,providerCode:req.body?.providerCode,
          expectedRevision:req.body?.expectedRevision,actorUserId:auth.userId,
        });
        return {preference:changed};
      }catch(error){return sendError(req,reply,error);}
    });
}
function sendError(req:{log:{error:(error:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},error:unknown){
  if(error instanceof AuthError)return reply.code(error.statusCode).send({
    error:error.code,message:error.message});
  req.log.error(error);
  return reply.code(500).send({error:"PAYMENT_PROVIDER_FAILED",
    message:"Payment provider settings are temporarily unavailable."});
}
