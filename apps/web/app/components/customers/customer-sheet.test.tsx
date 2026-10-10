import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./customer-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const detail = {
  customer: {
    id: "customer-1", name: "Ama Mensah", phone: "0240000000", email: "ama@example.com",
    creditLimitMinor: 50000, creditTermsDays: 30, balanceMinor: 12000, availableCreditMinor: 38000,
    creditEnabled: true, active: true,
    createdAt: "2026-10-08T08:00:00.000Z", updatedAt: "2026-10-08T09:00:00.123Z",
  },
  obligations: [{ id: "ob-1", saleId: "sale-12345678", originalMinor: 12000, openMinor: 12000, issuedAt: "2026-10-01T08:00:00.000Z", dueAt: "2026-10-31T08:00:00.000Z" }],
  ledger: [{ id: "led-1", branchId: "branch-1", currencyCode: "GHS", entryType: "CREDIT_SALE", balanceDeltaMinor: 12000, sourceType: "SALE", sourceId: "sale-1", actorName: "Cashier", occurredAt: "2026-10-01T08:00:00.000Z" }],
};

function props(module: NonNullable<Awaited<ReturnType<typeof loadSheet>>>, role = "OWNER", customerDetail = detail) {
  return {
    mode: "edit" as const, detail: customerDetail, open: true, businessId: "business-1", branchId: "branch-1",
    currencyCode: "GHS", role, onClose: () => undefined, onSaved: async () => undefined,
  } satisfies React.ComponentProps<typeof module.CustomerSheet>;
}

describe("CustomerSheet", () => {
  it("preserves the current revision in edit drafts and clears it for new customers", async () => {
    const module = await loadSheet();
    expect(module?.customerDraftFor).toBeTypeOf("function");
    if (!module?.customerDraftFor) return;
    expect(module.customerDraftFor("edit", detail, "GHS").expectedUpdatedAt).toBe(detail.customer.updatedAt);
    expect(module.customerDraftFor("create", null, "GHS").expectedUpdatedAt).toBeNull();
  });

  it("separates profile, credit and immutable financial history while hiding unauthorized credit controls", async () => {
    const module = await loadSheet();
    expect(module?.CustomerSheet).toBeTypeOf("function");
    if (!module?.CustomerSheet) return;

    const ownerHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, props(module)));
    expect(ownerHtml).toContain('role="dialog"');
    expect(ownerHtml).toContain('aria-modal="true"');
    expect(ownerHtml).toContain("Profile");
    expect(ownerHtml).toContain("Credit &amp; terms");
    expect(ownerHtml).toContain("Open credit obligations");
    expect(ownerHtml).toContain("Account ledger");
    expect(ownerHtml).toContain("Update credit settings");

    const cashierHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, props(module, "CASHIER")));
    expect(cashierHtml).toContain("Save profile");
    expect(cashierHtml).not.toContain("Update credit settings");
    expect(cashierHtml).toContain("Open credit obligations");

    const viewerHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, props(module, "VIEWER")));
    expect(viewerHtml).not.toContain("Save profile");
    expect(viewerHtml).not.toContain("Update credit settings");
  });

  it("preserves credit setup during authorized customer creation", async () => {
    const module = await loadSheet();
    expect(module?.CustomerSheet).toBeTypeOf("function");
    if (!module?.CustomerSheet) return;
    const createProps = { ...props(module), mode: "create" as const, detail: null };
    const ownerHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, createProps));
    expect(ownerHtml).toContain("Credit &amp; terms");
    expect(ownerHtml).toContain("Save customer");
    const cashierHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, { ...createProps, role: "CASHIER" }));
    expect(cashierHtml).not.toContain("Credit &amp; terms");
  });

  it("shows inactive status and reactivation only to credit-control roles, while pausing new payments", async () => {
    const module = await loadSheet();
    expect(module?.CustomerSheet).toBeTypeOf("function");
    if (!module?.CustomerSheet) return;
    const inactive = { ...detail, customer: { ...detail.customer, active: false } };
    const ownerHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, props(module, "OWNER", inactive)));
    expect(ownerHtml).toContain("Inactive");
    expect(ownerHtml).toContain("Reactivate customer");
    expect(ownerHtml).toMatch(/payments? (?:are )?paused|reactivate.*payment/i);
    expect(ownerHtml).not.toContain("Receive payment</button>");
    const cashierHtml = renderToStaticMarkup(React.createElement(module.CustomerSheet, props(module, "CASHIER", inactive)));
    expect(cashierHtml).not.toContain("Reactivate customer");
  });

  it("maps stale and online-only lifecycle errors to business-readable guidance", async () => {
    const module = await loadSheet();
    expect(module?.customerSheetMessage).toBeTypeOf("function");
    if (!module?.customerSheetMessage) return;
    expect(module.customerSheetMessage("STALE_VERSION")).toMatch(/changed|latest|reload|refresh/i);
    expect(module.customerSheetMessage("OFFLINE_CREDIT_CONTROL")).toMatch(/online|connection/i);
  });

  it("pins focus handling, revision-aware updates and truthful offline profile queueing", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const sheetPath = path.join(root, "customer-sheet.tsx");
    expect(fs.existsSync(sheetPath)).toBe(true);
    if (!fs.existsSync(sheetPath)) return;
    const source = fs.readFileSync(sheetPath, "utf8");
    expect(source).toContain("Escape");
    expect(source).toContain("Tab");
    expect(source).toMatch(/focus\(/);
    expect(source).toMatch(/previous.*active|active.*element/i);
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("CUSTOMER_UPDATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("navigator.onLine");
    expect(source).toContain("masterDataLifecycleMessage");
  });

  it("supports durable offline customer profile create/update while keeping credit and status online-only", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "customer-sheet.tsx"), "utf8");
    expect(source).toContain("CUSTOMER_CREATE");
    expect(source).toContain("CUSTOMER_UPDATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("OFFLINE_CREDIT_CONTROL");
    expect(source).not.toContain("sync gate is enabled");
  });

  it("keeps customer sheet controls phone-sized", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "customers-credit.css"), "utf8");
    expect(css).toMatch(/customer-sheet[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/customer-sheet[\s\S]*font-size:\s*15px/);
  });
});
