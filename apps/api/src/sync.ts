import { applyReconciliationMutation, type ReconciliationPayload } from "./commerce/reconciliation.js";
import { applyTreasuryMutation, type TreasuryPayload } from "./commerce/treasury.js";
import { applyCashbookMutation, CashbookError, type CashbookMutationPayload } from "./commerce/cashbook.js";
import { applyPurchaseReturnMutation, type PurchaseReturnPayload } from "./commerce/purchase-returns.js";
import { applyPurchaseReceiveMutation, applySupplierPaymentMutation, PurchaseMutationError, type PurchaseReceiveMutationPayload, type SupplierPaymentPayload } from "./commerce/purchases.js";
import type {
  ClientMutation,
  CustomerCreateInput,
  CustomerUpdateInput,
  MutationResult,
  SupplierCreateInput,
  SupplierUpdateInput,
  SyncPushRequest,
  SyncResponse,
} from "@tradeos/contracts";
import {
  applyCustomerPaymentMutation,
  CustomerCreditError,
  type CustomerPaymentMutationPayload,
} from "./commerce/customer-credit.js";
import { applyReturnMutation, ReturnMutationError, type ReturnMutationPayload } from "./commerce/returns.js";
import { applySaleMutation, SaleMutationError, type SaleMutationPayload } from "./commerce/sales.js";
import {PriceRuleError} from "./commerce/price-rules.js";
import {ShiftSalePolicyError} from "./operations/shift-sale-policy.js";
import { applyExchangeMutation, ExchangeMutationError, type ExchangeMutationPayload } from "./commerce/exchanges.js";
import { applyInventoryAdjustmentMutation, InventoryAdjustmentError, type InventoryAdjustmentMutationPayload } from "./commerce/inventory-adjustments.js";
import { type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { AuthError } from "./auth/security.js";
import {
  CatalogError,
  createCatalogItem,
  updateCatalogItem,
  type CreateCatalogItemBody,
  type UpdateCatalogItemBody,
} from "./catalog-service.js";
import {
  createCustomer,
  updateCustomer,
  CustomerServiceError,
  CUSTOMER_WRITE_ROLES,
} from "./customer-service.js";
import {
  createSupplier,
  updateSupplier,
  SupplierServiceError,
  SUPPLIER_WRITE_ROLES,
} from "./supplier-service.js";
import type { DatabasePool } from "./db.js";

const MAX_BATCH_SIZE = 100;
const CATALOG_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
const CATALOG_MUTATIONS = new Set(["CATALOG_ITEM_CREATE", "CATALOG_ITEM_UPDATE", "CATALOG_ITEM_ARCHIVE", "CATALOG_ITEM_REACTIVATE"]);
const CUSTOMER_MUTATIONS = new Set(["CUSTOMER_CREATE", "CUSTOMER_UPDATE"]);
const SUPPLIER_MUTATIONS = new Set(["SUPPLIER_CREATE", "SUPPLIER_UPDATE"]);
// Once accepted, a refund, exchange or stock adjustment must never be
// silently reinterpreted as a *different* financial request with the same ID.
const STRICT_FINANCIAL_REPLAY_TYPES = new Set([
  "RETURN_CREATE", "REFUND_CREATE", "EXCHANGE_CREATE", "INVENTORY_ADJUSTMENT_CREATE",
]);
type StoredStatus = "RECEIVED" | "APPLIED" | "REJECTED";

class MasterDataSyncError extends Error {
  constructor(message: string, readonly code = "MASTER_DATA_SYNC_INVALID", readonly statusCode = 400) {
    super(message);
  }
}

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

/** Only PO-linked receipts use strict semantic replay validation.
 * Ordinary offline mutations preserve their established retry behavior.
 * occurredAt and authenticated actor fields are not economic receipt content.
 */
function poLinkedReplaySignature(payload:unknown):string|null {
  if (!payload || typeof payload!=="object" || Array.isArray(payload)) return null;
  const body=payload as Record<string,unknown>;
  if (typeof body.purchaseOrderId!=="string" || !body.purchaseOrderId) return null;
  const lines=Array.isArray(body.lines)?body.lines.map(value=>{
    const line=value && typeof value==="object" && !Array.isArray(value)
      ? value as Record<string,unknown>:{};
    return JSON.stringify([
      line.purchaseOrderLineId,line.itemId,line.purchaseUnitCode,
      line.quantity,line.unitCostMinor,
    ]);
  }).sort():[];
  return JSON.stringify([
    body.purchaseOrderId,body.supplierId,
    body.settlementMethod??"SUPPLIER_CREDIT",
    typeof body.supplierReference==="string"?body.supplierReference.trim():"",
    body.moneyAccountId??null,lines,
  ]);
}

/** Stable financial payload comparison despite PostgreSQL jsonb key ordering
 * and changes to server-enriched, authenticated staff attribution on retry.
 * Unlike occurredAt or actor IDs, amounts, quantities, dispositions, methods,
 * targets and note/reason fields are part of the immutable transaction.
 */
function financialReplaySignature(mutationType: string, payload: unknown): string | null {
  if (!STRICT_FINANCIAL_REPLAY_TYPES.has(mutationType)) return null;
  const excluded = mutationType === "INVENTORY_ADJUSTMENT_CREATE"
    ? new Set(["actorStaffId"])
    : new Set(["initiatedByStaffId", "approvedByStaffId", "actorStaffId"]);
  const sorted = (value: unknown, depth = 0): unknown => {
    if (depth > 32) throw new SyncRequestError("Financial mutation payload nesting exceeds limit");
    if (Array.isArray(value)) return value.map((part) => sorted(part, depth + 1));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !excluded.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, part]) => [key, sorted(part, depth + 1)]),
    );
  };
  return JSON.stringify(sorted(payload));
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
      const existing = await client.query<{
        status: StoredStatus; result_payload: unknown | null; received_at: Date;
        id:string;request_payload:ClientMutation;branch_id:string|null;mutation_type:string;same_request:boolean;recovery_claimed:boolean;
      }>(
        `SELECT id,status,result_payload,received_at,request_payload,branch_id,mutation_type,
                request_payload=$4::jsonb AS same_request,
                EXISTS (SELECT 1 FROM audit_events a WHERE a.business_id=sync_mutations.business_id
                  AND a.entity_type='SYNC_MUTATION' AND a.entity_id=sync_mutations.id
                  AND a.event_type='LEGACY_PURCHASE_RECOVERY_CLAIMED') AS recovery_claimed
           FROM sync_mutations
         WHERE business_id=$1 AND client_id=$2 AND client_mutation_id=$3 FOR UPDATE`,
        [mutation.businessId, mutation.clientId, mutation.clientMutationId, JSON.stringify(mutation)],
      );
      const prior = existing.rows[0];
      if (!prior) throw new Error("Idempotent mutation record disappeared during transaction");
      if (prior.recovery_claimed && (!prior.same_request || prior.branch_id !== (mutation.branchId ?? null) ||
          mutation.mutationType !== prior.mutation_type)) {
        await client.query("COMMIT");
        return rejection(mutation.clientMutationId,serverReceivedAt,"PURCHASE_REPLAY_CONFLICT",
          new Error("The recovered purchase receipt ID belongs to its original request."));
      }
      const existingPO=poLinkedReplaySignature(prior.request_payload?.payload);
      const incomingPO=poLinkedReplaySignature(mutation.payload);
      const changedLinkedPO=(existingPO!==null||incomingPO!==null) &&
        (existingPO!==incomingPO || prior.mutation_type!==mutation.mutationType ||
          prior.branch_id!==(mutation.branchId??null));
      const previousFinancial = financialReplaySignature(prior.mutation_type, prior.request_payload?.payload);
      const incomingFinancial = financialReplaySignature(mutation.mutationType, mutation.payload);
      const changedFinancial = (previousFinancial !== null || incomingFinancial !== null) &&
        (previousFinancial !== incomingFinancial || prior.mutation_type !== mutation.mutationType ||
          prior.branch_id !== (mutation.branchId ?? null));
      // Only the precise historical missing-settlement failure is eligible.
      // Compare the entire server-enriched JSONB request (including the original
      // timestamp and authenticated actor). Never apply a stored actor or a
      // modified receipt. The row lock serializes concurrent recovery claims.
      if (!changedLinkedPO && !changedFinancial && prior.status === "REJECTED" &&
          isLegacyPurchaseSettlementRejection(prior.mutation_type, prior.request_payload, prior.result_payload)) {
        if (!prior.same_request || !mutation.branchId || prior.branch_id !== mutation.branchId ||
            mutation.mutationType !== "PURCHASE_RECEIVE_CREATE") {
          await client.query("COMMIT");
          return rejection(mutation.clientMutationId, serverReceivedAt, "PURCHASE_REPLAY_CONFLICT",
            new Error("The historical purchase receipt must be retried with its original authorized request."));
        }
        const claimed = await client.query(
          `UPDATE sync_mutations SET status='RECEIVED',result_payload=NULL,applied_at=NULL
           WHERE id=$1 AND status='REJECTED' AND NOT EXISTS (
             SELECT 1 FROM audit_events WHERE business_id=$2 AND entity_type='SYNC_MUTATION'
               AND entity_id=$1 AND event_type='LEGACY_PURCHASE_RECOVERY_CLAIMED'
           ) RETURNING id`,
          [prior.id, mutation.businessId],
        );
        if (claimed.rowCount === 1) {
          const actor = (mutation.payload as PurchaseReceiveMutationPayload).receivedByStaffId;
          await client.query(
            `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload)
             VALUES ($1,$2,$3,'LEGACY_PURCHASE_RECOVERY_CLAIMED','SYNC_MUTATION',$4,$5,$6::jsonb)`,
            [mutation.businessId, mutation.branchId, actor, prior.id, mutation.clientMutationId,
             JSON.stringify({ previousError: prior.result_payload, recoverySettlement: "SUPPLIER_CREDIT" })],
          );
          // Keep the claim, audit, inventory, payable and sync acknowledgement
          // in this same transaction. On crash, all roll back together.
          // Revalidate the actor's current membership under lock before posting.
          const authorized = await client.query(
            `SELECT m.id FROM business_memberships m JOIN staff s
               ON s.id=m.staff_id AND s.business_id=m.business_id
             JOIN businesses b ON b.id=m.business_id
             WHERE m.business_id=$1 AND m.staff_id=$2 AND m.status='ACTIVE'
               AND s.is_active=true AND b.status='ACTIVE'
               AND m.role IN ('OWNER','ADMIN','MANAGER','INVENTORY','ACCOUNTANT')
             FOR SHARE OF m,s,b`,
            [mutation.businessId,actor],
          );
          if (!authorized.rowCount) throw new AuthError("Purchase recovery access is unavailable",403,"BUSINESS_ACCESS_DENIED");
          await client.query("SAVEPOINT legacy_receipt_post");
          let recoveryResult: unknown;
          let status: "APPLIED" | "REJECTED" = "APPLIED";
          try {
            recoveryResult = await applyPurchaseReceiveMutation(pool, {
              businessId: mutation.businessId, branchId: mutation.branchId,
              clientMutationId: mutation.clientMutationId, occurredAt: mutation.occurredAt,
              requireNewReceipt: true,
            }, mutation.payload as PurchaseReceiveMutationPayload, client);
            await client.query("RELEASE SAVEPOINT legacy_receipt_post");
          } catch (error) {
            // A known business rejection remains auditable. Unexpected failures
            // roll back the entire recovery so the original request can retry.
            if (!(error instanceof PurchaseMutationError)) throw error;
            await client.query("ROLLBACK TO SAVEPOINT legacy_receipt_post");
            await client.query("RELEASE SAVEPOINT legacy_receipt_post");
            status = "REJECTED";
            recoveryResult = { errorCode: error.code, errorMessage: error.message };
          }
          const acknowledged = await client.query(
            `UPDATE sync_mutations SET status=$2,result_payload=$3::jsonb,applied_at=now()
             WHERE id=$1 AND status='RECEIVED'`,
            [prior.id,status,JSON.stringify(recoveryResult)],
          );
          if (acknowledged.rowCount !== 1) throw new Error("Legacy receipt acknowledgement lost");
          await client.query("COMMIT");
          return {
            clientMutationId:mutation.clientMutationId,status,serverReceivedAt:prior.received_at.toISOString(),
            result:recoveryResult,
            ...(status==="REJECTED"&&isErrorPayload(recoveryResult)?recoveryResult:{}),
          };
        }
      }
      await client.query("COMMIT");
      if(changedLinkedPO)return rejection(mutation.clientMutationId,serverReceivedAt,
        "PURCHASE_REPLAY_CONFLICT",
        new Error("A supplier-order receipt with this mutation ID was already submitted with different content"));
      if(changedFinancial)return rejection(mutation.clientMutationId,serverReceivedAt,
        "FINANCIAL_REPLAY_CONFLICT",
        new Error("This refund, exchange or stock adjustment ID already belongs to another set of transaction details. Review the original posting before attempting a new operation."));
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
      || error instanceof PriceRuleError
      || error instanceof SaleMutationError
      || error instanceof ShiftSalePolicyError
      || error instanceof ReturnMutationError
      || error instanceof ExchangeMutationError
      || error instanceof CustomerCreditError
      || error instanceof PurchaseMutationError
      || error instanceof InventoryAdjustmentError
      || error instanceof CatalogError
      || error instanceof CustomerServiceError
      || error instanceof SupplierServiceError
      || error instanceof MasterDataSyncError
      || error instanceof AuthError
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
  if (CUSTOMER_MUTATIONS.has(mutation.mutationType) || SUPPLIER_MUTATIONS.has(mutation.mutationType)) {
    return applyMasterDataMutation(pool, mutation);
  }
  return applyEconomicMutation(pool, mutation);
}

