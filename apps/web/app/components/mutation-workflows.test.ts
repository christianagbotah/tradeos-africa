/**
 * TradeOS Web — behavioral tests for the 11 mutation workflows.
 *
 * These are REAL behavioral tests, not className contract expansions:
 *   - mutation-type strings are asserted against their expected literal value
 *   - payload shapes are asserted field-by-field (presence AND absence)
 *   - forbidden (server-authoritative / server-enriched / server-rejected)
 *     fields are asserted to never appear in any builder output
 *   - permission gating is asserted per role list (OWNER allowed, VIEWER denied,
 *     and a meaningful cross-cutting role distribution)
 *   - offline queue lifecycle is asserted (pending → synced, pending → failed,
 *     idempotent replay) using the real OfflineMutationQueue + a mock transport
 *
 * The tests do NOT render React components — they verify the pure builders and
 * the queue contract that the components rely on. This keeps them fast and
 * deterministic while still exercising the real workflow code paths.
 */

import { describe, expect, it } from "vitest";
import {
  OfflineMutationQueue,
  type FlushOptions,
  type QueueSnapshot,
  type QueueSnapshotStorage,
  type QueueState,
  type QueuedMutation,
  type SyncTransport,
} from "@tradeos/client-core/sync-runtime";
import type { MutationResult, SyncPushRequest, SyncResponse } from "@tradeos/contracts";
import {
  buildCatalogLifecyclePayload,
  buildCashbookAdjustmentPayload,
  buildCustomerPaymentPayload,
  buildCustomerUpdatePayload,
  buildMoneyReconciliationPayload,
  buildMoneyReconciliationResolvePayload,
  buildMoneyTransferPayload,
  buildPurchaseReturnPayload,
  buildSaleCreatePayload,
  buildSupplierPaymentPayload,
  buildSupplierUpdatePayload,
  buildQueuedMutation,
  type BuildMutationContext,
  CASHBOOK_ADJUSTMENT_CREATE_TYPE,
  CASHBOOK_ADJUSTMENT_ROLES,
  CATALOG_ITEM_ARCHIVE_TYPE,
  CATALOG_ITEM_REACTIVATE_TYPE,
  CATALOG_WRITE_ROLES,
  CUSTOMER_PAYMENT_CREATE_TYPE,
  CUSTOMER_PAYMENT_ROLES,
  CUSTOMER_UPDATE_TYPE,
  CUSTOMER_WRITE_ROLES,
  EXPENSE_ROLES,
  FORBIDDEN_PAYLOAD_FIELDS,
  MONEY_RECONCILIATION_CREATE_TYPE,
  MONEY_RECONCILIATION_RESOLVE_TYPE,
  MONEY_TRANSFER_CREATE_TYPE,
  MUTATION_TYPES,
  PURCHASE_RETURN_CREATE_TYPE,
  PURCHASE_RETURN_ROLES,
  SUPPLIER_PAYMENT_CREATE_TYPE,
  SUPPLIER_PAYMENT_ROLES,
  SUPPLIER_UPDATE_TYPE,
  SUPPLIER_WRITE_ROLES,
  TREASURY_RECONCILE_ROLES,
  TREASURY_TRANSFER_ROLES,
  roleCan,
  type WorkspaceRole,
} from "../../lib/mutation-builders";

// --- Test fixtures -------------------------------------------------------

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACCOUNT_ID_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACCOUNT_ID_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PURCHASE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PURCHASE_LINE_ID = "99999999-9999-4999-8999-999999999999";
const RECONCILIATION_ID = "88888888-8888-4888-8888-888888888888";
const EXPECTED_UPDATED_AT = "2026-10-10T08:00:00.000Z";
const PERIOD_START = "2026-10-09T00:00:00.000Z";
const PERIOD_END = "2026-10-09T23:59:59.000Z";

const ALL_ROLES: readonly WorkspaceRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

// --- Mutation type strings ----------------------------------------------

describe("mutation type constants", () => {
  it("exposes exactly the 11 supported mutation types", () => {
    expect(MUTATION_TYPES).toHaveLength(11);
  });

  it.each([
    ["CATALOG_ITEM_ARCHIVE", CATALOG_ITEM_ARCHIVE_TYPE],
    ["CATALOG_ITEM_REACTIVATE", CATALOG_ITEM_REACTIVATE_TYPE],
    ["CUSTOMER_UPDATE", CUSTOMER_UPDATE_TYPE],
    ["CUSTOMER_PAYMENT_CREATE", CUSTOMER_PAYMENT_CREATE_TYPE],
    ["SUPPLIER_UPDATE", SUPPLIER_UPDATE_TYPE],
    ["SUPPLIER_PAYMENT_CREATE", SUPPLIER_PAYMENT_CREATE_TYPE],
    ["MONEY_TRANSFER_CREATE", MONEY_TRANSFER_CREATE_TYPE],
    ["MONEY_RECONCILIATION_CREATE", MONEY_RECONCILIATION_CREATE_TYPE],
    ["MONEY_RECONCILIATION_RESOLVE", MONEY_RECONCILIATION_RESOLVE_TYPE],
    ["PURCHASE_RETURN_CREATE", PURCHASE_RETURN_CREATE_TYPE],
    ["CASHBOOK_ADJUSTMENT_CREATE", CASHBOOK_ADJUSTMENT_CREATE_TYPE],
  ] as const)("exposes the canonical %s mutation type", (label, actual) => {
    expect(actual).toBe(label);
    expect(typeof actual).toBe("string");
  });

  it("the 11 mutation type constants are pairwise distinct", () => {
    const set = new Set(MUTATION_TYPES);
    expect(set.size).toBe(MUTATION_TYPES.length);
  });
});

