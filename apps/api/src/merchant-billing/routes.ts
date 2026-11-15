import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { loadMerchantBillingOverview } from "./service.js";
import {
  createSubscriptionCheckout,verifySubscriptionCheckout,HubtelCollectionError,
  HubtelCheckoutError,HubtelStatusError,CheckoutAttemptError,
} from "./hubtel-collection.js";

const BILLING_READ_ROLES: readonly BusinessRole[] = ["OWNER","ADMIN","ACCOUNTANT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Business billing is not the system-admin billing surface.
 * Only current active members of an active business may see its own history.
 * No provider calls, subscription state changes or monetary writes are exposed.
 */
export function registerMerchantBillingRoutes(app: FastifyInstance, pool: DatabasePool): void {
  // Hubtel notifications are unsigned in the supplied documentation. This
  // ingress NEVER posts a payment or changes a ledger. Only a separate
  // authenticated server-to-server status verification can do that.
  app.post("/v1/billing/hubtel/callback", { bodyLimit:4096 }, async (_request, reply) => {
    return reply.code(202).send({ accepted:true,verification:"SERVER_SIDE_REQUIRED" });
  });

  app.post<{ Body: { businessId?:string;invoiceId?:string;clientRequestId?:string } }>(
    "/v1/billing/hubtel/checkout", async (request, reply) => {
      try {
        const auth=await authenticateAccessToken(pool,request.headers.authorization);
        const input=request.body??{};
        if(!input.businessId||!UUID.test(input.businessId)){
          throw new AuthError("Valid businessId is required",400,"BUSINESS_ID_REQUIRED");
        }
        await requireBusinessRole(pool,auth,input.businessId,BILLING_READ_ROLES);
        const checkout=await createSubscriptionCheckout(pool,{
          businessId:input.businessId,invoiceId:input.invoiceId??"",
          clientRequestId:input.clientRequestId??"",
        });
        return {checkout};
      }catch(error){return sendCollectionError(request,reply,error);}
    },
  );
  app.post<{ Params:{attemptId:string};Body:{businessId?:string} }>(
    "/v1/billing/hubtel/checkout/:attemptId/verify", async(request,reply)=>{
      try{
        const auth=await authenticateAccessToken(pool,request.headers.authorization);
        const businessId=request.body?.businessId;
        if(!businessId||!UUID.test(businessId)){
          throw new AuthError("Valid businessId is required",400,"BUSINESS_ID_REQUIRED");
        }
        await requireBusinessRole(pool,auth,businessId,BILLING_READ_ROLES);
        return {result:await verifySubscriptionCheckout(pool,businessId,request.params.attemptId)};
      }catch(error){return sendCollectionError(request,reply,error);}
    },
  );

  app.get<{ Querystring: { businessId?: string } }>("/v1/billing/overview", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = request.query.businessId;
      if (!businessId || !UUID.test(businessId)) {
        throw new AuthError("Valid businessId is required",400,"BUSINESS_ID_REQUIRED");
      }
      await requireBusinessRole(pool, auth, businessId, BILLING_READ_ROLES);
      return await loadMerchantBillingOverview(pool, businessId);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error:error.code,message:error.message });
      }
      request.log.error(error);
      return reply.code(500).send({
        error:"BUSINESS_BILLING_READ_FAILED",
        message:"Business subscription history could not be loaded.",
      });
    }
  });
}

function sendCollectionError(
  request:{log:{error:(error:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},
  error:unknown,
){
  if(error instanceof AuthError || error instanceof HubtelCollectionError ||
     error instanceof HubtelCheckoutError || error instanceof HubtelStatusError ||
     error instanceof CheckoutAttemptError){
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  }
  request.log.error(error);
  return reply.code(500).send({
    error:"HUBTEL_COLLECTION_FAILED",message:"Checkout could not be processed safely.",
  });
}
