import type {FastifyInstance} from "fastify";
import type {DatabasePool} from "../db.js";
import {authenticateAccessToken,AuthError} from "../auth/security.js";
import {requireBusinessRole,type BusinessRole} from "../auth/authorization.js";
import {paymentGatewayOptions,savePreferredGateway} from "./service.js";
import {listMerchantGatewayConnections,saveMerchantGatewayTestKey,
  revokeMerchantGatewayConnection} from "./connections.js";
import {
  listGatewayTestAttempts,prepareTestGatewayAttempt,closeTestGatewayAttempt,
} from "./attempts.js";
import {observeSandboxGatewayVerification} from "./sandbox-verification.js";
import {GatewayAdapterError} from "./hosted-adapters.js";
import {getHubtelMerchantActivationReadiness} from "./hubtel-activation-readiness.js";
import {
  listMerchantGatewayCredentials,saveMerchantPaymentCredentials,
  revokeMerchantPaymentCredentials,verifyMerchantHubtelConnection,
  verifyMerchantHostedGatewayConnection,
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
  // TEST preparation only. The reference is a local audit token, not
  // a charge or provider-initiated checkout; LIVE keys are never used.
  app.post<{Params:{businessId:string};Body:{
    saleId?:string;clientRequestId?:string;
  }}>("/v1/businesses/:businessId/payment-gateways/attempts",
    {bodyLimit:1024},async(req,reply)=>{
      reply.header("Cache-Control","no-store");
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await prepareTestGatewayAttempt(pool,{
          businessId:req.params.businessId,
          saleId:req.body?.saleId??"",
          clientRequestId:req.body?.clientRequestId??"",
        });
      }catch(error){return sendError(req,reply,error);}
    });
  // One independent provider TEST status check per minute per attempt.
  // The original encrypted TEST key/version and exact sale are verified by
  // observeSandboxGatewayVerification; a test observation never posts money.
  app.post<{Params:{businessId:string;attemptId:string};Body:{
    providerTransactionId?:string;
  }}>("/v1/businesses/:businessId/payment-gateways/attempts/:attemptId/verify-sandbox",
    {bodyLimit:1024},async(req,reply)=>{
      reply.header("Cache-Control","no-store");
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId)||!UUID.test(req.params.attemptId))
          throw new AuthError("Invalid sandbox IDs",400,"GATEWAY_SANDBOX_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        const check=(await pool.query<{provider_code:string;state:string}>(
          "SELECT provider_code,state FROM gateway_collection_attempts "+
          "WHERE business_id=$1 AND id=$2 AND environment='TEST'",
          [req.params.businessId,req.params.attemptId])).rows[0];
        if(!check)throw new AuthError("TEST attempt was not found.",
          404,"GATEWAY_SANDBOX_ATTEMPT_NOT_FOUND");
        if(check.state!=="PREPARED")throw new AuthError(
          "This TEST attempt is already closed.",409,
          "GATEWAY_SANDBOX_ATTEMPT_CLOSED");
        const providerTransactionId=req.body?.providerTransactionId;
        if(check.provider_code==="FLUTTERWAVE"&&
          (typeof providerTransactionId!=="string"||
           !/^[1-9][0-9]{0,15}$/.test(providerTransactionId)))
          throw new AuthError("Flutterwave needs a numeric TEST transaction ID.",
            400,"GATEWAY_SANDBOX_PROVIDER_TX_REQUIRED");
        if(check.provider_code==="PAYSTACK"&&
           providerTransactionId!==undefined)
          throw new AuthError("Paystack checks the original TEST reference.",
            400,"GATEWAY_SANDBOX_PROVIDER_TX_UNEXPECTED");
        const claimed=(await pool.query<{id:string}>(
          "UPDATE gateway_collection_attempts SET "+
          "last_portal_verification_at=now(),portal_verification_count=portal_verification_count+1 "+
          "WHERE business_id=$1 AND id=$2 AND environment='TEST' AND state='PREPARED' "+
          "AND (last_portal_verification_at IS NULL OR "+
          "last_portal_verification_at<=now()-interval '1 minute') RETURNING id",
          [req.params.businessId,req.params.attemptId])).rows[0];
        if(!claimed)throw new AuthError(
          "Only an open TEST attempt can be checked, at most once per minute.",
          429,"GATEWAY_SANDBOX_PORTAL_CHECK_LIMITED");
        return await observeSandboxGatewayVerification(pool,{
          businessId:req.params.businessId,attemptId:req.params.attemptId,
          ...(req.body?.providerTransactionId?
            {providerTransactionId:req.body.providerTransactionId}:{}),
        });
      }catch(error){return sendError(req,reply,error);}
    });
  app.post<{Params:{businessId:string;attemptId:string};Body:{
    decision?:"CANCELLED"|"REVIEW_REQUIRED";reasonCode?:string;
  }}>("/v1/businesses/:businessId/payment-gateways/attempts/:attemptId/close",
    {bodyLimit:1024},async(req,reply)=>{
      reply.header("Cache-Control","no-store");
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId)||!UUID.test(req.params.attemptId))
          throw new AuthError("Invalid sandbox IDs",400,"GATEWAY_SANDBOX_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        const decision=req.body?.decision;
        if(decision!=="CANCELLED"&&decision!=="REVIEW_REQUIRED")
          throw new AuthError("Choose a supported TEST attempt decision.",
            400,"GATEWAY_SANDBOX_DECISION_REQUIRED");
        return await closeTestGatewayAttempt(pool,{
          businessId:req.params.businessId,attemptId:req.params.attemptId,
          decision,reasonCode:req.body?.reasonCode??"MERCHANT_MANUAL_REVIEW",
        });
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
    "/v1/businesses/:businessId/payment-gateways/HUBTEL/activation-readiness",
    async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await getHubtelMerchantActivationReadiness(pool,req.params.businessId);
      }catch(error){return sendError(req,reply,error);}
    });
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
    "/v1/businesses/:businessId/payment-gateways/merchant-connections/:providerCode/:environment/verify",
    {bodyLimit:1024},async(req,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,req.headers.authorization);
        if(!UUID.test(req.params.businessId))throw new AuthError(
          "Invalid business ID",400,"BUSINESS_ID_INVALID");
        await requireBusinessRole(pool,auth,req.params.businessId,MANAGE);
        return await verifyMerchantHostedGatewayConnection(pool,{
          businessId:req.params.businessId,actorUserId:auth.userId,
          providerCode:req.params.providerCode,
          environment:req.params.environment,
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
  if(error instanceof MerchantProbeError||error instanceof GatewayAdapterError)
    return reply.code(error.statusCode).send({
      error:error.code,message:error.message});
  if(error instanceof AuthError)return reply.code(error.statusCode).send({
    error:error.code,message:error.message});
  req.log.error(error);
  return reply.code(500).send({error:"PAYMENT_PROVIDER_FAILED",
    message:"Payment provider settings are temporarily unavailable."});
}
