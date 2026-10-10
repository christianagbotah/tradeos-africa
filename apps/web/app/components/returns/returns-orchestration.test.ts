import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const coordinator = () => fs.readFileSync(path.join(appRoot, "components", "sales-returns.tsx"), "utf8");

describe("returns correction orchestration", () => {
  it("initializes correction choices once, then reconciles live revalidation without resetting user edits", () => {
    const source = coordinator();
    expect(source).toContain("resetCorrectionState");
    expect(source).toMatch(/openNewCorrection[\s\S]*resetCorrectionState\(initialMode\)[\s\S]*loadDetail\(saleId\)/);
    expect(source).toMatch(/if \(cached\) applySaleDetail\(cached\.sale, false\)/);
    expect(source).toMatch(/applySaleDetail\(response\.sale, Boolean\(cached\)\)/);
    expect(source).not.toContain("resetCorrectionState?: boolean");
  });

  it("preserves the exchange deep link by opening that sale with EXCHANGE as the explicit initial mode", () => {
    const source = coordinator();
    expect(source).toContain('get("saleId")');
    expect(source).toContain('get("mode")');
    expect(source).toMatch(/openNewCorrection\(saleId,\s*requestedMode\)/);
    expect(source).toMatch(/requestedMode[\s\S]*"EXCHANGE"[\s\S]*"RETURN_REFUND"/);
  });

  it("guards detail responses with active receipt identity and request generation so closed or replaced receipts cannot reopen", () => {
    const source = coordinator();
    expect(source).toContain("detailRequestGenerationRef");
    expect(source).toContain("activeSaleIdRef");
    expect(source).toContain("closeSelected");
    expect(source).toMatch(/detailRequestGenerationRef\.current \+= 1/);
    expect(source).toMatch(/activeSaleIdRef\.current !== saleId/);
    expect(source).toMatch(/requestGeneration !== detailRequestGenerationRef\.current/);
  });

  it("refreshes the active receipt through a background-only path that preserves its correction draft", () => {
    const source = coordinator();
    expect(source).toMatch(/\["SALE_CREATE",\s*"RETURN_CREATE",\s*"REFUND_CREATE",\s*"EXCHANGE_CREATE"\]/);
    expect(source).toContain("refreshSelectedDetail");
    expect(source).toMatch(/selected\?\.id[\s\S]*refreshSelectedDetail\(selected\.id\)/);
    expect(source).not.toMatch(/selected\?\.id[\s\S]*void loadDetail\(selected\.id\)/);
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
