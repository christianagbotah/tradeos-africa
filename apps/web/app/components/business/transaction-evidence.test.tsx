import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadEvidence() {
  const modulePath = "./transaction-evidence";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

describe("shared transaction evidence presentation", () => {
  it("normalizes transaction statuses without hiding their business meaning", async () => {
    const module = await loadEvidence();
    expect(module?.TransactionStatusBadge).toBeTypeOf("function");
    if (!module?.TransactionStatusBadge) return;
    const completed = renderToStaticMarkup(<module.TransactionStatusBadge status="COMPLETED" />);
    const processing = renderToStaticMarkup(<module.TransactionStatusBadge status="PROCESSING" />);
    const review = renderToStaticMarkup(<module.TransactionStatusBadge status="NEEDS_REVIEW" />);
    expect(completed).toContain("Completed");
    expect(processing).toContain("Processing");
    expect(review).toContain("Needs review");
    expect(completed).toContain("transaction-status-badge");
  });

  it("uses one pending/applied/needs-review language across durable transaction workflows", async () => {
    const module = await loadEvidence();
    expect(module?.transactionSyncCopy).toBeTypeOf("function");
    expect(module?.TransactionSyncNotice).toBeTypeOf("function");
    if (!module?.transactionSyncCopy || !module.TransactionSyncNotice) return;
    expect(module.transactionSyncCopy("PENDING", "Inventory adjustment")).toMatch(/pending synchronization/i);
    expect(module.transactionSyncCopy("APPLIED", "Return/refund")).toMatch(/applied/i);
    expect(module.transactionSyncCopy("NEEDS_REVIEW", "Purchase receipt")).toMatch(/needs review/i);
    const html = renderToStaticMarkup(<module.TransactionSyncNotice state="NEEDS_REVIEW" subject="Exchange" detail="Refresh and retry." />);
    expect(html).toContain("Needs review");
    expect(html).toContain("Refresh and retry");
  });

  it("renders immutable posted-history and actor/reason evidence consistently", async () => {
    const module = await loadEvidence();
    expect(module?.PostedHistoryNote).toBeTypeOf("function");
    expect(module?.ActorReasonEvidence).toBeTypeOf("function");
    if (!module?.PostedHistoryNote || !module.ActorReasonEvidence) return;
    const note = renderToStaticMarkup(<module.PostedHistoryNote subject="Sale receipt" correction="returns, refunds or exchanges" />);
    expect(note).toMatch(/read-only|read only/i);
    expect(note).toContain("returns, refunds or exchanges");
    const actor = renderToStaticMarkup(<module.ActorReasonEvidence actor="Ama" reason="COUNT_CORRECTION" reference="MOV-123" />);
    expect(actor).toContain("Ama");
    expect(actor).toContain("COUNT CORRECTION");
    expect(actor).toContain("MOV-123");
  });

  it("is consumed by Sales, Returns, Purchases and Inventory while their purpose-built permission gates remain", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const files = [
      "sales/sale-detail-sheet.tsx",
      "returns/return-refund-sheet.tsx",
      "purchases/purchase-detail-sheet.tsx",
      "inventory/inventory-detail-sheet.tsx",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source, file).toContain("transaction-evidence");
    }
    const sale = fs.readFileSync(path.join(root, "sales/sale-detail-sheet.tsx"), "utf8");
    const inventory = fs.readFileSync(path.join(root, "inventory/inventory-workspace.tsx"), "utf8");
    const purchase = fs.readFileSync(path.join(root, "purchases/purchase-detail-sheet.tsx"), "utf8");
    expect(sale).toContain("canProcessReturns");
    expect(inventory).toContain("canAdjust");
    expect(purchase).toContain("canReturn");
    expect(sale).not.toMatch(/Delete sale|Edit sale/);
    expect(purchase).not.toMatch(/Delete purchase|Edit purchase/);
  });

  it("ships a 15px readable, touch-safe shared evidence style", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "transaction-evidence.css"), "utf8");
    expect(css).toMatch(/transaction-status-badge[\s\S]*font-size:\s*(?:13|14|15)px/);
    expect(css).toMatch(/transaction-sync-notice[\s\S]*font-size:\s*15px/);
    expect(css).toMatch(/transaction-evidence-action[\s\S]*min-height:\s*48px/);
  });
});
