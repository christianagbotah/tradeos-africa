import type {FastifyInstance} from "fastify";
import type {DatabasePool} from "../db.js";
import {authenticateAccessToken,AuthError} from "../auth/security.js";
import {requireBusinessRole,type BusinessRole} from "../auth/authorization.js";
import {paymentGatewayOptions,savePreferredGateway} from "./service.js";
import {listMerchantGatewayConnections,saveMerchantGatewayTestKey,
  revokeMerchantGatewayConnection} from "./connections.js";
import {listGatewayTestAttempts} from "./attempts.js";
import {
  listMerchantGatewayCredentials,saveMerchantPaymentCredentials,
  revokeMerchantPaymentCredentials,verifyMerchantHubtelConnection,
  requestMerchantGatewayActivation,MerchantProbeError,
} from "./merchant-connections.js";

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
  app.get<{Params:{businessId:string};Querystring:{branchId?:string;limit?:string}}>(
    "/v1/businesses/:businessId/payment-gateways/attempts",
    async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        if(req.query.branchId&&!UUID.test(req.query.branchId))
          throw new AuthError("Invalid branch ID",400,"BRANCH_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,
          ["OWNER","ADMIN","MANAGER","ACCOUNTANT"]);
        return await listGatewayTestAttempts(pool,{
          businessId:req.params.businessId,
          ...(req.query.branchId?{branchId:req.query.branchId}:{}),
          limit:Number(req.query.limit??25),
        });
      }catch(error){return sendError(req,reply,error);}
    });
  app.get<{Params:{businessId:string}}>(
    "/v1/businesses/:businessId/payment-gateways/connections",
    async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await listMerchantGatewayConnections(pool,req.params.businessId);
      }catch(error){return sendError(req,reply,error);}
    });
  app.put<{Params:{businessId:string;providerCode:string};Body:{
      secretKey?:unknown;currentPassword?:unknown;expectedRevision?:unknown;
    }}>("/v1/businesses/:businessId/payment-gateways/connections/:providerCode",
    {bodyLimit:3072},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        const connection=await saveMerchantGatewayTestKey(pool,{
          businessId:req.params.businessId,providerCode:req.params.providerCode,
          actorUserId:auth.userId,secretKey:req.body?.secretKey,
          currentPassword:req.body?.currentPassword,
          expectedRevision:req.body?.expectedRevision});
        return {connection};
      }catch(error){return sendError(req,reply,error);}
    });
  app.delete<{Params:{businessId:string;providerCode:string};Body:{
      currentPassword?:unknown;expectedRevision?:unknown;
    }}>("/v1/businesses/:businessId/payment-gateways/connections/:providerCode",
    {bodyLimit:1024},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        const connection=await revokeMerchantGatewayConnection(pool,{
          businessId:req.params.businessId,providerCode:req.params.providerCode,
          actorUserId:auth.userId,currentPassword:req.body?.currentPassword,
          expectedRevision:req.body?.expectedRevision});
        return {connection};
      }catch(error){return sendError(req,reply,error);}
    });
  // Unified merchant-facing API credential vault. This is provider setup,
  // not permission to collect real money.
  app.get<{Params:{businessId:string}}>(
    "/v1/businesses/:businessId/payment-gateways/merchant-connections",
    async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await listMerchantGatewayCredentials(pool,req.params.businessId);
      }catch(error){return sendError(req,reply,error);}
    });
  app.put<{Params:{businessId:string;providerCode:string;environment:string};Body:{
    fields?:unknown;expectedRevision?:unknown;currentPassword?:unknown;
  }}>(
    "/v1/businesses/:businessId/payment-gateways/merchant-connections/:providerCode/:environment",
    {bodyLimit:6144},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await saveMerchantPaymentCredentials(pool,{
          businessId:req.params.businessId,providerCode:req.params.providerCode,
          environment:req.params.environment,fields:req.body?.fields,
          actorUserId:auth.userId,currentPassword:req.body?.currentPassword,
          expectedRevision:req.body?.expectedRevision,
        });
      }catch(error){return sendError(req,reply,error);}
    });
  app.delete<{Params:{businessId:string;providerCode:string;environment:string};Body:{
    expectedRevision?:unknown;currentPassword?:unknown;
  }}>(
    "/v1/businesses/:businessId/payment-gateways/merchant-connections/:providerCode/:environment",
    {bodyLimit:1024},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await revokeMerchantPaymentCredentials(pool,{
          businessId:req.params.businessId,providerCode:req.params.providerCode,
          environment:req.params.environment,actorUserId:auth.userId,
          currentPassword:req.body?.currentPassword,
          expectedRevision:req.body?.expectedRevision,
        });
      }catch(error){return sendError(req,reply,error);}
    });
  app.post<{Params:{businessId:string};Body:{
    environment?:unknown;expectedRevision?:unknown;currentPassword?:unknown;
  }}>(
    "/v1/businesses/:businessId/payment-gateways/merchant-connections/HUBTEL/verify",
    {bodyLimit:1024},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await verifyMerchantHubtelConnection(pool,{
          businessId:req.params.businessId,actorUserId:auth.userId,
          environment:req.body?.environment,
          expectedRevision:req.body?.expectedRevision,
          currentPassword:req.body?.currentPassword,
        });
      }catch(error){return sendError(req,reply,error);}
    });
  app.post<{Params:{businessId:string;providerCode:string;environment:string};Body:{
    expectedRevision?:unknown;currentPassword?:unknown;
  }}>(
    "/v1/businesses/:businessId/payment-gateways/merchant-connections/:providerCode/:environment/request-activation",
    {bodyLimit:1024},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await requestMerchantGatewayActivation(pool,{
          businessId:req.params.businessId,actorUserId:auth.userId,
          providerCode:req.params.providerCode,environment:req.params.environment,
          expectedRevision:req.body?.expectedRevision,
          currentPassword:req.body?.currentPassword,
        });
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
  if(error instanceof MerchantProbeError)return reply.code(error.statusCode).send({
    error:error.code,message:error.message});
  if(error instanceof AuthError)return reply.code(error.statusCode).send({
    error:error.code,message:error.message});
  req.log.error(error);
  return reply.code(500).send({error:"PAYMENT_PROVIDER_FAILED",
    message:"Payment provider settings are temporarily unavailable."});
}
