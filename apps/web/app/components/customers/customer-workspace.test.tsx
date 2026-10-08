import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadWorkspace() {
  const modulePath = "./customer-workspace";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const customers = [
  { id: "1", name: "Ama Mensah", phone: "0240000000", email: null, creditLimitMinor: 5000, creditTermsDays: 30, balanceMinor: 1000, availableCreditMinor: 4000, creditEnabled: true, active: true, createdAt: "2026-10-08T08:00:00.000Z", updatedAt: "2026-10-08T09:00:00.000Z" },
  { id: "2", name: "Kojo Trading", phone: null, email: "kojo@example.com", creditLimitMinor: null, creditTermsDays: 0, balanceMinor: 0, availableCreditMinor: null, creditEnabled: false, active: false, createdAt: "2026-10-07T08:00:00.000Z", updatedAt: "2026-10-07T09:00:00.000Z" },
];

describe("CustomerWorkspace", () => {
  it("filters customer identities by query and lifecycle state", async () => {
    const module = await loadWorkspace();
    expect(module?.filterCustomers).toBeTypeOf("function");
    if (!module?.filterCustomers) return;
    expect(module.filterCustomers(customers, "ama", "ALL").map((item: { id: string }) => item.id)).toEqual(["1"]);
    expect(module.filterCustomers(customers, "kojo@example", "ARCHIVED").map((item: { id: string }) => item.id)).toEqual(["2"]);
    expect(module.filterCustomers(customers, "", "ACTIVE").map((item: { id: string }) => item.id)).toEqual(["1"]);
  });

  it("shows create actions only to customer-write roles", async () => {
    const module = await loadWorkspace();
    expect(module?.CustomerWorkspace).toBeTypeOf("function");
    if (!module?.CustomerWorkspace) return;
    const base = { businessId: "business-1", branchId: "branch-1", currencyCode: "GHS" };
    const cashier = renderToStaticMarkup(React.createElement(module.CustomerWorkspace, { ...base, role: "CASHIER" }));
    const viewer = renderToStaticMarkup(React.createElement(module.CustomerWorkspace, { ...base, role: "VIEWER" }));
    expect(cashier).toContain("Add customer");
    expect(viewer).not.toContain("Add customer");
  });

  it("integrates search, inactive badges, customer sheet, financial refresh events and mobile-safe controls", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const workspacePath = path.join(root, "customer-workspace.tsx");
    expect(fs.existsSync(workspacePath)).toBe(true);
    if (!fs.existsSync(workspacePath)) return;
    const source = fs.readFileSync(workspacePath, "utf8");
    expect(source).toContain("CustomerSheet");
    expect(source).toContain("customersChangedEvent");
    expect(source).toContain("mutationAppliedEvent");
    expect(source).toContain("Inactive");
    expect(source).toMatch(/Search customers/i);
    const css = fs.readFileSync(path.resolve(root, "../../customers-credit.css"), "utf8");
    expect(css).toMatch(/customer-commandbar[\s\S]*min-height:\s*48px/);
  });
});
