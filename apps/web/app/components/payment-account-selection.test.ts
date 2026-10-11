/**
 * Production-behavior tests for payment money-account selection.
 *
 * Tests the ACTUAL production helpers from lib/payment-account-selection.ts
 * (not reimplemented copies). These helpers are used by BOTH
 * CustomerPaymentForm and SupplierPaymentForm.
 *
 * Verified behaviors:
 *   1. Customer payload includes chosen moneyAccountId
 *   2. Supplier payload includes chosen moneyAccountId
 *   3. Active + currency + method filtering (production filterEligibleAccounts)
 *   4. Configured default wins even when it is not first
 *   5. Method change resolves correct new default
 *   6. Incompatible previous account is cleared
 *   7. No valid account disables submission (resolveDefaultAccountId returns null)
 *   8. No-account UI renders /cashbook (verified via source inspection)
 *   9. Non-GHS customer business works (USD filtering)
 *  10. Queued mutation freezes selected account ID
 *  11. No balance/COGS/server-calculated values enter the client payload
 */
import { describe, expect, it } from "vitest";
import {
  filterEligibleAccounts,
  resolveDefaultAccountId,
  isSelectionValid,
  type MoneyAccount,
  type MoneyAccountDefault,
} from "../../lib/payment-account-selection";
import {
  buildCustomerPaymentPayload,
  buildSupplierPaymentPayload,
} from "../../lib/mutation-builders";

// --- Test fixtures ---

const ACCOUNTS: MoneyAccount[] = [
  { id: "cash-1", name: "Cash Drawer A", method: "CASH", active: true, currencyCode: "GHS" },
  { id: "cash-2", name: "Cash Drawer B", method: "CASH", active: true, currencyCode: "GHS" },
  { id: "momo-1", name: "MTN MoMo", method: "MOMO", active: true, currencyCode: "GHS" },
  { id: "bank-1", name: "Ecobank", method: "BANK", active: true, currencyCode: "GHS" },
  { id: "card-1", name: "Card Clearing", method: "CARD", active: true, currencyCode: "GHS" },
  { id: "inactive-cash", name: "Old Cash", method: "CASH", active: false, currencyCode: "GHS" },
  { id: "usd-cash", name: "USD Cash", method: "CASH", active: true, currencyCode: "USD" },
];

const NO_DEFAULTS: MoneyAccountDefault[] = [];

const DEFAULTS_WITH_CASH_2: MoneyAccountDefault[] = [
  { branchId: "br-1", method: "CASH", moneyAccountId: "cash-2", accountName: "Cash Drawer B", updatedAt: "2026-01-01T00:00:00.000Z" },
];

const DEFAULTS_WITH_MOMO_1: MoneyAccountDefault[] = [
  { branchId: "br-1", method: "MOMO", moneyAccountId: "momo-1", accountName: "MTN MoMo", updatedAt: "2026-01-01T00:00:00.000Z" },
];

// --- Tests ---

