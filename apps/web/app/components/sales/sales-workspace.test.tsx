import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadWorkspace() {
  const modulePath = "./sales-workspace";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const sales = [
  { id: "11111111-1111-4111-8111-111111111111", status: "COMPLETED", currencyCode: "GHS", totalMinor: 12500, refundTotalMinor: 0, completedAt: "2026-10-08T09:00:00.000Z", createdAt: "2026-10-08T08:59:00.000Z", customer: null, cashierName: "Ama", payments: [{ method: "CASH", amountMinor: 12500, status: "SUCCEEDED" }] },
  { id: "22222222-2222-4222-8222-222222222222", status: "PARTIALLY_REFUNDED", currencyCode: "GHS", totalMinor: 30000, refundTotalMinor: 5000, completedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:59:00.000Z", customer: { name: "Kojo Trading", phone: "0240000000" }, cashierName: "Yaw", payments: [{ method: "MOMO", amountMinor: 30000, status: "PARTIALLY_REVERSED" }] },
];

describe("SalesWorkspace", () => {
  it("filters by receipt/customer query, status, payment and customer type", async () => {
    const module = await loadWorkspace();
    expect(module?.filterSales).toBeTypeOf("function");
    if (!module?.filterSales) return;
    expect(module.filterSales(sales, { query: "kojo", status: "ALL", payment: "ALL", customer: "ALL" }).map((sale: { id: string }) => sale.id)).toEqual([sales[1]!.id]);
    expect(module.filterSales(sales, { query: "", status: "REFUNDED", payment: "ALL", customer: "ALL" }).map((sale: { id: string }) => sale.id)).toEqual([sales[1]!.id]);
    expect(module.filterSales(sales, { query: "", status: "ALL", payment: "CASH", customer: "WALK_IN" }).map((sale: { id: string }) => sale.id)).toEqual([sales[0]!.id]);
  });

  it("renders a professional receipt workspace and hides correction actions when permission is absent", async () => {
    const module = await loadWorkspace();
    expect(module?.SalesWorkspace).toBeTypeOf("function");
    if (!module?.SalesWorkspace) return;
    const base = { sales, selectedId: null, loading: false, onSelect: () => undefined, onSearch: () => undefined };
    const allowed = renderToStaticMarkup(React.createElement(module.SalesWorkspace, { ...base, canProcessReturns: true }));
    const readonly = renderToStaticMarkup(React.createElement(module.SalesWorkspace, { ...base, canProcessReturns: false }));
    for (const label of ["Search sales", "Status", "Payment", "Customer", "Walk-in customer", "Kojo Trading"]) expect(allowed).toContain(label);
    expect(allowed).toContain("Process return / refund");
    expect(readonly).not.toContain("Process return / refund");
  });

  it("keeps command controls phone-sized and desktop filters in one command surface", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readdirSync(appRoot).filter((name) => name.endsWith(".css")).map((name) => fs.readFileSync(path.join(appRoot, name), "utf8")).join("\n");
    expect(css).toMatch(/sales-commandbar[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/sales-commandbar[\s\S]*font-size:\s*15px/);
    expect(css).toMatch(/grid-template-columns:[^;]*(?:minmax|auto)/);
  });
});

// Task 6: mobile record-card + command-bar + state-panel contracts
describe("Sales design-system and mobile contracts", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

  it("uses the shared CommandBar primitive for the sales command row", () => {
    const ws = read("sales-workspace.tsx");
    expect(ws).toContain("CommandBar");
  });

  it("uses MobileRecordCard for mobile sales rows rather than relying solely on the desktop table", () => {
    const ws = read("sales-workspace.tsx");
    expect(ws).toContain("MobileRecordCard");
  });

  it("keeps the posted sale evidence immutable (no edit/delete affordance in the detail sheet)", () => {
    const sheet = read("sale-detail-sheet.tsx");
    expect(sheet).not.toContain("Save changes");
    expect(sheet).not.toContain("Delete sale");
    expect(sheet).not.toContain("Edit sale");
    expect(sheet).toMatch(/Posted receipt|read only/i);
  });

  it("uses an accessible status region for offline/cached/error messages", () => {
    const orchestrator = read("../sales-returns.tsx");
    expect(orchestrator).toContain('role="status"');
  });
});
