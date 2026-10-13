/**
 * TradeOS Web — pure mutation builders for the 11 supported workflows.
 *
 * Each builder produces the *exact* payload shape the server reads, no more,
 * no less. The server is the single source of truth for:
 *
 *  - prices, totals, balances, COGS, stock valuations (server-derived)
 *  - actorStaffId / actorRole / receivedByStaffId / paidByStaffId /
 *    cashierStaffId (server-enriched from the access token)
 *  - active flag for CATALOG_ITEM_ARCHIVE / REACTIVATE (derived from the
 *    mutationType by the sync layer)
 *  - creditLimitMinor / creditTermsDays / active for CUSTOMER_UPDATE and
 *    paymentTermsDays / active for SUPPLIER_UPDATE (rejected by the sync
 *    layer as sensitive — they need an online server check)
 *
 * The builders never include those forbidden fields. Components must call
 * `roleCan(role, ROLES)` before rendering an action button so unauthorized
 * users never see an enqueue path.
 *
 * The role lists mirror `apps/api/src/app.ts` exactly. Keeping them here lets
 * the components and tests share a single source of truth without importing
 * server code.
 */

import type { QueuedMutation } from "@tradeos/client-core/sync-runtime";

// --- Role lists (mirror apps/api/src/app.ts) ------------------------------

export type WorkspaceRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "CASHIER"
  | "SALES"
  | "INVENTORY"
  | "ACCOUNTANT"
  | "STAFF"
  | "VIEWER";

export const CATALOG_WRITE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
export const CUSTOMER_WRITE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"];
export const CUSTOMER_PAYMENT_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
export const SUPPLIER_WRITE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"];
export const SUPPLIER_PAYMENT_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
export const PURCHASE_RETURN_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"];
export const CASHBOOK_ADJUSTMENT_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
export const EXPENSE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
export const TREASURY_RECONCILE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
export const TREASURY_TRANSFER_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];

/** True if the role appears in the supplied list. */
export function roleCan(role: WorkspaceRole, allowed: readonly WorkspaceRole[]): boolean {
  return allowed.includes(role);
}

// --- Mutation type constants ----------------------------------------------

export const CATALOG_ITEM_CREATE_TYPE = "CATALOG_ITEM_CREATE";
export const CATALOG_ITEM_UPDATE_TYPE = "CATALOG_ITEM_UPDATE";
export const CATALOG_ITEM_ARCHIVE_TYPE = "CATALOG_ITEM_ARCHIVE";
export const CATALOG_ITEM_REACTIVATE_TYPE = "CATALOG_ITEM_REACTIVATE";
export const INVENTORY_ADJUSTMENT_CREATE_TYPE = "INVENTORY_ADJUSTMENT_CREATE";
export const CUSTOMER_UPDATE_TYPE = "CUSTOMER_UPDATE";
export const CUSTOMER_PAYMENT_CREATE_TYPE = "CUSTOMER_PAYMENT_CREATE";
export const SUPPLIER_UPDATE_TYPE = "SUPPLIER_UPDATE";
export const SUPPLIER_PAYMENT_CREATE_TYPE = "SUPPLIER_PAYMENT_CREATE";
export const MONEY_TRANSFER_CREATE_TYPE = "MONEY_TRANSFER_CREATE";
export const MONEY_RECONCILIATION_CREATE_TYPE = "MONEY_RECONCILIATION_CREATE";
export const MONEY_RECONCILIATION_RESOLVE_TYPE = "MONEY_RECONCILIATION_RESOLVE";
export const PURCHASE_RETURN_CREATE_TYPE = "PURCHASE_RETURN_CREATE";
export const CASHBOOK_ADJUSTMENT_CREATE_TYPE = "CASHBOOK_ADJUSTMENT_CREATE";

/** All 14 mutation types implemented by this module. */
export const MUTATION_TYPES: readonly string[] = [
  CATALOG_ITEM_CREATE_TYPE,
  CATALOG_ITEM_UPDATE_TYPE,
  CATALOG_ITEM_ARCHIVE_TYPE,
  CATALOG_ITEM_REACTIVATE_TYPE,
  INVENTORY_ADJUSTMENT_CREATE_TYPE,
  CUSTOMER_UPDATE_TYPE,
  CUSTOMER_PAYMENT_CREATE_TYPE,
  SUPPLIER_UPDATE_TYPE,
  SUPPLIER_PAYMENT_CREATE_TYPE,
  MONEY_TRANSFER_CREATE_TYPE,
  MONEY_RECONCILIATION_CREATE_TYPE,
  MONEY_RECONCILIATION_RESOLVE_TYPE,
  PURCHASE_RETURN_CREATE_TYPE,
  CASHBOOK_ADJUSTMENT_CREATE_TYPE,
];

