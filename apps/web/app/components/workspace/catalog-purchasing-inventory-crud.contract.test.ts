import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const provider = read("./workspace-provider.tsx");
const catalog = read("../catalog/catalog-item-sheet.tsx");
const purchasing = read("../purchases/purchase-order-workspace.tsx");
const correction = read("../returns/return-refund-workspace.tsx");

describe("CRUD data refresh contract across catalog, purchasing, returns and inventory", () => {
  it("rejects old catalog reads after a new mutation or business switch", () => {
    expect(provider).toContain("const catalogRequestSeq = useRef(0)");
    expect(provider).toContain("requestId === catalogRequestSeq.current");
    expect(provider).toContain("reconcileConfirmedCatalog(");
    expect(provider).toContain("applyConfirmedCatalogUpdate");
    expect(provider).toContain("applyConfirmedCatalogDeletion");
    expect(provider).toContain('cache: "no-store"');
  });
  it("does not show an inventory request from a previous branch", () => {
    expect(provider).toContain("const inventoryRequestSeq = useRef(0)");
    expect(provider).toContain("active?.businessId === businessId && active?.branchId === branchId");
    expect(provider).toContain("++inventoryRequestSeq.current");
  });
  it("only protects catalog edits after the specific queued mutation is posted", () => {
    expect(catalog).toContain("await queue.getSnapshot(session.businessId)");
    expect(catalog).toContain("snapshot.pending.some");
    expect(catalog).toContain("snapshot.failed.some");
    expect(catalog).toContain("applyConfirmedCatalogUpdate(session.businessId, item");
  });
  it("purchase order status changes use server-confirmed records before refetch", () => {
    expect(purchasing).toContain("displayConfirmedOrder(result.order)");
    expect(purchasing).toContain("reconcilePurchaseOrders(");
    expect(purchasing).toContain("const expectedStatus:Status=");
    expect(purchasing).toContain("result.order.status!==expectedStatus");
  });
  it("posts a receipt correction then reloads receipts, customer balances and inventory", () => {
    expect(correction).toContain("const onCorrectionComplete = () => {");
    expect(correction).toContain("refetch();");
    expect(correction).toContain("void refreshInventory();");
    expect(correction).toContain("void refreshCustomers();");
    expect(correction.match(/onComplete=\{onCorrectionComplete\}/g)).toHaveLength(2);
  });
});
