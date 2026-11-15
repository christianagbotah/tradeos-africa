import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { authenticateAccessToken,AuthError } from "../auth/security.js";
import { requireBusinessRole,type BusinessRole } from "../auth/authorization.js";
import { HubtelPosError } from "./hubtel-pos-config.js";
import {
  getHubtelPosReadiness,getSaleHubtelCheckout,startSaleHubtelCheckout,
  verifySaleHubtelCheckout,
} from "./hubtel-pos-service.js";
import { HubtelCheckoutError } from "../platform-admin/hubtel-checkout-client.js";
import { HubtelStatusError } from "../platform-admin/hubtel-status-client.js";

const ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER","CASHIER","SALES","STAFF"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function authorize(pool:DatabasePool,authHeader:string|undefined,businessId:unknown){
  const auth=await authenticateAccessToken(pool,authHeader);
  if(typeof businessId!=="string"||!UUID.test(businessId)){
    throw new AuthError("Valid businessId is required",400,"BUSINESS_ID_REQUIRED");
  }
  await requireBusinessRole(pool,auth,businessId,ROLES);
  return businessId;
}
function errorResponse(
  request:{log:{error:(error:unknown)=>void}},
  reply:{code:(number:number)=>{send:(value:unknown)=>unknown}},
  error:unknown,
){
  if(error instanceof AuthError || error instanceof HubtelPosError ||
     error instanceof HubtelStatusError || error instanceof HubtelCheckoutError){
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  }
  request.log.error(error);
  return reply.code(500).send({
    error:"HUBTEL_POS_FAILED",message:"Hubtel POS operation could not be completed safely.",
  });
}
export function registerHubtelPosRoutes(app:FastifyInstance,pool:DatabasePool):void {
  // Unsigned callbacks cannot post payments. The authenticated merchant
  // Verify endpoint independently checks Hubtel status using private keys.
  app.post("/v1/payments/hubtel/notifications",{bodyLimit:4096},async(_req,reply)=>{
    return reply.code(202).send({accepted:true,verification:"SERVER_SIDE_REQUIRED"});
  });
  app.get<{Querystring:{businessId?:string}}>(
    "/v1/payments/hubtel/readiness",async(request,reply)=>{
      try{
        const businessId=await authorize(pool,request.headers.authorization,request.query.businessId);
        return await getHubtelPosReadiness(pool,businessId);
      }catch(error){return errorResponse(request,reply,error);}
    },
  );
  app.get<{Params:{saleId:string};Querystring:{businessId?:string}}>(
    "/v1/sales/:saleId/hubtel/checkout",async(request,reply)=>{
      try{
        const businessId=await authorize(pool,request.headers.authorization,request.query.businessId);
        return {checkout:await getSaleHubtelCheckout(pool,businessId,request.params.saleId)};
      }catch(error){return errorResponse(request,reply,error);}
    },
  );
  app.post<{Params:{saleId:string};Body:{businessId?:string;clientRequestId?:string}}>(
    "/v1/sales/:saleId/hubtel/checkout",async(request,reply)=>{
      try{
        const businessId=await authorize(pool,request.headers.authorization,request.body?.businessId);
        return {checkout:await startSaleHubtelCheckout(pool,{
          businessId,saleId:request.params.saleId,
          clientRequestId:request.body?.clientRequestId??"",
        })};
      }catch(error){return errorResponse(request,reply,error);}
    },
  );
  app.post<{Params:{saleId:string};Body:{businessId?:string}}>(
    "/v1/sales/:saleId/hubtel/verify",async(request,reply)=>{
      try{
        const businessId=await authorize(pool,request.headers.authorization,request.body?.businessId);
        return {result:await verifySaleHubtelCheckout(pool,{
          businessId,saleId:request.params.saleId,
        })};
      }catch(error){return errorResponse(request,reply,error);}
    },
  );
}
