import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { loadMerchantBillingOverview } from "./service.js";

const BILLING_READ_ROLES: readonly BusinessRole[] = ["OWNER","ADMIN","ACCOUNTANT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Business billing is not the system-admin billing surface.
 * Only current active members of an active business may see its own history.
 * No provider calls, subscription state changes or monetary writes are exposed.
 */
export function registerMerchantBillingRoutes(app: FastifyInstance, pool: DatabasePool): void {
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