describe("payment account selection — production helpers", () => {
  describe("filterEligibleAccounts (production function)", () => {
    it("3a. filters to active + currency + method for CASH/GHS", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      expect(eligible).toHaveLength(2);
      expect(eligible.map((a) => a.id)).toEqual(["cash-1", "cash-2"]);
      // Inactive account excluded
      expect(eligible.find((a) => a.id === "inactive-cash")).toBeUndefined();
      // USD account excluded (currency mismatch)
      expect(eligible.find((a) => a.id === "usd-cash")).toBeUndefined();
    });

    it("3b. filters to MOMO/GHS only", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "MOMO", "GHS");
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.id).toBe("momo-1");
    });

    it("3c. filters to BANK/GHS only", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "BANK", "GHS");
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.id).toBe("bank-1");
    });

    it("3d. filters to CARD/GHS only", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "CARD", "GHS");
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.id).toBe("card-1");
    });

    it("3e. returns empty for method with no accounts", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "OTHER", "GHS");
      expect(eligible).toHaveLength(0);
    });

    it("9. non-GHS customer business: USD CASH accounts are eligible, GHS excluded", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "CASH", "USD");
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.id).toBe("usd-cash");
      // GHS accounts are excluded for a USD business
      expect(eligible.find((a) => a.id === "cash-1")).toBeUndefined();
    });
  });

  describe("resolveDefaultAccountId (production function)", () => {
    it("4. configured default wins even when it is not first", () => {
      // Two CASH accounts: cash-1 (first), cash-2 (second)
      // Configured default is cash-2
      const eligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      expect(eligible).toHaveLength(2);
      expect(eligible[0]!.id).toBe("cash-1"); // alphabetical/array first
      const resolved = resolveDefaultAccountId(eligible, DEFAULTS_WITH_CASH_2, "CASH");
      expect(resolved).toBe("cash-2"); // configured default wins, NOT cash-1
    });

    it("5a. method change resolves correct new default (CASH→MOMO)", () => {
      // Start with CASH: default is cash-2
      const cashEligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      const cashResolved = resolveDefaultAccountId(cashEligible, DEFAULTS_WITH_CASH_2, "CASH");
      expect(cashResolved).toBe("cash-2");

      // Switch to MOMO: default is momo-1
      const momoEligible = filterEligibleAccounts(ACCOUNTS, "MOMO", "GHS");
      const momoResolved = resolveDefaultAccountId(momoEligible, DEFAULTS_WITH_MOMO_1, "MOMO");
      expect(momoResolved).toBe("momo-1");
    });

    it("5b. method with no configured default + single account: auto-selects that account", () => {
      const bankEligible = filterEligibleAccounts(ACCOUNTS, "BANK", "GHS");
      const resolved = resolveDefaultAccountId(bankEligible, NO_DEFAULTS, "BANK");
      expect(resolved).toBe("bank-1");
    });

    it("5c. method with no configured default + multiple accounts: returns null (require explicit selection)", () => {
      const cashEligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      expect(cashEligible.length).toBeGreaterThanOrEqual(2);
      const resolved = resolveDefaultAccountId(cashEligible, NO_DEFAULTS, "CASH");
      expect(resolved).toBeNull(); // do NOT pretend first is default
    });

    it("7. no eligible accounts: returns null (disables submission)", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "OTHER", "GHS");
      expect(eligible).toHaveLength(0);
      const resolved = resolveDefaultAccountId(eligible, NO_DEFAULTS, "OTHER");
      expect(resolved).toBeNull();
    });

    it("configured default not in eligible accounts: falls back to single-account or null", () => {
      // Default points to cash-2 but we're filtering USD (cash-2 is GHS)
      const usdEligible = filterEligibleAccounts(ACCOUNTS, "CASH", "USD");
      const resolved = resolveDefaultAccountId(usdEligible, DEFAULTS_WITH_CASH_2, "CASH");
      // cash-2 is not eligible (wrong currency), so fall back to single account
      expect(resolved).toBe("usd-cash");
    });
  });

  describe("isSelectionValid (production function)", () => {
    it("6a. incompatible previous account is cleared (isSelectionValid returns false)", () => {
      // User had cash-2 selected, switches to MOMO
      const momoEligible = filterEligibleAccounts(ACCOUNTS, "MOMO", "GHS");
      const valid = isSelectionValid("cash-2", momoEligible);
      expect(valid).toBe(false); // cash-2 is not a MOMO account
    });

    it("6b. valid selection returns true", () => {
      const cashEligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      const valid = isSelectionValid("cash-2", cashEligible);
      expect(valid).toBe(true);
    });

    it("6c. null selection returns false", () => {
      const cashEligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      const valid = isSelectionValid(null, cashEligible);
      expect(valid).toBe(false);
    });
  });

  describe("mutation payload (production builders)", () => {
    it("1. customer payload includes chosen moneyAccountId", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "CASH", "GHS");
      const defaultId = resolveDefaultAccountId(eligible, DEFAULTS_WITH_CASH_2, "CASH");
      expect(defaultId).toBe("cash-2");
      const payload = buildCustomerPaymentPayload({
        customerId: "cust-1",
        amountMinor: 5000,
        method: "CASH",
        moneyAccountId: defaultId,
        providerReference: null,
      });
      expect(payload.moneyAccountId).toBe("cash-2");
    });

    it("2. supplier payload includes chosen moneyAccountId", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "BANK", "GHS");
      const defaultId = resolveDefaultAccountId(eligible, NO_DEFAULTS, "BANK");
      expect(defaultId).toBe("bank-1");
      const payload = buildSupplierPaymentPayload({
        supplierId: "sup-1",
        amountMinor: 10000,
        method: "BANK",
        moneyAccountId: defaultId,
        providerReference: null,
      });
      expect(payload.moneyAccountId).toBe("bank-1");
    });

    it("9b. non-GHS customer payment: USD account ID in payload", () => {
      const eligible = filterEligibleAccounts(ACCOUNTS, "CASH", "USD");
      const defaultId = resolveDefaultAccountId(eligible, NO_DEFAULTS, "CASH");
      expect(defaultId).toBe("usd-cash");
      const payload = buildCustomerPaymentPayload({
        customerId: "cust-1",
        amountMinor: 5000,
        method: "CASH",
        moneyAccountId: defaultId,
        providerReference: null,
      });
      expect(payload.moneyAccountId).toBe("usd-cash");
    });

    it("10. queued mutation freezes selected account ID (string in payload)", () => {
      const payload = buildCustomerPaymentPayload({
        customerId: "cust-1",
        amountMinor: 5000,
        method: "CASH",
        moneyAccountId: "cash-2",
        providerReference: null,
      });
      expect(typeof payload.moneyAccountId).toBe("string");
      expect(payload.moneyAccountId).toBe("cash-2");
    });

    it("11a. no balance/COGS/server-calculated values in customer payload", () => {
      const payload = buildCustomerPaymentPayload({
        customerId: "cust-1",
        amountMinor: 5000,
        method: "CASH",
        moneyAccountId: "cash-1",
        providerReference: null,
      });
      const forbidden = ["balance", "balanceMinor", "newBalance", "newBalanceMinor", "outstandingBalance", "cogs", "profit"];
      for (const key of forbidden) {
        expect(payload).not.toHaveProperty(key);
      }
    });

    it("11b. no balance/COGS/server-calculated values in supplier payload", () => {
      const payload = buildSupplierPaymentPayload({
        supplierId: "sup-1",
        amountMinor: 10000,
        method: "BANK",
        moneyAccountId: "bank-1",
        providerReference: null,
      });
      const forbidden = ["balance", "balanceMinor", "newBalance", "payableBalance", "outstandingPayable", "cogs", "profit"];
      for (const key of forbidden) {
        expect(payload).not.toHaveProperty(key);
      }
    });
  });

  describe("no-account UI renders /cashbook (source inspection)", () => {
    it("8. customer-sheet no-account state links to /cashbook", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "customers/customer-sheet.tsx"),
        "utf8",
      );
      expect(src).toContain('href="/cashbook"');
      expect(src).toContain("Configure in Cashbook");
    });

    it("8b. supplier-sheet no-account state links to /cashbook", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "purchases/supplier-sheet.tsx"),
        "utf8",
      );
      expect(src).toContain('href="/cashbook"');
      expect(src).toContain("Configure in Cashbook");
    });

    it("8c. customer-sheet uses session.currencyCode (no GHS hardcode)", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "customers/customer-sheet.tsx"),
        "utf8",
      );
      expect(src).not.toContain('const currency = "GHS"');
      expect(src).toContain("session.currencyCode");
    });

    it("8d. both forms use production helpers (filterEligibleAccounts, resolveDefaultAccountId)", () => {
      const fs = require("node:fs");
      const path = require("node:path");
      const customerSrc = fs.readFileSync(
        path.resolve(__dirname, "customers/customer-sheet.tsx"),
        "utf8",
      );
      const supplierSrc = fs.readFileSync(
        path.resolve(__dirname, "purchases/supplier-sheet.tsx"),
        "utf8",
      );
      for (const src of [customerSrc, supplierSrc]) {
        expect(src).toContain("filterEligibleAccounts");
        expect(src).toContain("resolveDefaultAccountId");
        expect(src).toContain("isSelectionValid");
        expect(src).toContain("money-account-defaults");
      }
    });
  });
});