// --- Common types ---------------------------------------------------------

export type PaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

export type CatalogRecoveryMethod = "CREDIT_NOTE" | "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

export type ReconciliationType = "CASH_COUNT" | "STATEMENT";

export type CashbookAdjustmentReason = "OPENING_BALANCE" | "CORRECTION" | "OWNER_INJECTION" | "OWNER_WITHDRAWAL";

// --- CATALOG_ITEM_CREATE / CATALOG_ITEM_UPDATE ---------------------------

/** Mirrors CatalogUnitInput in apps/api/src/catalog-service.ts. */
export interface CatalogUnitInput {
  code: string;
  label: string;
  canPurchase?: boolean;
  canSell?: boolean;
  canStock?: boolean;
  defaultSalePriceMinor?: number | null;
}

/** Mirrors ConversionInput in apps/api/src/catalog-service.ts. */
export interface CatalogConversionInput {
  fromUnitCode: string;
  toUnitCode: string;
  factor: number;
}

export interface CatalogItemCreateInput {
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  trackStock: boolean;
  stockUnitCode: string | null;
  units: ReadonlyArray<CatalogUnitInput>;
  conversions: ReadonlyArray<CatalogConversionInput>;
}

/**
 * Builds the payload for CATALOG_ITEM_CREATE. `businessId` travels on the
 * mutation envelope and `actorStaffId` / `actorRole` are injected by the
 * sync layer from the access token — the client never sends them.
 *
 * The units/conversions arrays are the canonical multi-unit contract
 * (crate → bottle → glass). Flattening them into a single sale unit is what
 * broke POS previously; the server rejects payloads without `units`.
 */
export function buildCatalogItemCreatePayload(input: CatalogItemCreateInput): Record<string, unknown> {
  return {
    name: input.name,
    sku: input.sku,
    kind: input.kind,
    trackStock: input.trackStock,
    ...(input.stockUnitCode ? { stockUnitCode: input.stockUnitCode } : {}),
    units: input.units.map((unit) => ({
      code: unit.code,
      label: unit.label,
      canPurchase: unit.canPurchase ?? false,
      canSell: unit.canSell ?? false,
      canStock: unit.canStock ?? false,
      ...(unit.defaultSalePriceMinor === null || unit.defaultSalePriceMinor === undefined
        ? {}
        : { defaultSalePriceMinor: unit.defaultSalePriceMinor }),
    })),
    conversions: input.conversions.map((conversion) => ({
      fromUnitCode: conversion.fromUnitCode,
      toUnitCode: conversion.toUnitCode,
      factor: conversion.factor,
    })),
  };
}

export interface CatalogItemUpdateInput extends CatalogItemCreateInput {
  itemId: string;
  /** Required by the server's `revision()` check on updateCatalogItem. */
  expectedUpdatedAt: string;
}

/**
 * Builds the payload for CATALOG_ITEM_UPDATE. Same rules as create, plus
 * `itemId` and the optimistic-concurrency revision. `active` is owned by
 * the ARCHIVE / REACTIVATE mutation types and must never be sent here.
 */
export function buildCatalogItemUpdatePayload(input: CatalogItemUpdateInput): Record<string, unknown> {
  return {
    itemId: input.itemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    ...buildCatalogItemCreatePayload(input),
  };
}

// --- INVENTORY_ADJUSTMENT_CREATE -----------------------------------------

export type InventoryAdjustmentLocation = "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "WASTE";

export type InventoryAdjustmentReasonCode =
  | "COUNT_CORRECTION"
  | "QUARANTINE"
  | "DAMAGE"
  | "WASTE"
  | "OTHER";

