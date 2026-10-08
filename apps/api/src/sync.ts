import { applyReconciliationMutation, type ReconciliationPayload } from "./commerce/reconciliation.js";
import { applyTreasuryMutation, type TreasuryPayload } from "./commerce/treasury.js";
import { applyCashbookMutation, CashbookError, type CashbookMutationPayload } from "./commerce/cashbook.js";
import { applyPurchaseReturnMutation, type PurchaseReturnPayload } from "./commerce/purchase-returns.js";
import { applyPurchaseReceiveMutation, applySupplierPaymentMutation, PurchaseMutationError, type PurchaseReceiveMutationPayload, type SupplierPaymentPayload } from "./commerce/purchases.js";
import type { ClientMutation, MutationResult, SyncPushRequest, SyncResponse } from "@tradeos/contracts";
import {
  applyCustomerPaymentMutation,
  CustomerCreditError,
  type CustomerPaymentMutationPayload,
} from "./commerce/customer-credit.js";
import { applyReturnMutation, ReturnMutationError, type ReturnMutationPayload } from "./commerce/returns.js";
import { applySaleMutation, SaleMutationError, type SaleMutationPayload } from "./commerce/sales.js";
import { type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import {
  CatalogError,
  createCatalogItem,
  updateCatalogItem,
  type CreateCatalogItemBody,
  type UpdateCatalogItemBody,
} from "./catalog-service.js";
import type { DatabasePool } from "./db.js";

const MAX_BATCH_SIZE = 100;
const CATALOG_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
const CATALOG_MUTATIONS = new Set(["CATALOG_ITEM_CREATE", "CATALOG_ITEM_UPDATE", "CATALOG_ITEM_ARCHIVE", "CATALOG_ITEM_REACTIVATE"]);
type StoredStatus = "RECEIVED" | "APPLIED" | "REJECTED";

export class SyncRequestError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export async function ingestSyncBatch(pool: DatabasePool, request: SyncPushRequest): Promise<SyncResponse> {
  if (!Array.isArray(request.mutations)) throw new SyncRequestError("mutations must be an array");
  if (request.mutations.length > MAX_BATCH_SIZE) {
    throw new SyncRequestError(`A sync batch may contain at most ${MAX_BATCH_SIZE} mutations`, 413);
  }

  const mutationResults: MutationResult[] = [];
  for (const mutation of request.mutations) mutationResults.push(await ingestMutation(pool, mutation));

  return {
    mutationResults,
    events: [],
    ...(request.cursor ? { nextCursor: request.cursor } : {}),
  };
}

async function ingestMutation(pool: DatabasePool, mutation: ClientMutation): Promise<MutationResult> {
  assertMutationShape(mutation);
  const serverReceivedAt = new Date().toISOString();
  const client = await pool.connect();
  let insertedNew = false;

  try {
    await client.query("BEGIN");
    const inserted = await client.query<{
      status: StoredStatus;
      result_payload: unknown | null;
      received_at: Date;
    }>(
      `INSERT INTO sync_mutations (
         business_id,branch_id,client_id,client_mutation_id,mutation_type,request_payload,status
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'RECEIVED')
       ON CONFLICT (business_id,client_id,client_mutation_id) DO NOTHING
       RETURNING status,result_payload,received_at`,
      [mutation.businessId, mutation.branchId ?? null, mutation.clientId, mutation.clientMutationId,
       mutation.mutationType, JSON.stringify(mutation)],
    );

    insertedNew = (inserted.rowCount ?? 0) === 1;
    if (!insertedNew) {
      const existing = await client.query<{ status: StoredStatus; result_payload: unknown | null; received_at: Date }>(
        `SELECT status,result_payload,received_at FROM sync_mutations
         WHERE business_id=$1 AND client_id=$2 AND client_mutation_id=$3 FOR SHARE`,
        [mutation.businessId, mutation.clientId, mutation.clientMutationId],
      );
      const prior = existing.rows[0];
      if (!prior) throw new Error("Idempotent mutation record disappeared during transaction");
      await client.query("COMMIT");
      return {
        clientMutationId: mutation.clientMutationId,
        status: prior.status,
        serverReceivedAt: prior.received_at.toISOString(),
        ...(prior.result_payload !== null ? { result: prior.result_payload } : {}),
        ...(prior.status === "REJECTED" && isErrorPayload(prior.result_payload)
          ? { errorCode: prior.result_payload.errorCode, errorMessage: prior.result_payload.errorMessage }
          : {}),
      };
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return rejection(mutation.clientMutationId, serverReceivedAt, "SYNC_INGEST_FAILED", error);
  } finally {
    client.release();
  }

  if (!insertedNew) {
    return { clientMutationId: mutation.clientMutationId, status: "RECEIVED", serverReceivedAt };
  }

  try {
    const result = await applyMutation(pool, mutation);
    await pool.query(
      `UPDATE sync_mutations SET status='APPLIED',result_payload=$4::jsonb,applied_at=now()
       WHERE business_id=$1 AND client_id=$2 AND client_mutation_id=$3`,
      [mutation.businessId, mutation.clientId, mutation.clientMutationId, JSON.stringify(result)],
    );
    return { clientMutationId: mutation.clientMutationId, status: "APPLIED", serverReceivedAt, result };
  } catch (error) {
    const code = error instanceof CashbookError
      || error instanceof SaleMutationError
      || error instanceof ReturnMutationError
      || error instanceof CustomerCreditError
      || error instanceof PurchaseMutationError
      || error instanceof CatalogError
      ? error.code
      : "MUTATION_APPLY_FAILED";
    const message = error instanceof Error ? error.message : "Unknown mutation application error";
    const result = { errorCode: code, errorMessage: message };
    await pool.query(
      `UPDATE sync_mutations SET status='REJECTED',result_payload=$4::jsonb,applied_at=now()
       WHERE business_id=$1 AND client_id=$2 AND client_mutation_id=$3`,
      [mutation.businessId, mutation.clientId, mutation.clientMutationId, JSON.stringify(result)],
    );
    return {
      clientMutationId: mutation.clientMutationId,
      status: "REJECTED",
      serverReceivedAt,
      errorCode: code,
      errorMessage: message,
      result,
    };
  }
}

async function applyMutation(pool: DatabasePool, mutation: ClientMutation): Promise<unknown> {
  if (CATALOG_MUTATIONS.has(mutation.mutationType)) return applyCatalogMutation(pool, mutation);
  return applyEconomicMutation(pool, mutation);
}

async function applyCatalogMutation(pool: DatabasePool, mutation: ClientMutation): Promise<unknown> {
  if (typeof mutation.payload !== "object" || mutation.payload === null || Array.isArray(mutation.payload)) {
    throw new CatalogError("Catalog mutation payload must be an object");
  }
  const payload = mutation.payload as Record<string, unknown>;
  const actorStaffId = requiredPayloadString(payload.actorStaffId, "actorStaffId");
  const actorRole = requiredCatalogRole(payload.actorRole);
  const access: BusinessAccess = {
    membershipId: `sync:${mutation.clientId}`,
    businessId: mutation.businessId,
    role: actorRole,
    staffId: actorStaffId,
  };

  const { actorStaffId: _ignoredStaff, actorRole: _ignoredRole, ...rest } = payload;
  if (mutation.mutationType === "CATALOG_ITEM_CREATE") {
    const item = await createCatalogItem(pool, access, { ...rest, businessId: mutation.businessId } as unknown as CreateCatalogItemBody);
    return { item };
  }

  const itemId = requiredPayloadString(rest.itemId, "itemId");
  const { itemId: _ignoredItemId, ...updateRest } = rest;
  const active = mutation.mutationType === "CATALOG_ITEM_ARCHIVE"
    ? false
    : mutation.mutationType === "CATALOG_ITEM_REACTIVATE"
      ? true
      : updateRest.active;
  const item = await updateCatalogItem(pool, access, itemId, {
    ...updateRest,
    businessId: mutation.businessId,
    ...(active === undefined ? {} : { active }),
  } as unknown as UpdateCatalogItemBody);
  return { item };
}

async function applyEconomicMutation(pool: DatabasePool, mutation: ClientMutation): Promise<unknown> {
  if (!mutation.branchId) throw new SyncRequestError("branchId is required for economic mutations");
  const context = {
    businessId: mutation.businessId,
    branchId: mutation.branchId,
    clientMutationId: mutation.clientMutationId,
    occurredAt: mutation.occurredAt,
  };

  switch (mutation.mutationType) {
    case "OPERATING_DAY_OPEN_CREATE":
    case "OPERATING_DAY_CLOSE_CREATE":
    case "SHIFT_OPEN_CREATE":
    case "SHIFT_CLOSE_CREATE":
      return applyReconciliationMutation(pool,context,mutation.payload as ReconciliationPayload,mutation.mutationType);
    case "MONEY_TRANSFER_CREATE":
    case "MONEY_RECONCILIATION_CREATE":
    case "MONEY_RECONCILIATION_RESOLVE":
      return applyTreasuryMutation(pool,context,mutation.payload as TreasuryPayload,mutation.mutationType);
    case "EXPENSE_CREATE":
    case "CASHBOOK_ADJUSTMENT_CREATE":
      return applyCashbookMutation(pool,context,mutation.payload as CashbookMutationPayload,mutation.mutationType === "CASHBOOK_ADJUSTMENT_CREATE");
    case "PURCHASE_RETURN_CREATE":
      return applyPurchaseReturnMutation(pool, context, mutation.payload as PurchaseReturnPayload);
    case "PURCHASE_RECEIVE_CREATE":
      return applyPurchaseReceiveMutation(pool, context, mutation.payload as PurchaseReceiveMutationPayload);
    case "SUPPLIER_PAYMENT_CREATE":
      return applySupplierPaymentMutation(pool, context, mutation.payload as SupplierPaymentPayload);
    case "SALE_CREATE":
      return applySaleMutation(pool, context, mutation.payload as SaleMutationPayload);
    case "RETURN_CREATE":
    case "REFUND_CREATE":
      return applyReturnMutation(pool, context, mutation.payload as ReturnMutationPayload);
    case "CUSTOMER_PAYMENT_CREATE":
      return applyCustomerPaymentMutation(pool, context, mutation.payload as CustomerPaymentMutationPayload);
    default:
      throw new SyncRequestError(`Unsupported mutationType: ${mutation.mutationType}`);
  }
}

function requiredPayloadString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new CatalogError(`${name} is required`);
  return value.trim();
}

function requiredCatalogRole(value: unknown): BusinessRole {
  if (typeof value !== "string" || !CATALOG_WRITE_ROLES.includes(value as BusinessRole)) {
    throw new CatalogError("actorRole is invalid", 403, "ROLE_FORBIDDEN");
  }
  return value as BusinessRole;
}

function isErrorPayload(value: unknown): value is { errorCode: string; errorMessage: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { errorCode?: unknown }).errorCode === "string"
    && typeof (value as { errorMessage?: unknown }).errorMessage === "string";
}

function rejection(clientMutationId: string, serverReceivedAt: string, code: string, error: unknown): MutationResult {
  return {
    clientMutationId,
    status: "REJECTED",
    serverReceivedAt,
    errorCode: code,
    errorMessage: error instanceof Error ? error.message : "Unknown sync ingestion error",
  };
}

function assertMutationShape(mutation: ClientMutation): void {
  const required: Array<[string, unknown]> = [
    ["businessId", mutation.businessId], ["clientId", mutation.clientId],
    ["clientMutationId", mutation.clientMutationId], ["mutationType", mutation.mutationType],
    ["occurredAt", mutation.occurredAt],
  ];
  for (const [name, value] of required) {
    if (typeof value !== "string" || value.trim() === "") throw new SyncRequestError(`${name} is required`);
  }
  if (Number.isNaN(Date.parse(mutation.occurredAt))) throw new SyncRequestError("occurredAt must be an ISO date-time string");
}
