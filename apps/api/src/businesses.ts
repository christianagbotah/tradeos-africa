import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabasePool } from "./db.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

export function registerBusinessRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Params: { businessId: string } }>("/v1/businesses/:businessId/context", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const access = await requireBusinessRole(pool, auth, request.params.businessId, READ_ROLES);

      const business = await pool.query<{
        id: string;
        name: string;
        business_type: string;
        country_code: string;
        currency_code: string;
        timezone: string;
        status: string;
      }>(
        `SELECT id,name,business_type,country_code,currency_code,timezone,status
         FROM businesses WHERE id=$1`,
        [access.businessId],
      );
      const row = business.rows[0];
      if (!row) throw new AuthError("Business was not found", 404, "BUSINESS_NOT_FOUND");

      const branches = await pool.query<{
        id: string;
        name: string;
        code: string;
        timezone: string;
        is_active: boolean;
      }>(
        `SELECT id,name,code,timezone,is_active
         FROM branches
         WHERE business_id=$1
         ORDER BY CASE WHEN code='MAIN' THEN 0 ELSE 1 END, created_at`,
        [access.businessId],
      );

      return {
        business: {
          id: row.id,
          name: row.name,
          businessType: row.business_type,
          countryCode: row.country_code,
          currencyCode: row.currency_code,
          timezone: row.timezone,
          status: row.status,
        },
        membership: { role: access.role, staffId: access.staffId },
        branches: branches.rows.map((branch) => ({
          id: branch.id,
          name: branch.name,
          code: branch.code,
          timezone: branch.timezone,
          active: branch.is_active,
        })),
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "BUSINESS_CONTEXT_FAILED", message: "Business context could not be loaded." });
    }
  });
}
