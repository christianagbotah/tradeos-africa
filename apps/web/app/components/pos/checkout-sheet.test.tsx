import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CartLine } from "./pos-model";

const cart: CartLine[] = [
  { key: "malt:bottle", itemId: "malt", name: "Malt", saleUnitCode: "bottle", saleUnitLabel: "Bottle", priceMinor: 1200, quantity: 2.5 },
  { key: "haircut:service", itemId: "haircut", name: "Haircut", saleUnitCode: "service", saleUnitLabel: "Service", priceMinor: 3500, quantity: 1 },
];

const namedCustomer = {
  id: "ama",
  name: "Ama Mensah",
  phone: "0240000000",
  email: null,
  creditLimitMinor: 100000,
  creditTermsDays: 30,
  balanceMinor: 10000,
  availableCreditMinor: 90000,
  creditEnabled: true,
  active: true,
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T09:00:00.000Z",
};

async function loadCheckout() {
  const modulePath = "./checkout-sheet";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch { return null; }
}

describe("professional POS checkout", () => {
  it("builds exact server-authoritative SALE_CREATE lines and attaches named customer to immediate payment", async () => {
    const module = await loadCheckout();
    expect(module?.buildSaleMutation).toBeTypeOf("function");
    if (!module?.buildSaleMutation) return;
    const mutation = module.buildSaleMutation({
      clientId: "web-device",
      clientMutationId: "sale-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS",
      cart,
      customer: namedCustomer,
      paymentMethod: "MOMO",
      occurredAt: "2026-10-08T10:00:00.000Z",
    });
    expect(mutation.mutationType).toBe("SALE_CREATE");
    expect(mutation.payload).toEqual({
      currencyCode: "GHS",
      customerId: "ama",
      paymentMethod: "MOMO",
      lines: [
        { itemId: "malt", saleUnitCode: "bottle", quantity: 2.5 },
        { itemId: "haircut", saleUnitCode: "service", quantity: 1 },
      ],
    });
    expect(JSON.stringify(mutation.payload)).not.toContain("priceMinor");
  });

  it("omits customerId for Walk-in sales", async () => {
    const module = await loadCheckout();
    expect(module?.buildSaleMutation).toBeTypeOf("function");
    if (!module?.buildSaleMutation) return;
    const mutation = module.buildSaleMutation({
      clientId: "web-device",
      clientMutationId: "sale-2",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS",
      cart,
      customer: null,
      paymentMethod: "CASH",
      occurredAt: "2026-10-08T10:00:00.000Z",
    });
    expect(mutation.payload.customerId).toBeUndefined();
  });

  it("guards Customer Credit with named active customer, credit enablement and available amount", async () => {
    const module = await loadCheckout();
    expect(module?.customerCreditReadiness).toBeTypeOf("function");
    if (!module?.customerCreditReadiness) return;
    expect(module.customerCreditReadiness(null, 5000)).toMatchObject({ allowed: false });
    expect(module.customerCreditReadiness({ ...namedCustomer, creditEnabled: false }, 5000)).toMatchObject({ allowed: false });
    expect(module.customerCreditReadiness({ ...namedCustomer, availableCreditMinor: 4000 }, 5000)).toMatchObject({ allowed: false });
    expect(module.customerCreditReadiness(namedCustomer, 5000)).toMatchObject({ allowed: true });
  });

  it("renders every supported payment method and readable credit guidance", async () => {
    const module = await loadCheckout();
    expect(module?.CheckoutSheet).toBeTypeOf("function");
    if (!module?.CheckoutSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.CheckoutSheet, {
      open: true,
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS",
      cart,
      customer: namedCustomer,
      onClose: () => undefined,
      onDurablySaved: () => undefined,
      onStatus: () => undefined,
    }));
    for (const label of ["Cash", "MoMo", "Card", "Bank", "Other", "Customer Credit"]) expect(html).toContain(label);
    expect(html).toContain("Ama Mensah");
    expect(html).toContain("Charge");
  });

  it("pins durable enqueue before cart-clear callback and distinguishes pending/rejected sync", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, "checkout-sheet.tsx");
    expect(fs.existsSync(file)).toBe(true);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("onDurablySaved");
    expect(source.indexOf("enqueueMutation")).toBeLessThan(source.indexOf("onDurablySaved"));
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("getFailedMutations");
    expect(source).toContain("Saved offline · pending sync");
    expect(source).toMatch(/needs review/i);
    expect(source).not.toContain("unitPriceMinor");
  });

  it("pins accessible sheet semantics and phone-safe payment controls", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, "checkout-sheet.tsx");
    expect(fs.existsSync(file)).toBe(true);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('event.key === "Escape"');
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
    expect(css).toMatch(/\.pos-payment-option[\s\S]*min-height:\s*48px/);
    expect(css).toContain(".pos-checkout-sheet");
  });

  it("moves initial focus into checkout and restores to an explicit surviving trigger", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "checkout-sheet.tsx"), "utf8");
    expect(source).toContain("returnFocusRef");
    expect(source).toContain("initialTabbables");
    expect(source).toMatch(/initialTabbables\[0\]\?\.focus\(\)/);
    expect(source).toMatch(/returnFocusRef\?\.current/);
  });

});
