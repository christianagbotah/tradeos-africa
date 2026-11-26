import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const api = read("../../../../api/src/commerce/hubtel-pos-cancellation-preflight.ts");
const routes = read("../../../../api/src/commerce/hubtel-pos-routes.ts");
const ui = read("./hubtel-cancellation-preflight-panel.tsx");
const workspace = read("./hubtel-reconciliation-workspace.tsx");

describe("Hubtel payment cancellation safety preflight", () => {
  it("shows original source journal quantities and cost without pretending payment is cancelled", () => {
    expect(api).toContain("HUBTEL_PAYMENT_FINALITY_NOT_ESTABLISHED");
    expect(api).toContain("ATOMIC_STOCK_REVERSAL_NOT_ENABLED");
    expect(api).toContain('"REVIEW_ONLY" as const');
    expect(api).toContain("canReleaseStock: false as const");
    expect(api).toContain("inventory_movements im");
    expect(api).toContain("im.reference_type='SALE_LINE'");
    expect(api).toContain("line_cost_minor::text");
    expect(api).toContain("COMPONENT_VALUATION_ALLOCATION_REVIEW");
    expect(api).not.toContain("UPDATE inventory_movements");
    expect(api).not.toContain("UPDATE sales");
    expect(api).not.toContain("UPDATE payments");
    expect(api).not.toContain("recordCashbookEntry");
  });
  it("restricts the assessment and prevents caching or unsafe operator actions", () => {
    expect(routes).toContain('"/v1/sales/:saleId/hubtel/cancellation-preflight"');
    expect(routes).toContain("getHubtelCancellationPreflight");
    expect(routes).toContain('"Cache-Control","private, no-store, max-age=0"');
    expect(workspace).toContain('"Review stock impact"');
    expect(workspace).toContain("HubtelCancellationPreflightPanel");
    expect(ui).toContain("Read-only assessment");
    expect(ui).toContain("Stock release is prohibited");
    expect(ui).toContain("permission === \"REVIEW_ONLY\"");
    expect(ui).toContain("canReleaseStock === false");
    expect(ui).not.toContain("Cancel payment");
    expect(ui).not.toContain("Release stock");
  });
});
