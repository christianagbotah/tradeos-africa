import { describe, expect, it } from "vitest";
import {
  canIssueReceipt, isReceiptIdentifier, receiptTimestamp, receiptTotals, receiptUrl,
  type ReceiptSale,
} from "./receipt-document";

const sale: ReceiptSale = {
  id: "b8fe8921-08a7-423c-b2eb-947beec01acd",
  branchId: "36f81f12-68b8-4d4c-b58b-cb537d8140d2",
  status: "COMPLETED", completedAt: "2026-11-15T14:10:00Z",
  createdAt: "2026-11-15T14:09:00Z", currencyCode: "GHS", totalMinor: 4400,
  customer: null, cashierName: "Demo Cashier",
  lines: [{
    id: "line", itemName: "Bread", quantity: 2, saleUnitCode: "PCS",
    unitNetMinor: 2000, unitTaxMinor: 200, lineTaxMinor: 400, lineTotalMinor: 4400,
  }],
  payments: [{
    id: "payment", method: "MOMO", amountMinor: 4400, refundedMinor: 0,
    status: "SUCCEEDED", providerReference: "HUBTEL-VERIFIED",
  }],
};

describe("customer receipt release gate", () => {
  it("requires the server-confirmed COMPLETED sale", () => {
    expect(canIssueReceipt(sale)).toBe(true);
    expect(canIssueReceipt({ ...sale, status: "OPEN", completedAt: null })).toBe(false);
    expect(canIssueReceipt({ ...sale, status: "REFUNDED" })).toBe(true);
    expect(canIssueReceipt({ ...sale, status: "PARTIALLY_REFUNDED" })).toBe(true);
    expect(canIssueReceipt({ ...sale, status: "REFUNDED", completedAt: null })).toBe(false);
    expect(canIssueReceipt({ ...sale, payments: [{ ...sale.payments[0]!, status: "PENDING" }] })).toBe(false);
  });
  it("does not treat offline mutation references as proof of payment", () => {
    expect(canIssueReceipt({ ...sale, id: "queued-local-id" })).toBe(false);
    expect(isReceiptIdentifier("queued-local-id")).toBe(false);
    expect(receiptUrl("queued-local-id")).toBeNull();
    expect(receiptUrl(sale.id)).toBe("/sales/receipt/" + sale.id);
  });
  it("reports payment and refunds without hiding reversals", () => {
    expect(receiptTotals(sale)).toEqual({
      taxMinor: 400, customerCreditMinor: 0, grossPaidMinor: 4400, refundedMinor: 0, netPaidMinor: 4400,
    });
    expect(receiptTotals({ ...sale, payments: [{
      ...sale.payments[0]!, status: "PARTIALLY_REVERSED", refundedMinor: 1000,
    }] }).netPaidMinor).toBe(3400);
  });
  it("does not mislabel customer credit as collected cash", () => {
    const credit = { ...sale, payments: [{ ...sale.payments[0]!, method: "CUSTOMER_CREDIT" }] };
    expect(receiptTotals(credit).customerCreditMinor).toBe(4400);
    expect(receiptTotals(credit).grossPaidMinor).toBe(0);
  });
  it("formats merchant-local dates dd/mm/yyyy", () => {
    expect(receiptTimestamp(sale.completedAt!)).toMatch(/15\/11\/2026/);
  });
});