export interface InventoryAdjustmentInput {
  itemId: string;
  /** Quantity moved in the item's stock unit — always positive. */
  quantity: number;
  reasonCode: InventoryAdjustmentReasonCode;
  /** Stock to move out of. Required unless only adding stock. */
  sourceLocation?: InventoryAdjustmentLocation | null;
  /** Stock to move into. Required unless only removing stock. */
  destinationLocation?: InventoryAdjustmentLocation | null;
  note?: string | null;
}

/**
 * Builds the payload for INVENTORY_ADJUSTMENT_CREATE using the canonical
 * server contract (see apps/api/src/commerce/inventory-adjustments.ts):
 * locations are AVAILABLE / QUARANTINE / DAMAGED / WASTE and the movement
 * quantity is always positive — the direction comes from source vs
 * destination. The server derives balances from the movement ledger.
 */
export function buildInventoryAdjustmentPayload(input: InventoryAdjustmentInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    itemId: input.itemId,
    quantity: input.quantity,
    reasonCode: input.reasonCode,
  };
  if (input.sourceLocation) payload.sourceLocation = input.sourceLocation;
  if (input.destinationLocation) payload.destinationLocation = input.destinationLocation;
  if (input.note) payload.note = input.note;
  return payload;
}

// --- CATALOG_ITEM_ARCHIVE / REACTIVATE -----------------------------------

export interface CatalogLifecycleInput {
  itemId: string;
  /** Required by the server's `revision()` check on updateCatalogItem. */
  expectedUpdatedAt: string;
}

/**
 * Builds the payload for CATALOG_ITEM_ARCHIVE / CATALOG_ITEM_REACTIVATE.
 *
 * The server sets `active` from the mutationType (see `applyCatalogMutation`
 * in `apps/api/src/sync.ts`). The client must NOT send `active`,
 * `actorStaffId` or `actorRole` — the sync layer strips and re-injects them.
 */
export function buildCatalogLifecyclePayload(
  mutationType: "CATALOG_ITEM_ARCHIVE" | "CATALOG_ITEM_REACTIVATE",
  input: CatalogLifecycleInput,
): Record<string, unknown> {
  return {
    itemId: input.itemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
}

// --- CUSTOMER_UPDATE -----------------------------------------------------

export interface CustomerUpdateInput {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Required by `revision()` in customer-service.ts. */
  expectedUpdatedAt: string;
}

/**
 * Builds the payload for CUSTOMER_UPDATE.
 *
 * Forbidden fields (rejected by `rejectSensitiveMasterData` in sync.ts):
 *   - creditLimitMinor, creditTermsDays, active
 * Those require an online server check and may only be sent via the REST
 * PATCH endpoint (with the CREDIT_CONTROL role). They must never appear in
 * an offline-queued CUSTOMER_UPDATE.
 */
export function buildCustomerUpdatePayload(input: CustomerUpdateInput): Record<string, unknown> {
  return {
    customerId: input.customerId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
}

// --- CUSTOMER_PAYMENT_CREATE ---------------------------------------------

export interface CustomerPaymentInput {
  customerId: string;
  amountMinor: number;
  method: PaymentMethod;
  /** Optional provider reference (e.g. MoMo transaction id). */
  providerReference?: string | null;
  /** Optional money account to credit. */
  moneyAccountId?: string | null;
}

/**
 * Builds the payload for CUSTOMER_PAYMENT_CREATE. `receivedByStaffId` is
 * server-enriched from the access token; the client never sends it.
 */
export function buildCustomerPaymentPayload(input: CustomerPaymentInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    customerId: input.customerId,
    amountMinor: input.amountMinor,
    method: input.method,
  };
  if (input.providerReference) payload.providerReference = input.providerReference;
  if (input.moneyAccountId) payload.moneyAccountId = input.moneyAccountId;
  return payload;
}

// --- SUPPLIER_UPDATE -----------------------------------------------------

export interface SupplierUpdateInput {
  supplierId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Optional address. The server allows address updates offline. */
  address?: string | null;
  /** Required by `revision()` in supplier-service.ts. */
  expectedUpdatedAt: string;
}

/**
 * Builds the payload for SUPPLIER_UPDATE.
 *
 * Forbidden fields (rejected by `rejectSensitiveMasterData` in sync.ts):
 *   - paymentTermsDays, active
 * Payment-term and status changes require an online server check.
 */
export function buildSupplierUpdatePayload(input: SupplierUpdateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    supplierId: input.supplierId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    expectedUpdatedAt: input.expectedUpdatedAt,
  };
  if (input.address !== undefined) payload.address = input.address;
  return payload;
}

