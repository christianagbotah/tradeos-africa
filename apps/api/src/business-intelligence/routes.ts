import type { FastifyInstance } from "fastify";
import type { BusinessBriefingRange } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import { ReportError } from "../reports.js";
import { buildBusinessBriefing } from "./briefing-service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRIEFING_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
type Query = { businessId?: string; branchId?: string; range?: string };

export function registerBusinessIntelligenceRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: Query }>("/v1/intelligence/briefing", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = validUuid(request.query.businessId, "businessId");
      const branchId = request.query.branchId === undefined
        ? null : validUuid(request.query.branchId, "branchId");
      const range = validRange(request.query.range);
      // Authorization must be checked before loading any branch-scoped facts.
      // A supplied businessId/branchId can never override the actor's membership.
      await requireBusinessRole(pool, auth, businessId, BRIEFING_ROLES);
      return await buildBusinessBriefing(pool, businessId, branchId, range);
    } catch (error) {
      if (error instanceof AuthError || error instanceof ReportError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({
        error: "BUSINESS_BRIEFING_FAILED",
        message: "Business briefing could not be loaded. Sales and other operations are unaffected.",
      });
    }
  });
}

function validUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ReportError(`${field} must be a UUID`);
  }
  return value;
}

function validRange(value: unknown): BusinessBriefingRange {
  if (value === undefined) return "today";
  if (value !== "today" && value !== "week" && value !== "month") {
    throw new ReportError("range must be today, week or month");
  }
  return value;
}