async function applyMasterDataMutation(pool: DatabasePool, mutation: ClientMutation): Promise<unknown> {
  if (typeof mutation.payload !== "object" || mutation.payload === null || Array.isArray(mutation.payload)) {
    throw new MasterDataSyncError("Master-data mutation payload must be an object");
  }
  const payload = mutation.payload as Record<string, unknown>;
  const actorStaffId = requiredMasterDataString(payload.actorStaffId, "actorStaffId");
  const actorRole = requiredMasterDataRole(payload.actorRole, mutation.mutationType);
  const access: BusinessAccess = {
    membershipId: `sync:${mutation.clientId}`,
    businessId: mutation.businessId,
    role: actorRole,
    staffId: actorStaffId,
  };
  const { actorStaffId: _ignoredStaff, actorRole: _ignoredRole, ...rest } = payload;

  if (mutation.mutationType === "CUSTOMER_CREATE") {
    rejectSensitiveMasterData(rest, ["creditLimitMinor", "creditTermsDays"]);
    const customer = await createCustomer(pool, access, rest as unknown as CustomerCreateInput);
    return { customer };
  }
  if (mutation.mutationType === "CUSTOMER_UPDATE") {
    rejectSensitiveMasterData(rest, ["creditLimitMinor", "creditTermsDays", "active"]);
    const customerId = requiredMasterDataString(rest.customerId, "customerId");
    const { customerId: _ignoredCustomerId, ...input } = rest;
    const customer = await updateCustomer(pool, access, customerId, input as unknown as CustomerUpdateInput);
    return { customer };
  }
  if (mutation.mutationType === "SUPPLIER_CREATE") {
    rejectSensitiveMasterData(rest, ["paymentTermsDays"]);
    const supplier = await createSupplier(pool, access, rest as unknown as SupplierCreateInput);
    return { supplier };
  }
  if (mutation.mutationType === "SUPPLIER_UPDATE") {
    rejectSensitiveMasterData(rest, ["paymentTermsDays", "active"]);
    const supplierId = requiredMasterDataString(rest.supplierId, "supplierId");
    const { supplierId: _ignoredSupplierId, ...input } = rest;
    const supplier = await updateSupplier(pool, access, supplierId, input as unknown as SupplierUpdateInput);
    return { supplier };
  }
  throw new MasterDataSyncError(`Unsupported master-data mutationType: ${mutation.mutationType}`);
}