// --- SUPPLIER_PAYMENT_CREATE ---------------------------------------------

export interface SupplierPaymentInput {
  supplierId: string;
  amountMinor: number;
  method: PaymentMethod;
  /** Optional money account to debit. */
  moneyAccountId?: string | null;
  /** Optional provider reference (e.g. bank transfer ref). */
  providerReference?: string | null;
}

/**
 * Builds the payload for SUPPLIER_PAYMENT_CREATE. `paidByStaffId` is
 * server-enriched from the access token.
 */
export function buildSupplierPaymentPayload(input: SupplierPaymentInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    supplierId: input.supplierId,
    amountMinor: input.amountMinor,
    method: input.method,
  };
  if (input.moneyAccountId) payload.moneyAccountId = input.moneyAccountId;
  if (input.providerReference) payload.providerReference = input.providerReference;
  return payload;
}

// --- MONEY_TRANSFER_CREATE -----------------------------------------------

export interface MoneyTransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinor: number;
  note?: string | null;
}

/**
 * Builds the payload for MONEY_TRANSFER_CREATE. `actorStaffId` /
 * `actorRole` are server-enriched.
 */
export function buildMoneyTransferPayload(input: MoneyTransferInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    amountMinor: input.amountMinor,
  };
  if (input.note) payload.note = input.note;
  return payload;
}

// --- MONEY_RECONCILIATION_CREATE -----------------------------------------

export interface MoneyReconciliationInput {
  moneyAccountId: string;
  type: ReconciliationType;
  periodStart: string;
  periodEnd: string;
  observedBalanceMinor: number;
  note?: string | null;
}

/**
 * Builds the payload for MONEY_RECONCILIATION_CREATE. The expected balance
 * is computed server-side from the cashbook ledger; the client only sends
 * the observed count.
 */
export function buildMoneyReconciliationPayload(input: MoneyReconciliationInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    moneyAccountId: input.moneyAccountId,
    type: input.type,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    observedBalanceMinor: input.observedBalanceMinor,
  };
  if (input.note) payload.note = input.note;
  return payload;
}

// --- MONEY_RECONCILIATION_RESOLVE ----------------------------------------

export interface MoneyReconciliationResolveInput {
  reconciliationId: string;
  /** Required — the server rejects an empty resolution note. */
  note: string;
}

/**
 * Builds the payload for MONEY_RECONCILIATION_RESOLVE. The adjustment amount
 * is the server-authoritative difference between observed and expected; the
 * client never sends it.
 */
export function buildMoneyReconciliationResolvePayload(
  input: MoneyReconciliationResolveInput,
): Record<string, unknown> {
  return {
    reconciliationId: input.reconciliationId,
    note: input.note,
  };
}

// --- PURCHASE_RETURN_CREATE ----------------------------------------------

export interface PurchaseReturnLineInput {
  purchaseLineId: string;
  quantity: number;
  sourceLocation: "AVAILABLE" | "QUARANTINE";
}

export interface PurchaseReturnInput {
  /** Server field name: `originalPurchaseId` (not `purchaseId`). */
  originalPurchaseId: string;
  supplierId: string;
  recoveryMethod: CatalogRecoveryMethod;
  lines: ReadonlyArray<PurchaseReturnLineInput>;
  /** Optional money account for cash-style recovery methods. */
  moneyAccountId?: string | null;
}

/**
 * Builds the payload for PURCHASE_RETURN_CREATE. `returnedByStaffId` is
 * server-enriched; supplierRecoveryMinor / inventoryValueRemovedMinor /
 * purchasePriceVarianceMinor are computed server-side from the purchase line
 * costs and the inventory valuation layer.
 */
export function buildPurchaseReturnPayload(input: PurchaseReturnInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    originalPurchaseId: input.originalPurchaseId,
    supplierId: input.supplierId,
    recoveryMethod: input.recoveryMethod,
    lines: input.lines.map((line) => ({
      purchaseLineId: line.purchaseLineId,
      quantity: line.quantity,
      sourceLocation: line.sourceLocation,
    })),
  };
  if (input.moneyAccountId) payload.moneyAccountId = input.moneyAccountId;
  return payload;
}

