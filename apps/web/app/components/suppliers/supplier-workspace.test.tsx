import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadWorkspace() {
  const modulePath = "./supplier-workspace";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const suppliers = [
  { id: "s1", name: "Accra Supplies", phone: "0240000000", email: null, address: null, active: true, balanceMinor: 120000, paymentTermsDays: 30, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" },
  { id: "s2", name: "Tema Wholesale", phone: null, email: "tema@example.com", address: null, active: false, balanceMinor: 0, paymentTermsDays: 14, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z" },
];

describe("SupplierWorkspace", () => {
  it("filters supplier identities by query and lifecycle state without hiding archived history", async () => {
    const module = await loadWorkspace();
    expect(module?.filterSuppliers).toBeTypeOf("function");
    if (!module?.filterSuppliers) return;
    expect(module.filterSuppliers(suppliers, "ACTIVE", "").map((supplier: { id: string }) => supplier.id)).toEqual(["s1"]);
    expect(module.filterSuppliers(suppliers, "ARCHIVED", "").map((supplier: { id: string }) => supplier.id)).toEqual(["s2"]);
    expect(module.filterSuppliers(suppliers, "ALL", "tema").map((supplier: { id: string }) => supplier.id)).toEqual(["s2"]);
  });

  it("renders a professional role-aware supplier management surface", async () => {
    const module = await loadWorkspace();
    expect(module?.SupplierWorkspace).toBeTypeOf("function");
    if (!module?.SupplierWorkspace) return;
    const html = renderToStaticMarkup(React.createElement(module.SupplierWorkspace, {
      businessId: "b1",
      branchId: "br1",
      currencyCode: "GHS",
      role: "OWNER",
      suppliers,
      onRefresh: async () => undefined,
    }));
    expect(html).toContain("Search suppliers");
    expect(html).toContain("Active");
    expect(html).toContain("Archived");
    expect(html).toContain("Add supplier");
    expect(html).toContain("Accra Supplies");
  });

  it("uses canonical Z.ai command, mobile-record, state and status primitives", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "supplier-workspace.tsx"), "utf8");
    for (const contract of ["CommandBar", "MobileRecordCard", "StatePanel", "StatusBadge"]) expect(source).toContain(contract);
    expect(source).toContain("supplier-row--desktop");
    expect(source).toContain("supplier-row--mobile");
  });

  it("refreshes on supplier profile sync and surfaces failed master-data conflicts", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "supplier-workspace.tsx"), "utf8");
    expect(source).toContain("mutationAppliedEvent");
    expect(source).toContain("queueChangedEvent");
    expect(source).toContain("getFailedMutations");
    expect(source).toContain("SUPPLIER_CREATE");
    expect(source).toContain("SUPPLIER_UPDATE");
  });

  it("integrates into Purchases while keeping inactive suppliers out of receiving and removing inline terms editor", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const source = fs.readFileSync(path.join(appRoot, "components", "purchases-inventory.tsx"), "utf8");
    expect(source).toContain("SupplierWorkspace");
    expect(source).toMatch(/suppliers\.filter\(\(supplier\) => supplier\.active\)/);
    expect(source).not.toContain("function SupplierTerms");
    expect(source).not.toContain("supplier-terms-inline");
  });
});
