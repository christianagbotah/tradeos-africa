import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  try { return await import("./money-account-sheet"); }
  catch { return null; }
}

const account = {
  id: "account-1", branchId: "branch-1", name: "Main Till", method: "CASH", kind: "CASH_DRAWER",
  currencyCode: "GHS", provider: null, referenceLabel: null, active: true, allowNegative: false,
  balanceMinor: 12500, createdAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-08T11:00:00.000Z",
};

const noop = () => undefined;

describe("MoneyAccountSheet", () => {
  it("builds create/edit drafts and preserves the server revision only for edits", async () => {
    const module = await loadSheet();
    expect(module?.moneyAccountDraftFor).toBeTypeOf("function");
    if (!module?.moneyAccountDraftFor) return;
    expect(module.moneyAccountDraftFor(null, "branch-1")).toMatchObject({ accountId: null, expectedUpdatedAt: null, branchId: "branch-1", method: "CASH", kind: "CASH_DRAWER", active: true });
    expect(module.moneyAccountDraftFor(account, "branch-1")).toMatchObject({ accountId: "account-1", expectedUpdatedAt: account.updatedAt, name: "Main Till", active: true });
  });

  it("renders an accessible lifecycle sheet without destructive delete", async () => {
    const module = await loadSheet();
    expect(module?.MoneyAccountSheet).toBeTypeOf("function");
    if (!module?.MoneyAccountSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.MoneyAccountSheet, {
      open: true, businessId: "business-1", branchId: "branch-1", currencyCode: "GHS", role: "OWNER", account,
      onClose: noop, onSaved: noop, onMessage: noop,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Edit Main Till");
    expect(html).toContain("Provider");
    expect(html).toContain("Reference label");
    expect(html).toContain("Deactivate account");
    expect(html).not.toContain("Delete");
  });

  it("maps stale/default-account guards into actionable business guidance", async () => {
    const module = await loadSheet();
    expect(module?.moneyAccountMessage).toBeTypeOf("function");
    if (!module?.moneyAccountMessage) return;
    expect(module.moneyAccountMessage("STALE_VERSION")).toMatch(/changed|latest|refresh/i);
    expect(module.moneyAccountMessage("ACCOUNT_IS_DEFAULT")).toMatch(/default|replacement|before/i);
    expect(module.moneyAccountMessage("OFFLINE_ACCOUNT_CHANGE")).toMatch(/online|connection/i);
  });

  it("pins focus management and revision-aware online writes", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, "money-account-sheet.tsx");
    expect(fs.existsSync(file)).toBe(true);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("navigator.onLine");
    expect(source).toContain("Escape");
    expect(source).toContain("Tab");
    expect(source).toMatch(/focus\(/);
  });

  it("keeps money-account sheet controls phone-sized", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(root, "cashbook.css"), "utf8");
    expect(css).toMatch(/money-account-sheet[\s\S]*min-height:\s*48px/);
  });
});
