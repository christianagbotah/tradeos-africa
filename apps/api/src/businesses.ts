import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import {
  createBranch,
  createOwnedBusiness,
  loadBusinessContext,
  setBranchActive,
  updateBranch,
  updateBusinessProfile,
  type BranchCreateRequest,
  type BranchUpdateRequest,
  type BusinessProfileUpdateRequest,
  type CreateOwnedBusinessRequest,
} from "./business-management-service.js";
import type { DatabasePool } from "./db.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

export function registerBusinessRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: CreateOwnedBusinessRequest }>("/v1/businesses", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const created = await createOwnedBusiness(pool, auth, request.body, "BUSINESS_CREATED");
      return reply.code(201).send(created);
    } catch (error) {
      return sendBusinessError(request, reply, error, "BUSINESS_CREATE_FAILED", "The business could not be created.");
    }
  });

  app.patch<{ Params: { businessId: string }; Body: BusinessProfileUpdateRequest }>(
    "/v1/businesses/:businessId",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const business = await updateBusinessProfile(pool, auth, request.params.businessId, request.body ?? {});
        return { business };
      } catch (error) {
        return sendBusinessError(request, reply, error, "BUSINESS_UPDATE_FAILED", "The business could not be updated.");
      }
    },
  );

  app.get<{ Params: { businessId: string } }>("/v1/businesses/:businessId/context", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const access = await requireBusinessRole(pool, auth, request.params.businessId, READ_ROLES);
      const context = await loadBusinessContext(pool, access.businessId);
      return {
        business: context.business,
        membership: { role: access.role, staffId: access.staffId },
        branches: context.branches,
      };
    } catch (error) {
      return sendBusinessError(request, reply, error, "BUSINESS_CONTEXT_FAILED", "Business context could not be loaded.");
    }
  });

  app.post<{ Params: { businessId: string }; Body: BranchCreateRequest }>(
    "/v1/businesses/:businessId/branches",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const branch = await createBranch(pool, auth, request.params.businessId, request.body);
        return reply.code(201).send({ branch });
      } catch (error) {
        return sendBusinessError(request, reply, error, "BRANCH_CREATE_FAILED", "The branch could not be created.");
      }
    },
  );

  app.patch<{ Params: { businessId: string; branchId: string }; Body: BranchUpdateRequest }>(
    "/v1/businesses/:businessId/branches/:branchId",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const branch = await updateBranch(pool, auth, request.params.businessId, request.params.branchId, request.body ?? {});
        return { branch };
      } catch (error) {
        return sendBusinessError(request, reply, error, "BRANCH_UPDATE_FAILED", "The branch could not be updated.");
      }
    },
  );

  app.post<{ Params: { businessId: string; branchId: string } }>(
    "/v1/businesses/:businessId/branches/:branchId/deactivate",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const branch = await setBranchActive(pool, auth, request.params.businessId, request.params.branchId, false);
        return { branch };
      } catch (error) {
        return sendBusinessError(request, reply, error, "BRANCH_DEACTIVATE_FAILED", "The branch could not be deactivated.");
      }
    },
  );

  app.post<{ Params: { businessId: string; branchId: string } }>(
    "/v1/businesses/:businessId/branches/:branchId/reactivate",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const branch = await setBranchActive(pool, auth, request.params.businessId, request.params.branchId, true);
        return { branch };
      } catch (error) {
        return sendBusinessError(request, reply, error, "BRANCH_REACTIVATE_FAILED", "The branch could not be reactivated.");
      }
    },
  );
}

function sendBusinessError(
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
