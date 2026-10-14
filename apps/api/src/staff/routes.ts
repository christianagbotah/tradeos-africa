import type { CreateStaffRequest, UpdateStaffRequest } from "@tradeos/contracts";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import type { DatabasePool } from "../db.js";
import { createStaff, listStaff, updateStaff } from "./staff-service.js";

export function registerStaffRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: { businessId?: string } }>("/v1/staff", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const staff = await listStaff(pool, auth, request.query.businessId);
      return { staff };
    } catch (error) {
      return sendStaffError(request, reply, error, "STAFF_LIST_FAILED", "Staff directory could not be loaded.");
    }
  });

  app.post<{ Body: CreateStaffRequest }>("/v1/staff", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const staff = await createStaff(pool, auth, request.body);
      return reply.code(201).send({ staff });
    } catch (error) {
      return sendStaffError(request, reply, error, "STAFF_CREATE_FAILED", "Staff member could not be created.");
    }
  });

  app.patch<{ Params: { staffId: string }; Body: UpdateStaffRequest }>("/v1/staff/:staffId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const staff = await updateStaff(pool, auth, request.params.staffId, request.body);
      return { staff };
    } catch (error) {
      return sendStaffError(request, reply, error, "STAFF_UPDATE_FAILED", "Staff member could not be updated.");
    }
  });
}

function sendStaffError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: fallbackCode, message: fallbackMessage });
}
