import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadWorkspace() {
  const modulePath = "./return-refund-workspace";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const sales = [
  { id: "11111111-1111-4111-8111-111111111111", status: "COMPLETED", currencyCode: "GHS", totalMinor: 12500, refundTotalMinor: 0, completedAt: "2026-10-08T09:00:00.000Z", createdAt: "2026-10-08T08:59:00.000Z", customer: null, cashierName: "Ama", payments: [{ method: "CASH", amountMinor: 12500, status: "SUCCEEDED" }] },
  { id: "22222222-2222-4222-8222-222222222222", status: "PARTIALLY_REFUNDED", currencyCode: "GHS", totalMinor: 30000, refundTotalMinor: 5000, completedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:59:00.000Z", customer: { name: "Kojo Trading", phone: "0240000000" }, cashierName: "Yaw", payments: [{ method: "MOMO", amountMinor: 30000, status: "PARTIALLY_REVERSED" }] },
];

describe("ReturnRefundWorkspace", () => {
  it("renders only real sale-backed return candidates and professional search controls", async () => {
    const module = await loadWorkspace();
    expect(module?.ReturnRefundWorkspace).toBeTypeOf("function");
    if (!module?.ReturnRefundWorkspace) return;
    const html = renderToStaticMarkup(React.createElement(module.ReturnRefundWorkspace, { sales, selectedId: null, loading: false, onSelect: () => undefined, onSearch: () => undefined }));
    expect(html).toContain("Find original sale");
    expect(html).toContain("Walk-in customer");
    expect(html).toContain("Kojo Trading");
    expect(html).toContain("PARTIALLY REFUNDED");
    expect(html).not.toContain("Example original sale");
  });

  it("uses the canonical Z.ai list primitives for desktop, mobile and state feedback", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const source = fs.readFileSync(path.join(appRoot, "components", "returns", "return-refund-workspace.tsx"), "utf8");
    for (const contract of ["CommandBar", "MobileRecordCard", "StatePanel", "StatusBadge"]) expect(source).toContain(contract);
    expect(source).toContain("return-sale-row--desktop");
    expect(source).toContain("return-sale-row--mobile");
  });

  it("requires the obsolete static ReturnsPanel to be retired and deep-link loading to exist", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    expect(fs.existsSync(path.join(appRoot, "components", "returns-panel.tsx"))).toBe(false);
    const coordinator = fs.readFileSync(path.join(appRoot, "components", "sales-returns.tsx"), "utf8");
    expect(coordinator).toContain("URLSearchParams");
    expect(coordinator).toContain('get("saleId")');
  });

  it("keeps legacy return presentation out of the Sales stylesheet", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const salesCss = fs.readFileSync(path.join(appRoot, "sales-returns.css"), "utf8");
    for (const obsolete of [".return-detail", ".returnable-line", ".refund-controls", ".return-action-bar", ".sales-return-grid"]) expect(salesCss).not.toContain(obsolete);
  });

  it("uses 48px, 15px return search/action controls", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "returns.css"), "utf8");
    expect(css).toMatch(/return-commandbar[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/return-commandbar[\s\S]*font-size:\s*15px/);
  });
});
