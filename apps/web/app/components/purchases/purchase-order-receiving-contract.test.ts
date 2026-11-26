import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const receipt=readFileSync(fileURLToPath(
  new URL("./purchase-receipt-builder.tsx",import.meta.url)),"utf8");
const preview=readFileSync(fileURLToPath(
  new URL("../../(workspace)/purchase-orders/[orderId]/page.tsx",import.meta.url)),"utf8");
const purchaseDetail=readFileSync(fileURLToPath(
  new URL("./purchase-detail-sheet.tsx",import.meta.url)),"utf8");

describe("supplier PO receiving UX contract",()=>{
  it("posts real deliveries through the existing offline-first purchase receipt mutation",()=>{
    expect(receipt).toContain('mutationType: "PURCHASE_RECEIVE_CREATE"');
    expect(receipt).toContain('...(purchaseOrderId ? {purchaseOrderId}:{})');
    expect(receipt).toContain('purchaseOrderLineId:line.purchaseOrderLineId');
    expect(receipt).toContain("quantity:0, // Explicit actual goods entry");
    expect(receipt).toContain("line.quantity <= (line.remainingQuantity??0)");
    expect(receipt).toContain("Leave quantity 0 for undelivered lines");
    expect(receipt).toContain("noMatchingAccount");
    expect(receipt).toContain("poVariance");
    expect(receipt).toContain("supplier's invoice");
  });
  it("shows ordered, received, outstanding, supplier invoice variance and delivery receipts",()=>{
    for(const text of ["Ordered","Received","Outstanding",
      "receivedQuantity","remainingQuantity","priceVarianceMinor",
      "fulfillmentStatus","receivedTotalMinor","receiptCount","Posted deliveries"]){
      expect(preview).toContain(text);
    }
    expect(preview).toContain("Receive outstanding goods");
    expect(preview).toContain("<PurchaseReceiptBuilder");
    expect(preview).toContain("onComplete={()=>{setReceiveOpen(false);refetch();}}");
    expect(preview).toContain("Print / Save as PDF");
  });
  it("shows the original supplier PO number on actual purchase receipts",()=>{
    expect(purchaseDetail).toContain("Related purchase order:");
    expect(purchaseDetail).toContain("purchase.purchaseOrderId");
    expect(purchaseDetail).toContain("purchase.purchaseOrderNumber");
  });
});