function rejectSensitiveMasterData(payload: Record<string, unknown>, fields: readonly string[]): void {
  if (fields.some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
    throw new MasterDataSyncError(
      "Credit, status and payment-term changes require an online server check.",
      "MASTER_DATA_SYNC_SENSITIVE_CHANGE",
      409,
    );
  }
}

function requiredMasterDataString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MasterDataSyncError(`${name} is required`);
  }
  return value.trim();
}

function requiredMasterDataRole(value: unknown, mutationType: string): BusinessRole {
  const roles = CUSTOMER_MUTATIONS.has(mutationType) ? CUSTOMER_WRITE_ROLES : SUPPLIER_WRITE_ROLES;
  if (typeof value !== "string" || !roles.includes(value as BusinessRole)) {
    throw new MasterDataSyncError("actorRole is invalid", "ROLE_FORBIDDEN", 403);
  }
  return value as BusinessRole;
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
    case "EXCHANGE_CREATE":
      return applyExchangeMutation(pool, context, mutation.payload as ExchangeMutationPayload);
    case "CUSTOMER_PAYMENT_CREATE":
      return applyCustomerPaymentMutation(pool, context, mutation.payload as CustomerPaymentMutationPayload);
    case "INVENTORY_ADJUSTMENT_CREATE":
      return applyInventoryAdjustmentMutation(pool, context, mutation.payload as InventoryAdjustmentMutationPayload);
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

function isLegacyPurchaseSettlementRejection(type: string, request: unknown, result: unknown): boolean {
  if (type !== "PURCHASE_RECEIVE_CREATE" || !isErrorPayload(result) ||
      result.errorCode !== "PURCHASE_INVALID" || result.errorMessage !== "Invalid settlement method" ||
      !request || typeof request !== "object" || Array.isArray(request)) return false;
  const body = (request as { payload?: unknown }).payload;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const payload = body as Record<string, unknown>;
  const method = payload.settlementMethod;
  return typeof payload.receivedByStaffId === "string" && payload.receivedByStaffId.length > 0 &&
    payload.purchaseOrderId === undefined && payload.moneyAccountId === undefined &&
    (method === undefined || method === null || (typeof method === "string" && method.trim() === ""));
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
