import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "./db.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import {
  createOwnedBusiness,
  type CreateOwnedBusinessRequest,
} from "./business-management-service.js";

export function registerOnboardingRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: CreateOwnedBusinessRequest }>("/v1/onboarding/business", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const result = await createOwnedBusiness(pool, auth, request.body, "BUSINESS_ONBOARDED");
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "ONBOARDING_FAILED", message: "The business could not be created." });
    }
  });
}
