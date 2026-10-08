import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./supplier-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const supplier = {
  id: "supplier-1",
  name: "Accra Industrial Supplies",
  phone: "0240000000",
  email: "orders@example.com",
  address: "Tema Industrial Area",
  active: true,
  balanceMinor: 420000,
  paymentTermsDays: 30,
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T09:00:00.000Z",
};

const detail = {
  supplier,
  obligations: [{ id: "o1", purchaseId: "p1", originalMinor: 500000, openMinor: 420000, issuedAt: "2026-10-01T08:00:00.000Z", dueAt: "2026-10-31T08:00:00.000Z" }],
  ledger: [{ id: "l1", branchId: "b1", currencyCode: "GHS", balanceDeltaMinor: 500000, method: "SUPPLIER_CREDIT", sourceType: "PURCHASE", sourceId: "p1", actorStaffId: "staff-1", occurredAt: "2026-10-01T08:00:00.000Z" }],
};

function props(module: NonNullable<Awaited<ReturnType<typeof loadSheet>>>) {
  return {
    mode: "edit" as const,
    supplier,
    detail,
    open: true,
    businessId: "business-1",
    branchId: "branch-1",
    currencyCode: "GHS",
    role: "OWNER",
    onClose: () => undefined,
    onChanged: async () => undefined,
  };
}

describe("SupplierSheet", () => {
  it("preserves the current revision in edit drafts and clears it for new suppliers", async () => {
    const module = await loadSheet();
    expect(module?.supplierDraftFor).toBeTypeOf("function");
    if (!module?.supplierDraftFor) return;
    expect(module.supplierDraftFor("edit", supplier).expectedUpdatedAt).toBe(supplier.updatedAt);
    expect(module.supplierDraftFor("create", null).expectedUpdatedAt).toBeNull();
  });

  it("separates supplier details, payment terms, financial history and status by role", async () => {
    const module = await loadSheet();
    expect(module?.SupplierSheet).toBeTypeOf("function");
    if (!module?.SupplierSheet) return;

    const ownerHtml = renderToStaticMarkup(React.createElement(module.SupplierSheet, props(module)));
    expect(ownerHtml).toContain('role="dialog"');
    expect(ownerHtml).toContain('aria-modal="true"');
    expect(ownerHtml).toContain("Details");
    expect(ownerHtml).toContain("Payment terms");
    expect(ownerHtml).toContain("Payables &amp; history");
    expect(ownerHtml).toContain("Archive supplier");
    expect(ownerHtml).toContain("Pay supplier");

    const inventoryHtml = renderToStaticMarkup(React.createElement(module.SupplierSheet, { ...props(module), role: "INVENTORY" }));
    expect(inventoryHtml).toContain("Details");
    expect(inventoryHtml).not.toContain("Payment terms");
    expect(inventoryHtml).toContain("Archive supplier");
    expect(inventoryHtml).not.toContain("Pay supplier");

    const viewerHtml = renderToStaticMarkup(React.createElement(module.SupplierSheet, { ...props(module), role: "VIEWER" }));
    expect(viewerHtml).toContain("Payables &amp; history");
    expect(viewerHtml).not.toContain("Save changes");
    expect(viewerHtml).not.toContain("Archive supplier");
  });

  it("keeps inactive supplier history visible and exposes reactivation without disabling payable settlement", async () => {
    const module = await loadSheet();
    expect(module?.SupplierSheet).toBeTypeOf("function");
    if (!module?.SupplierSheet) return;
    const inactive = { ...supplier, active: false };
    const html = renderToStaticMarkup(React.createElement(module.SupplierSheet, {
      ...props(module),
      supplier: inactive,
      detail: { ...detail, supplier: inactive },
    }));
    expect(html).toContain("Inactive");
    expect(html).toContain("Reactivate supplier");
    expect(html).toContain("Open payables");
    expect(html).toContain("Pay supplier");
  });

  it("maps stale and online-only lifecycle errors to business-readable guidance", async () => {
    const module = await loadSheet();
    expect(module?.supplierSheetMessage).toBeTypeOf("function");
    if (!module?.supplierSheetMessage) return;
    expect(module.supplierSheetMessage("STALE_VERSION")).toMatch(/changed|latest|refresh/i);
    expect(module.supplierSheetMessage("OFFLINE_STATUS_CHANGE")).toMatch(/connection|online/i);
    expect(module.supplierSheetMessage("SUPPLIER_TERMS_FORBIDDEN")).toMatch(/payment terms|role/i);
  });

  it("pins focus restoration, revision-aware PATCH and existing supplier payment queue", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const sheetPath = path.join(root, "supplier-sheet.tsx");
    expect(fs.existsSync(sheetPath)).toBe(true);
    if (!fs.existsSync(sheetPath)) return;
    const source = fs.readFileSync(sheetPath, "utf8");
    expect(source).toContain("Escape");
    expect(source).toContain("Tab");
    expect(source).toMatch(/focus\(/);
    expect(source).toMatch(/previous.*active|active.*element/i);
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("STALE_VERSION");
    expect(source).toContain("navigator.onLine");
    expect(source).toContain("SUPPLIER_PAYMENT_CREATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
  });

  it("queues supplier profile create/update offline while keeping terms and status online-only", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "supplier-sheet.tsx"), "utf8");
    expect(source).toContain("SUPPLIER_CREATE");
    expect(source).toContain("SUPPLIER_UPDATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("OFFLINE_STATUS_CHANGE");
    expect(source).not.toContain("OFFLINE_PROFILE_EDIT");
  });

  it("keeps sheet controls phone-sized", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "purchases-inventory.css"), "utf8");
    expect(css).toMatch(/supplier-sheet[\s\S]*min-height:\s*48px/);
  });
});
