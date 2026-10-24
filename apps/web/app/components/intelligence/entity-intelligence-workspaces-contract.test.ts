import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(ROOT, relative), "utf8");

const detailSurfaces = [
  ["app/components/inventory/inventory-adjustment-sheet.tsx", "CATALOG_ITEM", "row.item.id", "Adjustment type"],
  ["app/components/customers/customer-sheet.tsx", "CUSTOMER", "customer.id", "Account history"],
  ["app/components/purchases/supplier-sheet.tsx", "SUPPLIER", "supplier.id", "Account history"],
  ["app/components/purchases/purchase-detail-sheet.tsx", "PURCHASE", "purchase.id", "Purchase summary"],
] as const;

describe("entity intelligence detail-surface integration", () => {
  it.each(detailSurfaces)("mounts intelligence in %s before mutation/history content", (file, entityType, entityId, laterContent) => {
    const source = read(file);
    expect(source).toContain("EntityIntelligencePanel");
    expect(source).toContain(`entityType="${entityType}"`);
    expect(source).toContain(`entityId={${entityId}}`);
    const panel = source.indexOf("<EntityIntelligencePanel");
    const later = source.indexOf(laterContent);
    expect(panel).toBeGreaterThan(-1);
    expect(later).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(later);
  });

  it("does not mount entity intelligence in list workspaces", () => {
    for (const file of [
      "app/components/inventory/inventory-workspace.tsx",
      "app/components/customers/customer-workspace.tsx",
      "app/components/purchases/supplier-workspace.tsx",
    ]) {
      expect(read(file)).not.toContain("EntityIntelligencePanel");
    }
  });
});
