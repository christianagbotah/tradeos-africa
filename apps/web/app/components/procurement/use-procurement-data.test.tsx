import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(root, "use-procurement-data.tsx");

async function loadHookModule() {
  const modulePath = "./use-procurement-data";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

describe("shared procurement data source", () => {
  it("exports the shared hook and validates the cached snapshot shape", async () => {
    const module = await loadHookModule();
    expect(module?.useProcurementData).toBeTypeOf("function");
    expect(module?.isProcurementSnapshot).toBeTypeOf("function");
    if (!module) return;

    expect(module.isProcurementSnapshot({ suppliers: [], inventory: [], purchases: [] })).toBe(true);
    expect(module.isProcurementSnapshot({ suppliers: [], inventory: [] })).toBe(false);
    expect(module.isProcurementSnapshot(null)).toBe(false);
  });

  it("pins business and branch scoped cache plus the existing three endpoints", () => {
    expect(fs.existsSync(hookPath)).toBe(true);
    if (!fs.existsSync(hookPath)) return;
    const source = fs.readFileSync(hookPath, "utf8");

    expect(source).toContain('readFeatureCache("purchases-inventory", businessId, branchId, "root", isProcurementSnapshot)');
    expect(source).toContain('writeFeatureCache("purchases-inventory", businessId, branchId, next)');
    expect(source).toContain('/api/tradeos/v1/suppliers?businessId=');
    expect(source).toContain('/api/tradeos/v1/inventory?businessId=');
    expect(source).toContain('/api/tradeos/v1/purchases?businessId=');
  });

  it("guards stale session responses and exposes truthful live cached unavailable source states", () => {
    expect(fs.existsSync(hookPath)).toBe(true);
    if (!fs.existsSync(hookPath)) return;
    const source = fs.readFileSync(hookPath, "utf8");

    expect(source).toContain("captureSessionEpoch");
    expect(source).toContain("isSessionEpochCurrent");
    expect(source).toContain('type ProcurementDataSource = "live" | "cached" | "unavailable"');
    expect(source).toContain('setSource("cached")');
    expect(source).toContain('setSource("live")');
    expect(source).toContain('setSource("unavailable")');
    expect(source).toContain("navigator.onLine");
  });

  it("refreshes after the existing stock and purchasing mutations are applied", () => {
    expect(fs.existsSync(hookPath)).toBe(true);
    if (!fs.existsSync(hookPath)) return;
    const source = fs.readFileSync(hookPath, "utf8");
    for (const mutationType of [
      "PURCHASE_RETURN_CREATE",
      "PURCHASE_RECEIVE_CREATE",
      "SUPPLIER_PAYMENT_CREATE",
      "SALE_CREATE",
      "RETURN_CREATE",
      "REFUND_CREATE",
    ]) {
      expect(source).toContain(mutationType);
    }
    expect(source).toContain("mutationAppliedEvent");
  });
});
