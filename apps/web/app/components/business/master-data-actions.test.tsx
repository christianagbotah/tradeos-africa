import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadActions() {
  const modulePath = "./master-data-actions";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const noop = () => undefined;

describe("shared master-data lifecycle actions", () => {
  it("renders role-safe edit/archive/reactivate actions without owning entity forms", async () => {
    const module = await loadActions();
    expect(module?.MasterDataActions).toBeTypeOf("function");
    if (!module?.MasterDataActions) return;
    const active = renderToStaticMarkup(<module.MasterDataActions entityLabel="supplier" active canEdit canChangeStatus onEdit={noop} onToggleStatus={noop} />);
    expect(active).toContain("Edit supplier");
    expect(active).toContain("Archive supplier");
    const inactive = renderToStaticMarkup(<module.MasterDataActions entityLabel="supplier" active={false} canEdit canChangeStatus onEdit={noop} onToggleStatus={noop} />);
    expect(inactive).toContain("Reactivate supplier");
    expect(inactive).not.toContain("Archive supplier");
    const viewer = renderToStaticMarkup(<module.MasterDataActions entityLabel="supplier" active canEdit={false} canChangeStatus={false} onToggleStatus={noop} />);
    expect(viewer).not.toContain("Edit supplier");
    expect(viewer).not.toContain("Archive supplier");
  });

  it("supports deactivate language where archive semantics are inappropriate", async () => {
    const module = await loadActions();
    expect(module?.MasterDataActions).toBeTypeOf("function");
    if (!module?.MasterDataActions) return;
    const html = renderToStaticMarkup(<module.MasterDataActions entityLabel="account" active canChangeStatus lifecycleVerb="deactivate" onToggleStatus={noop} />);
    expect(html).toContain("Deactivate account");
  });

  it("maps shared lifecycle failures to business-readable guidance", async () => {
    const module = await loadActions();
    expect(module?.masterDataLifecycleMessage).toBeTypeOf("function");
    if (!module?.masterDataLifecycleMessage) return;
    expect(module.masterDataLifecycleMessage("STALE_VERSION", "supplier")).toMatch(/changed|latest|refresh|reload/i);
    expect(module.masterDataLifecycleMessage("ACCOUNT_IS_DEFAULT", "account")).toMatch(/default|replace/i);
    expect(module.masterDataLifecycleMessage("CUSTOMER_INACTIVE", "customer")).toMatch(/inactive|reactivate/i);
  });

  it("uses accessible named confirmations, restores focus, and is wired across all lifecycle surfaces", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const component = path.join(root, "components", "business", "master-data-actions.tsx");
    expect(fs.existsSync(component)).toBe(true);
    if (!fs.existsSync(component)) return;
    const source = fs.readFileSync(component, "utf8");
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain("aria-label");
    expect(source).toMatch(/focus\(/);
    expect(source).toMatch(/trigger.*Ref|previous.*focus/i);
    for (const file of [
      "components/customers/customer-sheet.tsx",
      "components/suppliers/supplier-sheet.tsx",
      "components/cashbook/expense-category-card.tsx",
      "components/treasury/money-account-sheet.tsx",
    ]) expect(fs.readFileSync(path.join(root, file), "utf8")).toContain("MasterDataActions");
    expect(fs.readFileSync(path.join(root, "layout.tsx"), "utf8")).toContain('import "./master-data.css"');
    const css = fs.readdirSync(root).filter((name) => name.endsWith(".css")).map((name) => fs.readFileSync(path.join(root, name), "utf8")).join("\n");
    expect(css).toMatch(/master-data-actions[\s\S]*min-height:\s*48px/);
  });
});