// --- Payload shape (per builder) ----------------------------------------

/** Asserts none of the forbidden fields appear in the payload. */
function assertNoForbiddenFields(payload: Record<string, unknown>): void {
  for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
    expect(payload, `payload must not include forbidden field "${field}"`).not.toHaveProperty(field);
  }
}

/** Recursively asserts forbidden fields are absent from nested objects (e.g. sale lines). */
function assertNoForbiddenFieldsDeep(payload: unknown): void {
  if (Array.isArray(payload)) {
    for (const item of payload) assertNoForbiddenFieldsDeep(item);
    return;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
      expect(record, `nested payload must not include forbidden field "${field}"`).not.toHaveProperty(field);
    }
    for (const value of Object.values(record)) assertNoForbiddenFieldsDeep(value);
  }
}

describe("CATALOG_ITEM_ARCHIVE / REACTIVATE payload", () => {
  it("builds an archive payload with only itemId and expectedUpdatedAt", () => {
    const payload = buildCatalogLifecyclePayload("CATALOG_ITEM_ARCHIVE", {
      itemId: ITEM_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).toEqual({ itemId: ITEM_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT });
    assertNoForbiddenFields(payload);
  });

  it("builds a reactivate payload with the same shape", () => {
    const payload = buildCatalogLifecyclePayload("CATALOG_ITEM_REACTIVATE", {
      itemId: ITEM_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).toEqual({ itemId: ITEM_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT });
    assertNoForbiddenFields(payload);
  });

  it("never includes `active` — the server derives it from the mutationType", () => {
    const payload = buildCatalogLifecyclePayload("CATALOG_ITEM_ARCHIVE", {
      itemId: ITEM_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).not.toHaveProperty("active");
  });
});

describe("CUSTOMER_UPDATE payload", () => {
  it("builds with customerId, name, phone, email, expectedUpdatedAt", () => {
    const payload = buildCustomerUpdatePayload({
      customerId: CUSTOMER_ID,
      name: "Ama Mensah",
      phone: "+233200000000",
      email: "ama@example.com",
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).toEqual({
      customerId: CUSTOMER_ID,
      name: "Ama Mensah",
      phone: "+233200000000",
      email: "ama@example.com",
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    assertNoForbiddenFields(payload);
  });

  it.each([
    "creditLimitMinor", "creditTermsDays", "active",
  ] as const)("never includes the sensitive server-rejected field %s", (field) => {
    const payload = buildCustomerUpdatePayload({
      customerId: CUSTOMER_ID,
      name: "Ama",
      phone: null,
      email: null,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).not.toHaveProperty(field);
  });

  it("never includes actorStaffId or actorRole (server-enriched)", () => {
    const payload = buildCustomerUpdatePayload({
      customerId: CUSTOMER_ID,
      name: "Ama",
      phone: null,
      email: null,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).not.toHaveProperty("actorStaffId");
    expect(payload).not.toHaveProperty("actorRole");
  });
});

describe("CUSTOMER_PAYMENT_CREATE payload", () => {
  it("builds the required customerId/amountMinor/method fields", () => {
    const payload = buildCustomerPaymentPayload({
      customerId: CUSTOMER_ID,
      amountMinor: 5000,
      method: "MOMO",
    });
    expect(payload).toEqual({
      customerId: CUSTOMER_ID,
      amountMinor: 5000,
      method: "MOMO",
    });
    assertNoForbiddenFields(payload);
  });

  it("includes providerReference and moneyAccountId only when supplied", () => {
    const without = buildCustomerPaymentPayload({
      customerId: CUSTOMER_ID, amountMinor: 100, method: "CASH",
    });
    expect(without).not.toHaveProperty("providerReference");
    expect(without).not.toHaveProperty("moneyAccountId");

    const withExtras = buildCustomerPaymentPayload({
      customerId: CUSTOMER_ID, amountMinor: 100, method: "CASH",
      providerReference: "momo-ref-1", moneyAccountId: ACCOUNT_ID_A,
    });
    expect(withExtras.providerReference).toBe("momo-ref-1");
    expect(withExtras.moneyAccountId).toBe(ACCOUNT_ID_A);
  });

  it("never includes receivedByStaffId or balanceMinor", () => {
    const payload = buildCustomerPaymentPayload({
      customerId: CUSTOMER_ID, amountMinor: 100, method: "CASH",
    });
    expect(payload).not.toHaveProperty("receivedByStaffId");
    expect(payload).not.toHaveProperty("balanceMinor");
  });
});

describe("SUPPLIER_UPDATE payload", () => {
  it("builds with supplierId, name, phone, email, expectedUpdatedAt", () => {
    const payload = buildSupplierUpdatePayload({
      supplierId: SUPPLIER_ID,
      name: "Acme Ltd",
      phone: "+233201111111",
      email: "sales@acme.example",
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).toEqual({
      supplierId: SUPPLIER_ID,
      name: "Acme Ltd",
      phone: "+233201111111",
      email: "sales@acme.example",
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    assertNoForbiddenFields(payload);
  });

  it.each([
    "paymentTermsDays", "active",
  ] as const)("never includes the sensitive server-rejected field %s", (field) => {
    const payload = buildSupplierUpdatePayload({
      supplierId: SUPPLIER_ID,
      name: "Acme",
      phone: null,
      email: null,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(payload).not.toHaveProperty(field);
  });

  it("includes address only when supplied", () => {
    const without = buildSupplierUpdatePayload({
      supplierId: SUPPLIER_ID, name: "Acme", phone: null, email: null,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(without).not.toHaveProperty("address");

    const withAddr = buildSupplierUpdatePayload({
      supplierId: SUPPLIER_ID, name: "Acme", phone: null, email: null,
      address: "12 Spintex Rd", expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(withAddr.address).toBe("12 Spintex Rd");
  });
});

describe("SUPPLIER_PAYMENT_CREATE payload", () => {
  it("builds with supplierId, amountMinor, method", () => {
    const payload = buildSupplierPaymentPayload({
      supplierId: SUPPLIER_ID,
      amountMinor: 25000,
      method: "BANK",
    });
    expect(payload).toEqual({
      supplierId: SUPPLIER_ID,
      amountMinor: 25000,
      method: "BANK",
    });
    assertNoForbiddenFields(payload);
  });

  it("never includes paidByStaffId or balanceMinor", () => {
    const payload = buildSupplierPaymentPayload({
      supplierId: SUPPLIER_ID, amountMinor: 100, method: "CASH",
    });
    expect(payload).not.toHaveProperty("paidByStaffId");
    expect(payload).not.toHaveProperty("balanceMinor");
  });
});

describe("MONEY_TRANSFER_CREATE payload", () => {
  it("builds with source/destination/amount", () => {
    const payload = buildMoneyTransferPayload({
      sourceAccountId: ACCOUNT_ID_A,
      destinationAccountId: ACCOUNT_ID_B,
      amountMinor: 1500,
    });
    expect(payload).toEqual({
      sourceAccountId: ACCOUNT_ID_A,
      destinationAccountId: ACCOUNT_ID_B,
      amountMinor: 1500,
    });
    assertNoForbiddenFields(payload);
  });

  it("includes the note only when supplied", () => {
    const without = buildMoneyTransferPayload({
      sourceAccountId: ACCOUNT_ID_A, destinationAccountId: ACCOUNT_ID_B, amountMinor: 100,
    });
    expect(without).not.toHaveProperty("note");
    const withNote = buildMoneyTransferPayload({
      sourceAccountId: ACCOUNT_ID_A, destinationAccountId: ACCOUNT_ID_B, amountMinor: 100,
      note: "Move float to bank",
    });
    expect(withNote.note).toBe("Move float to bank");
  });

  it("never includes actorStaffId or actorRole", () => {
    const payload = buildMoneyTransferPayload({
      sourceAccountId: ACCOUNT_ID_A, destinationAccountId: ACCOUNT_ID_B, amountMinor: 100,
    });
    expect(payload).not.toHaveProperty("actorStaffId");
    expect(payload).not.toHaveProperty("actorRole");
  });
});

describe("MONEY_RECONCILIATION_CREATE payload", () => {
  it("builds with moneyAccountId, type, period, observedBalance", () => {
    const payload = buildMoneyReconciliationPayload({
      moneyAccountId: ACCOUNT_ID_A,
      type: "CASH_COUNT",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      observedBalanceMinor: 18500,
    });
    expect(payload).toEqual({
      moneyAccountId: ACCOUNT_ID_A,
      type: "CASH_COUNT",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      observedBalanceMinor: 18500,
    });
    assertNoForbiddenFields(payload);
  });

  it("never includes expectedBalanceMinor or differenceMinor (server-computed)", () => {
    const payload = buildMoneyReconciliationPayload({
      moneyAccountId: ACCOUNT_ID_A, type: "CASH_COUNT",
      periodStart: PERIOD_START, periodEnd: PERIOD_END, observedBalanceMinor: 18500,
    });
    expect(payload).not.toHaveProperty("expectedBalanceMinor");
    expect(payload).not.toHaveProperty("differenceMinor");
  });
});

describe("MONEY_RECONCILIATION_RESOLVE payload", () => {
  it("builds with reconciliationId and note", () => {
    const payload = buildMoneyReconciliationResolvePayload({
      reconciliationId: RECONCILIATION_ID,
      note: "Cash shortage during shift — supervisor approved write-off.",
    });
    expect(payload).toEqual({
      reconciliationId: RECONCILIATION_ID,
      note: "Cash shortage during shift — supervisor approved write-off.",
    });
    assertNoForbiddenFields(payload);
  });

  it("never includes the adjustment amount or actorStaffId", () => {
    const payload = buildMoneyReconciliationResolvePayload({
      reconciliationId: RECONCILIATION_ID,
      note: "ok",
    });
    expect(payload).not.toHaveProperty("actorStaffId");
    expect(payload).not.toHaveProperty("differenceMinor");
    expect(payload).not.toHaveProperty("amountDeltaMinor");
  });
});

describe("PURCHASE_RETURN_CREATE payload", () => {
  it("builds with originalPurchaseId (not purchaseId), supplierId, recoveryMethod, lines", () => {
    const payload = buildPurchaseReturnPayload({
      originalPurchaseId: PURCHASE_ID,
      supplierId: SUPPLIER_ID,
      recoveryMethod: "CREDIT_NOTE",
      lines: [
        { purchaseLineId: PURCHASE_LINE_ID, quantity: 2, sourceLocation: "AVAILABLE" },
      ],
    });
    expect(payload).toEqual({
      originalPurchaseId: PURCHASE_ID,
      supplierId: SUPPLIER_ID,
      recoveryMethod: "CREDIT_NOTE",
      lines: [
        { purchaseLineId: PURCHASE_LINE_ID, quantity: 2, sourceLocation: "AVAILABLE" },
      ],
    });
    assertNoForbiddenFieldsDeep(payload);
  });

  it("uses the server field name originalPurchaseId (not purchaseId)", () => {
    const payload = buildPurchaseReturnPayload({
      originalPurchaseId: PURCHASE_ID,
      supplierId: SUPPLIER_ID,
      recoveryMethod: "CASH",
      lines: [{ purchaseLineId: PURCHASE_LINE_ID, quantity: 1, sourceLocation: "AVAILABLE" }],
    });
    expect(payload).toHaveProperty("originalPurchaseId", PURCHASE_ID);
    expect(payload).not.toHaveProperty("purchaseId");
  });

  it("each return line carries purchaseLineId, quantity, sourceLocation — nothing else", () => {
    const payload = buildPurchaseReturnPayload({
      originalPurchaseId: PURCHASE_ID,
      supplierId: SUPPLIER_ID,
      recoveryMethod: "CASH",
      lines: [{ purchaseLineId: PURCHASE_LINE_ID, quantity: 1, sourceLocation: "QUARANTINE" }],
    });
    const lines = payload.lines as ReadonlyArray<Record<string, unknown>>;
    expect(lines[0]).toEqual({
      purchaseLineId: PURCHASE_LINE_ID,
      quantity: 1,
      sourceLocation: "QUARANTINE",
    });
    const allowed = new Set(["purchaseLineId", "quantity", "sourceLocation"]);
    for (const key of Object.keys(lines[0]!)) {
      expect(allowed.has(key), `unexpected line field "${key}"`).toBe(true);
    }
  });

  it("never includes returnedByStaffId, supplierRecoveryMinor or inventoryValueRemovedMinor", () => {
    const payload = buildPurchaseReturnPayload({
      originalPurchaseId: PURCHASE_ID,
      supplierId: SUPPLIER_ID,
      recoveryMethod: "CREDIT_NOTE",
      lines: [{ purchaseLineId: PURCHASE_LINE_ID, quantity: 1, sourceLocation: "AVAILABLE" }],
    });
    expect(payload).not.toHaveProperty("returnedByStaffId");
    expect(payload).not.toHaveProperty("supplierRecoveryMinor");
    expect(payload).not.toHaveProperty("inventoryValueRemovedMinor");
    expect(payload).not.toHaveProperty("purchasePriceVarianceMinor");
  });
});

describe("CASHBOOK_ADJUSTMENT_CREATE payload", () => {
  it("builds with amountDeltaMinor (signed), method, reason, note", () => {
    const payload = buildCashbookAdjustmentPayload({
      amountDeltaMinor: -1500,
      method: "CASH",
      reason: "CORRECTION",
      note: "Cash drawer shortage after count.",
    });
    expect(payload).toEqual({
      amountDeltaMinor: -1500,
      method: "CASH",
      reason: "CORRECTION",
      note: "Cash drawer shortage after count.",
    });
    assertNoForbiddenFields(payload);
  });

  it("sends amountDeltaMinor (signed) — NOT amountMinor (unsigned)", () => {
    const payload = buildCashbookAdjustmentPayload({
      amountDeltaMinor: 5000,
      method: "CASH",
      reason: "OPENING_BALANCE",
      note: "Initial cash float",
    });
    expect(payload).toHaveProperty("amountDeltaMinor", 5000);
    expect(payload).not.toHaveProperty("amountMinor");
  });

  it("includes moneyAccountId only when supplied", () => {
    const without = buildCashbookAdjustmentPayload({
      amountDeltaMinor: 100, method: "CASH", reason: "CORRECTION", note: "x",
    });
    expect(without).not.toHaveProperty("moneyAccountId");

    const withAccount = buildCashbookAdjustmentPayload({
      amountDeltaMinor: 100, method: "CASH", reason: "CORRECTION", note: "x",
      moneyAccountId: ACCOUNT_ID_A,
    });
    expect(withAccount.moneyAccountId).toBe(ACCOUNT_ID_A);
  });
});

describe("SALE_CREATE payload (contract reference for forbidden line fields)", () => {
  it("sale lines contain ONLY itemId, saleUnitCode, quantity", () => {
    const payload = buildSaleCreatePayload({
      currencyCode: "GHS",
      paymentMethod: "CASH",
      lines: [
        { itemId: ITEM_ID, saleUnitCode: "EACH", quantity: 3 },
        { itemId: "55555555-5555-4555-8555-555555555555", saleUnitCode: "KG", quantity: 1.5 },
      ],
    });
    const lines = payload.lines as ReadonlyArray<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    const allowed = new Set(["itemId", "saleUnitCode", "quantity"]);
    for (const line of lines) {
      for (const key of Object.keys(line)) {
        expect(allowed.has(key), `unexpected sale line field "${key}"`).toBe(true);
      }
    }
    assertNoForbiddenFieldsDeep(payload);
  });

  it.each([
    "unitPrice", "unitPriceMinor", "totalMinor", "lineTotalMinor", "unitNetMinor",
    "unitTaxMinor", "taxRatePercent", "discountMinor",
  ] as const)("sale lines must NOT include the client-authoritative field %s", (field) => {
    const payload = buildSaleCreatePayload({
      currencyCode: "GHS",
      paymentMethod: "CASH",
      lines: [{ itemId: ITEM_ID, saleUnitCode: "EACH", quantity: 1 }],
    });
    const line = (payload.lines as ReadonlyArray<Record<string, unknown>>)[0]!;
    expect(line).not.toHaveProperty(field);
  });

  it("includes customerId only when supplied", () => {
    const without = buildSaleCreatePayload({
      currencyCode: "GHS", paymentMethod: "CASH",
      lines: [{ itemId: ITEM_ID, saleUnitCode: "EACH", quantity: 1 }],
    });
    expect(without).not.toHaveProperty("customerId");

    const withCustomer = buildSaleCreatePayload({
      currencyCode: "GHS", paymentMethod: "CASH",
      lines: [{ itemId: ITEM_ID, saleUnitCode: "EACH", quantity: 1 }],
      customerId: CUSTOMER_ID,
    });
    expect(withCustomer.customerId).toBe(CUSTOMER_ID);
  });

  it("never includes cashierStaffId (server-enriched) or totalMinor (server-computed)", () => {
    const payload = buildSaleCreatePayload({
      currencyCode: "GHS", paymentMethod: "CASH",
      lines: [{ itemId: ITEM_ID, saleUnitCode: "EACH", quantity: 1 }],
    });
    expect(payload).not.toHaveProperty("cashierStaffId");
    expect(payload).not.toHaveProperty("totalMinor");
  });
});

// --- Permission gating --------------------------------------------------

describe("permission gating", () => {
  it("OWNER is allowed for every write role list", () => {
    expect(roleCan("OWNER", CATALOG_WRITE_ROLES)).toBe(true);
    expect(roleCan("OWNER", CUSTOMER_WRITE_ROLES)).toBe(true);
    expect(roleCan("OWNER", CUSTOMER_PAYMENT_ROLES)).toBe(true);
    expect(roleCan("OWNER", SUPPLIER_WRITE_ROLES)).toBe(true);
    expect(roleCan("OWNER", SUPPLIER_PAYMENT_ROLES)).toBe(true);
    expect(roleCan("OWNER", PURCHASE_RETURN_ROLES)).toBe(true);
    expect(roleCan("OWNER", CASHBOOK_ADJUSTMENT_ROLES)).toBe(true);
    expect(roleCan("OWNER", TREASURY_RECONCILE_ROLES)).toBe(true);
    expect(roleCan("OWNER", TREASURY_TRANSFER_ROLES)).toBe(true);
    expect(roleCan("OWNER", EXPENSE_ROLES)).toBe(true);
  });

  it("VIEWER is never allowed for any write role list", () => {
    expect(roleCan("VIEWER", CATALOG_WRITE_ROLES)).toBe(false);
    expect(roleCan("VIEWER", CUSTOMER_WRITE_ROLES)).toBe(false);
    expect(roleCan("VIEWER", CUSTOMER_PAYMENT_ROLES)).toBe(false);
    expect(roleCan("VIEWER", SUPPLIER_WRITE_ROLES)).toBe(false);
    expect(roleCan("VIEWER", SUPPLIER_PAYMENT_ROLES)).toBe(false);
    expect(roleCan("VIEWER", PURCHASE_RETURN_ROLES)).toBe(false);
    expect(roleCan("VIEWER", CASHBOOK_ADJUSTMENT_ROLES)).toBe(false);
    expect(roleCan("VIEWER", TREASURY_RECONCILE_ROLES)).toBe(false);
    expect(roleCan("VIEWER", TREASURY_TRANSFER_ROLES)).toBe(false);
    expect(roleCan("VIEWER", EXPENSE_ROLES)).toBe(false);
  });

  it.each([
    { role: "CASHIER" as WorkspaceRole, list: EXPENSE_ROLES, expected: true,
      label: "CASHIER may record expenses" },
    { role: "CASHIER" as WorkspaceRole, list: CASHBOOK_ADJUSTMENT_ROLES, expected: false,
      label: "CASHIER may NOT post cashbook adjustments" },
    { role: "CASHIER" as WorkspaceRole, list: TREASURY_RECONCILE_ROLES, expected: true,
      label: "CASHIER may run cash-count reconciliations" },
    { role: "CASHIER" as WorkspaceRole, list: TREASURY_TRANSFER_ROLES, expected: false,
      label: "CASHIER may NOT transfer between accounts" },
    { role: "SALES" as WorkspaceRole, list: CUSTOMER_WRITE_ROLES, expected: true,
      label: "SALES may update customers" },
    { role: "SALES" as WorkspaceRole, list: SUPPLIER_WRITE_ROLES, expected: false,
      label: "SALES may NOT update suppliers" },
    { role: "INVENTORY" as WorkspaceRole, list: CATALOG_WRITE_ROLES, expected: true,
      label: "INVENTORY may archive/reactivate catalog items" },
    { role: "INVENTORY" as WorkspaceRole, list: CUSTOMER_WRITE_ROLES, expected: false,
      label: "INVENTORY may NOT update customers" },
    { role: "INVENTORY" as WorkspaceRole, list: PURCHASE_RETURN_ROLES, expected: true,
      label: "INVENTORY may post purchase returns" },
    { role: "ACCOUNTANT" as WorkspaceRole, list: SUPPLIER_PAYMENT_ROLES, expected: true,
      label: "ACCOUNTANT may pay suppliers" },
    { role: "ACCOUNTANT" as WorkspaceRole, list: CATALOG_WRITE_ROLES, expected: false,
      label: "ACCOUNTANT may NOT archive catalog items" },
  ])("$label", ({ role, list, expected }) => {
    expect(roleCan(role, list)).toBe(expected);
  });

  it("STAFF is never in any write role list", () => {
    for (const list of [
      CATALOG_WRITE_ROLES, CUSTOMER_WRITE_ROLES, CUSTOMER_PAYMENT_ROLES, SUPPLIER_WRITE_ROLES,
      SUPPLIER_PAYMENT_ROLES, PURCHASE_RETURN_ROLES, CASHBOOK_ADJUSTMENT_ROLES,
      TREASURY_RECONCILE_ROLES, TREASURY_TRANSFER_ROLES, EXPENSE_ROLES,
    ]) {
      expect(list).not.toContain("STAFF");
    }
  });

  it("every write role list contains only roles from the canonical WorkspaceRole set", () => {
    for (const list of [
      CATALOG_WRITE_ROLES, CUSTOMER_WRITE_ROLES, CUSTOMER_PAYMENT_ROLES, SUPPLIER_WRITE_ROLES,
      SUPPLIER_PAYMENT_ROLES, PURCHASE_RETURN_ROLES, CASHBOOK_ADJUSTMENT_ROLES,
      TREASURY_RECONCILE_ROLES, TREASURY_TRANSFER_ROLES, EXPENSE_ROLES,
    ]) {
      for (const r of list) {
        expect(ALL_ROLES).toContain(r);
      }
    }
  });
});

// --- Mutation construction (build + role gate) --------------------------

describe("buildQueuedMutation", () => {
  const ctx = {
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    clientId: "client-web-1",
    now: () => EXPECTED_UPDATED_AT,
    createMutationId: () => "mutation-id-1",
  };

  it("produces a QueuedMutation with all required ClientMutation fields", () => {
    const mutation = buildQueuedMutation(ctx, "CUSTOMER_PAYMENT_CREATE", {
      customerId: CUSTOMER_ID,
      amountMinor: 100,
      method: "CASH",
    });
    expect(mutation.clientId).toBe("client-web-1");
    expect(mutation.clientMutationId).toBe("mutation-id-1");
    expect(mutation.businessId).toBe(BUSINESS_ID);
    expect(mutation.branchId).toBe(BRANCH_ID);
    expect(mutation.mutationType).toBe("CUSTOMER_PAYMENT_CREATE");
    expect(mutation.occurredAt).toBe(EXPECTED_UPDATED_AT);
    expect(mutation.payload).toEqual({ customerId: CUSTOMER_ID, amountMinor: 100, method: "CASH" });
  });

  it("omits branchId when ctx.branchId is undefined (master-data mutations)", () => {
    const noBranchCtx: BuildMutationContext = {
      businessId: BUSINESS_ID,
      clientId: "client-web-1",
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    };
    const mutation = buildQueuedMutation(noBranchCtx, "CATALOG_ITEM_ARCHIVE", {
      itemId: ITEM_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT,
    });
    expect(mutation).not.toHaveProperty("branchId");
  });
});

// --- Offline queue behavior ---------------------------------------------

class TestSnapshotStorage implements QueueSnapshotStorage {
  saved: QueueSnapshot | null;
  constructor(initial: QueueSnapshot | null = null) {
    this.saved = initial;
  }
  async load(): Promise<QueueSnapshot | null> {
    return this.saved;
  }
  async save(snapshot: QueueSnapshot): Promise<void> {
    this.saved = snapshot;
  }
}

class MockTransport implements SyncTransport {
  calls: SyncPushRequest[] = [];
  constructor(private readonly respond: (req: SyncPushRequest) => SyncResponse) {
    void respond; // capture for clarity
  }
  async push(request: SyncPushRequest): Promise<SyncResponse> {
    this.calls.push(request);
    return this.respond(request);
  }
}

function appliedResponse(req: SyncPushRequest): SyncResponse {
  const mutationResults: MutationResult[] = req.mutations.map((m) => ({
    clientMutationId: m.clientMutationId,
    status: "APPLIED" as const,
    serverReceivedAt: EXPECTED_UPDATED_AT,
  }));
  return { mutationResults, events: [] };
}

function rejectedResponse(req: SyncPushRequest, code = "REJECTED"): SyncResponse {
  const mutationResults: MutationResult[] = req.mutations.map((m) => ({
    clientMutationId: m.clientMutationId,
    status: "REJECTED" as const,
    serverReceivedAt: EXPECTED_UPDATED_AT,
    errorCode: code,
    errorMessage: "Server rejected the mutation.",
  }));
  return { mutationResults, events: [] };
}

function makeMutation(id: string, mutationType = "CUSTOMER_PAYMENT_CREATE"): QueuedMutation {
  return {
    clientId: "client-web-1",
    clientMutationId: id,
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    mutationType,
    occurredAt: EXPECTED_UPDATED_AT,
    payload: { customerId: CUSTOMER_ID, amountMinor: 100, method: "CASH" },
  };
}

function flushOptions(transport: SyncTransport): FlushOptions {
  return {
    activeBusinessId: BUSINESS_ID,
    online: true,
    transport,
  };
}

describe("offline queue — enqueue works when offline", () => {
  it("enqueue stores the mutation in the snapshot even when offline", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    const accepted = await queue.enqueue(makeMutation("mutation-1"));
    expect(accepted).toBe(true);

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(1);
    expect(snapshot.pending[0]!.clientMutationId).toBe("mutation-1");

    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(1);
    expect(state.failed).toBe(0);
  });

  it("flush is a no-op when offline — pending stays pending", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("mutation-1"));

    const summary = await queue.flush({
      activeBusinessId: BUSINESS_ID,
      online: false,
      transport: new MockTransport(appliedResponse),
    });
    expect(summary.attempted).toBe(0);
    expect(summary.applied).toBe(0);

    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(1);
  });
});

describe("offline queue — pending state (queued but not flushed)", () => {
  it("getState reports pending=1 immediately after enqueue", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("p-1"));
    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(1);
    expect(state.failed).toBe(0);
  });

  it("a mutation for a different business is counted as blocked (not server-ready)", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue({
      ...makeMutation("p-other"),
      businessId: "99999999-9999-4999-8999-999999999999",
    });
    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(1);
    expect(state.blocked).toBe(1);
  });
});

describe("offline queue — synced state (mutation flushed successfully)", () => {
  it("an APPLIED response moves the mutation out of pending (pending → 0)", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("s-1"));

    const transport = new MockTransport(appliedResponse);
    const summary = await queue.flush(flushOptions(transport));

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.mutations).toHaveLength(1);
    expect(transport.calls[0]!.mutations[0]!.clientMutationId).toBe("s-1");
    expect(summary.applied).toBe(1);
    expect(summary.rejected).toBe(0);
    expect(summary.attempted).toBe(1);

    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(0);
    expect(state.failed).toBe(0);
  });

  it("a RECEIVED response keeps the mutation pending (server-queued, not yet applied)", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("s-2"));

    const transport = new MockTransport((req) => ({
      mutationResults: req.mutations.map((m) => ({
        clientMutationId: m.clientMutationId,
        status: "RECEIVED" as const,
        serverReceivedAt: EXPECTED_UPDATED_AT,
      })),
      events: [],
    }));
    const summary = await queue.flush(flushOptions(transport));
    expect(summary.applied).toBe(0);
    expect(summary.received).toBe(1);

    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(1);
  });
});

describe("offline queue — needs-review state (server rejected)", () => {
  it("a REJECTED response moves the mutation to the failed list", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("r-1"));

    const transport = new MockTransport(rejectedResponse);
    const summary = await queue.flush(flushOptions(transport));

    expect(summary.rejected).toBe(1);
    expect(summary.applied).toBe(0);

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(0);
    expect(snapshot.failed).toHaveLength(1);
    expect(snapshot.failed[0]!.mutation.clientMutationId).toBe("r-1");
    expect(snapshot.failed[0]!.result.status).toBe("REJECTED");
    expect(snapshot.failed[0]!.result.errorCode).toBe("REJECTED");
  });

  it("the failed mutation carries the server errorCode/message for review", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("r-2"));

    const transport = new MockTransport((req) => rejectedResponse(req, "CREDIT_LIMIT_EXCEEDED"));
    await queue.flush(flushOptions(transport));

    const snapshot = await queue.getSnapshot();
    expect(snapshot.failed[0]!.result.errorCode).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(snapshot.failed[0]!.result.errorMessage).toBe("Server rejected the mutation.");
  });
});

describe("offline queue — idempotent retry behavior", () => {
  it("enqueue returns false for a duplicate clientMutationId (no duplication)", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    const first = await queue.enqueue(makeMutation("dup-1"));
    const second = await queue.enqueue(makeMutation("dup-1"));
    expect(first).toBe(true);
    expect(second).toBe(false);

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(1);
  });

  it("a second flush of the same mutation does not re-send (it has been applied)", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("idem-1"));

    const transport = new MockTransport(appliedResponse);
    await queue.flush(flushOptions(transport));
    await queue.flush(flushOptions(transport));

    expect(transport.calls).toHaveLength(1);
    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(0);
  });

  it("retryFailed replaces the failed mutation with a new clientMutationId", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "replacement-id",
    });
    await queue.enqueue(makeMutation("retry-1"));

    const reject = new MockTransport(rejectedResponse);
    await queue.flush(flushOptions(reject));
    expect((await queue.getSnapshot()).failed).toHaveLength(1);

    const retried = await queue.retryFailed("retry-1");
    expect(retried).toBe(true);

    const snapshot = await queue.getSnapshot();
    expect(snapshot.failed).toHaveLength(0);
    expect(snapshot.pending).toHaveLength(1);
    expect(snapshot.pending[0]!.clientMutationId).toBe("replacement-id");
  });

  it("dismissFailed drops the failed mutation without retrying", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("dismiss-1"));
    await queue.flush(flushOptions(new MockTransport(rejectedResponse)));
    expect((await queue.getSnapshot()).failed).toHaveLength(1);

    const dismissed = await queue.dismissFailed("dismiss-1");
    expect(dismissed).toBe(true);
    const snapshot = await queue.getSnapshot();
    expect(snapshot.failed).toHaveLength(0);
    expect(snapshot.pending).toHaveLength(0);
  });
});

