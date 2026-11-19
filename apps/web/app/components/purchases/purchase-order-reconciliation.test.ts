import { describe, expect, it } from "vitest";
import {
  rememberPurchaseOrder,
  reconcilePurchaseOrders,
  type PurchaseOrderRow,
  type ConfirmedPurchaseOrder,
} from "./purchase-order-reconciliation";

const original: PurchaseOrderRow = {
  id: "po-1", orderNumber: "PO-2026-001", status: "DRAFT",
  totalMinor: 12000, currencyCode: "GHS", supplierName: "Supplier A",
  createdAt: "2026-11-19T10:00:00.000Z", expectedDeliveryDate: null,
};
const now = Date.parse("2026-11-19T10:05:00Z");

describe("purchase order CRUD list synchronisation", () => {
  it("keeps a newly confirmed draft visible if a refetch returns no orders", () => {
    const map = new Map<string, ConfirmedPurchaseOrder>();
    rememberPurchaseOrder(map, "business-a:branch-1", original, now);
    const rows = reconcilePurchaseOrders([], map, "business-a:branch-1", now + 200);
    expect(rows).toEqual([original]);
    expect(map.size).toBe(1);
  });
  it("keeps newly issued and cancelled status instead of reverting to DRAFT", () => {
    const map = new Map<string, ConfirmedPurchaseOrder>();
    const issued = { ...original, status: "ISSUED" as const };
    rememberPurchaseOrder(map, "business-a:branch-1", issued, now);
    expect(reconcilePurchaseOrders([original], map, "business-a:branch-1", now + 400)[0]?.status)
      .toBe("ISSUED");
    const cancelled = { ...original, status: "CANCELLED" as const };
    rememberPurchaseOrder(map, "business-a:branch-1", cancelled, now);
    expect(reconcilePurchaseOrders([issued], map, "business-a:branch-1", now + 800)[0]?.status)
      .toBe("CANCELLED");
  });
  it("stops guarding once the server catches up or an external update is newer", () => {
    const map = new Map<string, ConfirmedPurchaseOrder>();
    const issued = { ...original, status: "ISSUED" as const };
    rememberPurchaseOrder(map, "business-a:branch-1", issued, now);
    expect(reconcilePurchaseOrders([issued], map, "business-a:branch-1", now + 500)).toEqual([issued]);
    expect(map.size).toBe(0);
    rememberPurchaseOrder(map, "business-a:branch-1", original, now);
    expect(reconcilePurchaseOrders([issued], map, "business-a:branch-1", now + 500)[0]?.status)
      .toBe("ISSUED");
    expect(map.size).toBe(0);
  });
  it("does not contaminate another branch or tenant", () => {
    const map = new Map<string, ConfirmedPurchaseOrder>();
    rememberPurchaseOrder(map, "business-a:branch-1", original, now);
    expect(reconcilePurchaseOrders([], map, "business-a:branch-2", now + 500)).toEqual([]);
    expect(reconcilePurchaseOrders([], map, "business-b:branch-1", now + 500)).toEqual([]);
  });
  it("expires guard to allow authoritative data changes", () => {
    const map = new Map<string, ConfirmedPurchaseOrder>();
    rememberPurchaseOrder(map, "business-a:branch-1", original, now);
    expect(reconcilePurchaseOrders([], map, "business-a:branch-1", now + 150000)).toEqual([]);
    expect(map.size).toBe(0);
  });
});
