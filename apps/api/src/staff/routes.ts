import type {
  AcceptStaffInvitationRequest,
  CreateStaffInvitationRequest,
  CreateStaffRequest,
  RegisterStaffInvitationRequest,
  UpdateStaffRequest,
} from "@tradeos/contracts";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import type { DatabasePool } from "../db.js";
import {
  acceptStaffInvitation,
  createStaff,
  createStaffInvitation,
  listStaff,
  registerStaffInvitationAccount,
  updateStaff,
} from "./staff-service.js";

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

  app.post<{ Body: RegisterStaffInvitationRequest }>("/v1/staff/invitations/accept/register", async (request, reply) => {
    try {
      const result = await registerStaffInvitationAccount(pool, request.body);
      return reply.code(201).send(result);
    } catch (error) {
      return sendStaffError(request, reply, error, "INVITATION_REGISTER_FAILED", "Invitation registration could not be completed.");
    }
  });

  app.post<{ Body: AcceptStaffInvitationRequest }>("/v1/staff/invitations/accept", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const acceptance = await acceptStaffInvitation(pool, auth, request.body);
      return { acceptance };
    } catch (error) {
      return sendStaffError(request, reply, error, "INVITATION_ACCEPT_FAILED", "Invitation could not be accepted.");
    }
  });

  app.post<{ Params: { staffId: string }; Body: CreateStaffInvitationRequest }>(
    "/v1/staff/:staffId/invitations",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const result = await createStaffInvitation(pool, auth, request.params.staffId, request.body);
        return reply.code(201).send(result);
      } catch (error) {
        return sendStaffError(request, reply, error, "INVITATION_CREATE_FAILED", "Invitation could not be created.");
      }
    },
  );

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