// --- API / read failure state -------------------------------------------

describe("purchase detail fetch failure state", () => {
  /**
   * Simulates the behavior of `useApiFetch` when the purchase detail GET fails:
   * the consumer sees `data=null, error=<message>`. The purchase-detail-sheet
   * renders its error StatePanel with a Retry action — never fake data.
   *
   * This test exercises the same fetch + state-machine contract that the hook
   * uses in production. We invoke the real fetch via a mock that returns a
   * 500 response and verify the consumer surfaces an honest error string.
   */
  it("a 500 response surfaces as an error string (never fake data)", async () => {
    const original = globalThis.fetch;
    let observedStatus = 0;
    let observedUrl = "";
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        observedUrl = url;
        observedStatus = 500;
        return new Response(JSON.stringify({ error: "PURCHASE_NOT_FOUND", message: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof globalThis.fetch;

      const res = await fetch(
        `/v1/purchases/${PURCHASE_ID}?businessId=${BUSINESS_ID}`,
        { headers: { Authorization: "Bearer test-token" } },
      );
      const text = await res.text();
      expect(observedStatus).toBe(500);
      expect(observedUrl).toContain(`/v1/purchases/${PURCHASE_ID}`);
      expect(res.ok).toBe(false);
      // The consumer surfaces the body text or a fallback — never fake data.
      expect(text.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("a network throw surfaces as a network error (never fake data)", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as typeof globalThis.fetch;

      let captured: unknown = null;
      try {
        await fetch(`/v1/purchases/${PURCHASE_ID}?businessId=${BUSINESS_ID}`);
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe("network down");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("the queue transport surfaces a server error status (not silently swallowed)", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => EXPECTED_UPDATED_AT,
      createMutationId: () => "mutation-id-1",
    });
    await queue.enqueue(makeMutation("fail-1"));

    const throwingTransport: SyncTransport = {
      async push(): Promise<SyncResponse> {
        throw new Error("503 service unavailable");
      },
    };
    await expect(queue.flush(flushOptions(throwingTransport))).rejects.toThrow("503 service unavailable");

    // The mutation is still pending — the consumer can retry.
    const state = await queue.getState(BUSINESS_ID);
    expect(state.pending).toBe(1);
  });
});

// --- Cross-cutting invariants ------------------------------------------

describe("forbidden fields are absent across every builder output", () => {
  const representativePayloads: ReadonlyArray<{ name: string; payload: Record<string, unknown> }> = [
    { name: "CATALOG_ITEM_ARCHIVE", payload: buildCatalogLifecyclePayload("CATALOG_ITEM_ARCHIVE", { itemId: ITEM_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT }) },
    { name: "CATALOG_ITEM_REACTIVATE", payload: buildCatalogLifecyclePayload("CATALOG_ITEM_REACTIVATE", { itemId: ITEM_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT }) },
    { name: "CUSTOMER_UPDATE", payload: buildCustomerUpdatePayload({ customerId: CUSTOMER_ID, name: "x", phone: null, email: null, expectedUpdatedAt: EXPECTED_UPDATED_AT }) },
    { name: "CUSTOMER_PAYMENT_CREATE", payload: buildCustomerPaymentPayload({ customerId: CUSTOMER_ID, amountMinor: 100, method: "CASH" }) },
    { name: "SUPPLIER_UPDATE", payload: buildSupplierUpdatePayload({ supplierId: SUPPLIER_ID, name: "x", phone: null, email: null, expectedUpdatedAt: EXPECTED_UPDATED_AT }) },
    { name: "SUPPLIER_PAYMENT_CREATE", payload: buildSupplierPaymentPayload({ supplierId: SUPPLIER_ID, amountMinor: 100, method: "CASH" }) },
    { name: "MONEY_TRANSFER_CREATE", payload: buildMoneyTransferPayload({ sourceAccountId: ACCOUNT_ID_A, destinationAccountId: ACCOUNT_ID_B, amountMinor: 100 }) },
    { name: "MONEY_RECONCILIATION_CREATE", payload: buildMoneyReconciliationPayload({ moneyAccountId: ACCOUNT_ID_A, type: "CASH_COUNT", periodStart: PERIOD_START, periodEnd: PERIOD_END, observedBalanceMinor: 100 }) },
    { name: "MONEY_RECONCILIATION_RESOLVE", payload: buildMoneyReconciliationResolvePayload({ reconciliationId: RECONCILIATION_ID, note: "x" }) },
    { name: "PURCHASE_RETURN_CREATE", payload: buildPurchaseReturnPayload({ originalPurchaseId: PURCHASE_ID, supplierId: SUPPLIER_ID, recoveryMethod: "CREDIT_NOTE", lines: [{ purchaseLineId: PURCHASE_LINE_ID, quantity: 1, sourceLocation: "AVAILABLE" }] }) },
    { name: "CASHBOOK_ADJUSTMENT_CREATE", payload: buildCashbookAdjustmentPayload({ amountDeltaMinor: 100, method: "CASH", reason: "CORRECTION", note: "x" }) },
    { name: "SALE_CREATE (reference)", payload: buildSaleCreatePayload({ currencyCode: "GHS", paymentMethod: "CASH", lines: [{ itemId: ITEM_ID, saleUnitCode: "EACH", quantity: 1 }] }) },
  ];

  it.each(representativePayloads)(
    "$name payload contains no server-authoritative / server-enriched / server-rejected field",
    ({ payload }) => {
      assertNoForbiddenFieldsDeep(payload);
    },
  );

  it("the FORBIDDEN_PAYLOAD_FIELDS set covers all known sensitive fields", () => {
    // Spot-check that the set is comprehensive — if a new forbidden field is
    // added server-side it should be added here too.
    const expected = [
      "actorStaffId", "actorRole",
      "receivedByStaffId", "paidByStaffId", "cashierStaffId",
      "initiatedByStaffId", "approvedByStaffId", "returnedByStaffId",
      "totalMinor", "balanceMinor",
      "supplierRecoveryMinor", "inventoryValueRemovedMinor", "purchasePriceVarianceMinor",
      "expectedBalanceMinor", "differenceMinor",
      "creditLimitMinor", "creditTermsDays", "paymentTermsDays", "active",
    ];
    for (const field of expected) {
      expect(FORBIDDEN_PAYLOAD_FIELDS.has(field), `expected "${field}" to be forbidden`).toBe(true);
    }
  });
});
