import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");
const returnSheet = source("../returns/return-refund-sheet.tsx");
const exchangeSheet = source("../returns/exchange-sheet.tsx");
const adjustmentSheet = source("../inventory/inventory-adjustment-sheet.tsx");

describe("receipt correction and inventory posting only close after APPLIED", () => {
  it.each([
    ["return/refund", returnSheet, "onComplete();"],
    ["exchange", exchangeSheet, "onComplete();"],
    ["stock adjustment", adjustmentSheet, "onSaved();"],
  ])("%s has durable queue confirmation before success callback", (_name, code, callback) => {
    const verifier = code.indexOf("await enqueueAndConfirmMutation(");
    const success = code.indexOf(callback, verifier);
    expect(verifier).toBeGreaterThan(0);
    expect(success).toBeGreaterThan(verifier);
    expect(code).toContain("PendingMutationConfirmationError");
    expect(code).toContain("pendingPostingRef.current?.targetId");
    expect(code.includes("pendingPostingRef.current?.mutationId") ||
      code.includes("pendingPostingRef.current.mutationId")).toBe(true);
    expect(code).toContain("disabled={busy} aria-label=\"Close\"");
    expect(code).toContain("if (!busy) onClose()");
  });
  it("shows an amber pending status and checks existing posting without creating another", () => {
    for (const code of [returnSheet, exchangeSheet, adjustmentSheet]) {
      expect(code).toContain("const awaitingConfirmation = pendingPostingRef.current?.targetId");
      expect(code).toContain('"Check posting status"');
      expect(code).toContain('awaitingConfirmation ? "tos-banner tos-banner--warning" : "tos-banner tos-banner--danger"');
    }
  });
  it("locks all corrections to a receipt even when mutation type changes", () => {
    for (const code of [returnSheet, exchangeSheet]) {
      expect(code).toContain('["RETURN_CREATE", "REFUND_CREATE", "EXCHANGE_CREATE"]');
      expect(code).toContain('targetField: "originalSaleId"');
      expect(code).toContain("pendingPostingRef.current = {");
    }
  });
  it("prevents double-entry stock changes on the same branch and item", () => {
    expect(adjustmentSheet).toContain("mutationTypes: [INVENTORY_ADJUSTMENT_CREATE_TYPE]");
    expect(adjustmentSheet).toContain('targetField: "itemId"');
    expect(adjustmentSheet).toContain("pendingPostingRef.current?.targetId !== row.item.id");
  });
});
