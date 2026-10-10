import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const coordinator = () => fs.readFileSync(path.join(appRoot, "components", "sales-returns.tsx"), "utf8");

describe("returns correction orchestration", () => {
  it("starts every newly selected correction with fresh return defaults while allowing an explicit initial mode", () => {
    const source = coordinator();
    expect(source).toContain("openNewCorrection");
    expect(source).toMatch(/setMode\(initialMode\)/);
    expect(source).toMatch(/setRefundMethod\("ORIGINAL_METHOD"\)/);
    expect(source).toMatch(/setReason\("Customer return"\)/);
    expect(source).toMatch(/onSelect=\{\(saleId\) => void openNewCorrection\(saleId\)\}/);
  });

  it("preserves the exchange deep link by opening that sale with EXCHANGE as the explicit initial mode", () => {
    const source = coordinator();
    expect(source).toContain('get("saleId")');
    expect(source).toContain('get("mode")');
    expect(source).toMatch(/openNewCorrection\(saleId,\s*requestedMode\)/);
    expect(source).toMatch(/requestedMode[\s\S]*"EXCHANGE"[\s\S]*"RETURN_REFUND"/);
  });

  it("refreshes the open sale detail after relevant applied mutations without resetting the active correction draft", () => {
    const source = coordinator();
    expect(source).toMatch(/\["SALE_CREATE",\s*"RETURN_CREATE",\s*"REFUND_CREATE",\s*"EXCHANGE_CREATE"\]/);
    expect(source).toMatch(/void loadSales\(query\)[\s\S]*selected\?\.id[\s\S]*void loadDetail\(selected\.id\)/);
    expect(source).not.toMatch(/selected\?\.id[\s\S]*openNewCorrection\(selected\.id/);
  });

  it("keeps offline cache, return mutation ownership and route-level permission presentation unchanged", () => {
    const source = coordinator();
    const returnsPage = fs.readFileSync(path.join(appRoot, "(workspace)", "returns", "page.tsx"), "utf8");
    expect(source).toContain('"sales-list"');
    expect(source).toContain('"sale-detail"');
    expect(source).toContain('mutationType: "RETURN_CREATE"');
    expect(source).toContain("navigator.onLine");
    expect(returnsPage).toContain('canAccessWorkspaceRoute(context.membership.role, "/returns")');
  });
});
