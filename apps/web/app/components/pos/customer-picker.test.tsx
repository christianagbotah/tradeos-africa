import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const customers = [
  {
    id: "ama",
    name: "Ama Mensah",
    phone: "0240000000",
    email: "ama@example.com",
    creditLimitMinor: 50000,
    creditTermsDays: 30,
    balanceMinor: 15000,
    availableCreditMinor: 35000,
    creditEnabled: true,
    active: true,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
  },
  {
    id: "kojo",
    name: "Kojo Hardware",
    phone: "0201112222",
    email: null,
    creditLimitMinor: null,
    creditTermsDays: 0,
    balanceMinor: 0,
    availableCreditMinor: null,
    creditEnabled: false,
    active: true,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
  },
  {
    id: "archived",
    name: "Archived Customer",
    phone: "0559999999",
    email: "old@example.com",
    creditLimitMinor: null,
    creditTermsDays: 0,
    balanceMinor: 0,
    availableCreditMinor: null,
    creditEnabled: false,
    active: false,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
  },
];

async function loadPicker() {
  const modulePath = "./customer-picker";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch { return null; }
}

describe("POS CustomerPicker", () => {
  it("defaults visibly to Walk-in and keeps customer choice independent of payment method", async () => {
    const module = await loadPicker();
    expect(module?.CustomerPicker).toBeTypeOf("function");
    if (!module?.CustomerPicker) return;
    const html = renderToStaticMarkup(React.createElement(module.CustomerPicker, {
      businessId: "b1",
      currencyCode: "GHS",
      selectedCustomer: null,
      role: "CASHIER",
      open: true,
      initialCustomers: customers,
      onSelect: () => undefined,
      onWalkIn: () => undefined,
      onClose: () => undefined,
    }));
    expect(html).toContain("Walk-in customer");
    expect(html).toContain("Selected by default");
    expect(html).not.toContain("paymentMethod");
  });

  it("searches active customers by name, phone and email and never returns archived customers", async () => {
    const module = await loadPicker();
    expect(module?.filterPosCustomers).toBeTypeOf("function");
    if (!module?.filterPosCustomers) return;
    expect(module.filterPosCustomers(customers, "ama").map((customer: { id: string }) => customer.id)).toEqual(["ama"]);
    expect(module.filterPosCustomers(customers, "020111").map((customer: { id: string }) => customer.id)).toEqual(["kojo"]);
    expect(module.filterPosCustomers(customers, "example.com").map((customer: { id: string }) => customer.id)).toEqual(["ama"]);
    expect(module.filterPosCustomers(customers, "archived")).toEqual([]);
    expect(module.filterPosCustomers(customers, "").map((customer: { id: string }) => customer.id)).toEqual(["ama", "kojo"]);
  });

  it("shows credit context without requiring credit to select a normal cash customer", async () => {
    const module = await loadPicker();
    expect(module?.customerCreditContext).toBeTypeOf("function");
    if (!module?.customerCreditContext) return;
    expect(module.customerCreditContext(customers[0], "GHS")).toMatch(/available/i);
    expect(module.customerCreditContext(customers[1], "GHS")).toMatch(/credit.*off/i);
  });

  it("shows Add customer only to existing customer-write roles", async () => {
    const module = await loadPicker();
    expect(module?.canCreateCustomerFromPos).toBeTypeOf("function");
    if (!module?.canCreateCustomerFromPos) return;
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"]) {
      expect(module.canCreateCustomerFromPos(role)).toBe(true);
    }
    for (const role of ["INVENTORY", "STAFF", "VIEWER", "UNKNOWN"]) {
      expect(module.canCreateCustomerFromPos(role)).toBe(false);
    }
  });

  it("pins accessible sheet focus, Escape, Tab containment and trigger restoration", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const componentPath = path.join(root, "customer-picker.tsx");
    expect(fs.existsSync(componentPath)).toBe(true);
    if (!fs.existsSync(componentPath)) return;
    const source = fs.readFileSync(componentPath, "utf8");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("searchRef.current?.focus()");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key === "Tab"');
    expect(source).toContain("restoreFocusRef.current?.focus()");
    expect(source).toContain("limit: \"200\"");
  });

  it("pins professional phone touch targets for picker controls", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.join(root, "../../pos.css");
    expect(fs.existsSync(cssPath)).toBe(true);
    if (!fs.existsSync(cssPath)) return;
    const source = fs.readFileSync(cssPath, "utf8");
    expect(source).toMatch(/\.pos-customer-picker[\s\S]*min-height:\s*48px/);
    expect(source).toContain("env(safe-area-inset-bottom)");
  });
});