// --- CASHBOOK_ADJUSTMENT_CREATE ------------------------------------------

export interface CashbookAdjustmentInput {
  moneyAccountId?: string | null;
  /**
   * Signed delta in minor units. The server requires:
   *   - OPENING_BALANCE, OWNER_INJECTION: positive
   *   - OWNER_WITHDRAWAL: negative
   *   - CORRECTION: any non-zero
   */
  amountDeltaMinor: number;
  method: PaymentMethod;
  reason: CashbookAdjustmentReason;
  /** Required — the server rejects an empty note. */
  note: string;
}

/**
 * Builds the payload for CASHBOOK_ADJUSTMENT_CREATE. The signed delta is sent
 * as `amountDeltaMinor` (not `amountMinor`) — the server reads that field for
 * adjustments. `actorStaffId` is server-enriched.
 */
export function buildCashbookAdjustmentPayload(input: CashbookAdjustmentInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    amountDeltaMinor: input.amountDeltaMinor,
    method: input.method,
    reason: input.reason,
    note: input.note,
  };
  if (input.moneyAccountId) payload.moneyAccountId = input.moneyAccountId;
  return payload;
}

// --- SALE_CREATE (used as the contract reference for forbidden fields) ----

export interface SaleLineInput {
  itemId: string;
  saleUnitCode: string;
  quantity: number;
}

export interface SaleCreateInput {
  currencyCode: string;
  paymentMethod: PaymentMethod;
  lines: ReadonlyArray<SaleLineInput>;
  customerId?: string | null;
}

/**
 * Builds the payload for SALE_CREATE. Sale lines must contain ONLY
 * `itemId`, `saleUnitCode`, `quantity`. The server derives prices, taxes,
 * totals and balances from the catalog and the cashbook — never from the
 * client. This builder is the canonical reference; the existing POS
 * checkout-sheet uses the same shape inline.
 */
export function buildSaleCreatePayload(input: SaleCreateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    currencyCode: input.currencyCode,
    paymentMethod: input.paymentMethod,
    lines: input.lines.map((line) => ({
      itemId: line.itemId,
      saleUnitCode: line.saleUnitCode,
      quantity: line.quantity,
    })),
  };
  if (input.customerId) payload.customerId = input.customerId;
  return payload;
}

// --- Mutation construction (build + role gate) ---------------------------

export interface BuildMutationContext {
  businessId: string;
  branchId?: string;
  clientId: string;
  now(): string;
  createMutationId(): string;
}

/**
 * Builds a complete QueuedMutation for a given (mutationType, payload).
 *
 * Pure — does not touch localStorage, fetch, or `getOfflineQueue()`. This
 * is the same construction the WebOfflineQueue facade performs, but exposed
 * as a pure function so tests can verify the shape without instantiating
 * the singleton.
 */
export function buildQueuedMutation(
  ctx: BuildMutationContext,
  mutationType: string,
  payload: Record<string, unknown>,
): QueuedMutation {
  const mutation: QueuedMutation = {
    clientId: ctx.clientId,
    clientMutationId: ctx.createMutationId(),
    businessId: ctx.businessId,
    mutationType,
    occurredAt: ctx.now(),
    payload,
  };
  if (ctx.branchId) mutation.branchId = ctx.branchId;
  return mutation;
}

/**
 * The fields a payload must NEVER include — they are either
 * server-authoritative (computed), server-enriched (from the access token),
 * or server-rejected (sensitive). Tests assert none of these appear in any
 * of the 11 builders' outputs.
 */
export const FORBIDDEN_PAYLOAD_FIELDS: ReadonlySet<string> = new Set([
  "actorStaffId",
  "actorRole",
  "receivedByStaffId",
  "paidByStaffId",
  "cashierStaffId",
  "initiatedByStaffId",
  "approvedByStaffId",
  "returnedByStaffId",
  // server-authoritative economic fields
  "totalMinor",
  "balanceMinor",
  "supplierRecoveryMinor",
  "inventoryValueRemovedMinor",
  "purchasePriceVarianceMinor",
  "expectedBalanceMinor",
  "differenceMinor",
  // sensitive master-data fields (rejected by sync layer)
  "creditLimitMinor",
  "creditTermsDays",
  "paymentTermsDays",
  // active is server-derived from mutationType for ARCHIVE/REACTIVATE
  "active",
]);
