import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import {
  CatalogError,
  createCatalogItem,
  deleteUnusedCatalogItem,
  listCatalogItems,
  loadCatalogItem,
  updateCatalogItem,
  type CreateCatalogItemBody,
  type UpdateCatalogItemBody,
} from "./catalog-service.js";
import type { DatabasePool } from "./db.js";

const CATALOG_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
const CATALOG_DELETE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN"];
const CATALOG_READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

export function registerCatalogRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: CreateCatalogItemBody }>("/v1/catalog/items", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = business(request.body?.businessId);
      const access = await requireBusinessRole(pool, auth, businessId, CATALOG_WRITE_ROLES);
      const item = await createCatalogItem(pool, access, request.body);
      return reply.code(201).send({ item });
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });

  app.get<{ Querystring: { businessId?: string } }>("/v1/catalog/items", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = business(request.query.businessId);
      await requireBusinessRole(pool, auth, businessId, CATALOG_READ_ROLES);
      return { items: await listCatalogItems(pool, businessId) };
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });

  app.get<{ Params: { itemId: string }; Querystring: { businessId?: string } }>("/v1/catalog/items/:itemId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = business(request.query.businessId);
      await requireBusinessRole(pool, auth, businessId, CATALOG_READ_ROLES);
      return { item: await loadCatalogItem(pool, businessId, request.params.itemId) };
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });

  app.patch<{ Params: { itemId: string }; Body: UpdateCatalogItemBody }>("/v1/catalog/items/:itemId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = business(request.body?.businessId);
      const access = await requireBusinessRole(pool, auth, businessId, CATALOG_WRITE_ROLES);
      return { item: await updateCatalogItem(pool, access, request.params.itemId, request.body) };
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });

  app.delete<{ Params: { itemId: string }; Querystring: { businessId?: string; expectedUpdatedAt?: string } }>("/v1/catalog/items/:itemId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = business(request.query.businessId);
      const expectedUpdatedAt = request.query.expectedUpdatedAt?.trim();
      if (!expectedUpdatedAt) throw new CatalogError("expectedUpdatedAt is required", 400, "REVISION_REQUIRED");
      const access = await requireBusinessRole(pool, auth, businessId, CATALOG_DELETE_ROLES);
      await deleteUnusedCatalogItem(pool, access, businessId, request.params.itemId, expectedUpdatedAt);
      return reply.code(204).send();
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });
}

function business(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new CatalogError("businessId is required", 400, "BUSINESS_REQUIRED");
  return normalized;
}

function sendCatalogError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload?: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof CatalogError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  if ((error as { code?: string })?.code === "23505") {
    return reply.code(409).send({ error: "SKU_EXISTS", message: "SKU already exists in this business" });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "CATALOG_FAILED", message: "The catalog request could not be completed." });
}
