import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadModule() {
  try { return await import("./expense-category-card"); }
  catch { return null; }
}

const categories = [
  { id: "fuel", name: "Vehicle fuel", active: true, system: false, createdAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-08T11:00:00.000Z" },
  { id: "utilities", name: "Utilities", active: true, system: true, createdAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-08T11:00:00.000Z" },
  { id: "old", name: "Old category", active: false, system: false, createdAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-08T11:00:00.000Z" },
];

const noop = () => undefined;

describe("expense category lifecycle management", () => {
  it("renders active, archived and system context with role-safe management actions", async () => {
    const module = await loadModule();
    expect(module?.ExpenseCategoryCard).toBeTypeOf("function");
    if (!module?.ExpenseCategoryCard) return;
    const owner = renderToStaticMarkup(React.createElement(module.ExpenseCategoryCard, {
      businessId: "business-1", role: "OWNER", categories, onChanged: noop, onMessage: noop,
    }));
    expect(owner).toContain("Manage categories");
    expect(owner).toContain("Vehicle fuel");
    expect(owner).toContain("Old category");
    expect(owner).toContain("System");
    expect(owner).toContain("Archived");
    expect(owner).toContain("Add category");
    expect(owner).toContain("Edit");

    const viewer = renderToStaticMarkup(React.createElement(module.ExpenseCategoryCard, {
      businessId: "business-1", role: "VIEWER", categories, onChanged: noop, onMessage: noop,
    }));
    expect(viewer).not.toContain("Add category");
    expect(viewer).not.toContain(">Edit<");
  });

  it("builds revision-aware create/edit drafts and business-readable stale guidance", async () => {
    const module = await loadModule();
    expect(module?.expenseCategoryDraftFor).toBeTypeOf("function");
    expect(module?.expenseCategoryMessage).toBeTypeOf("function");
    if (!module?.expenseCategoryDraftFor || !module.expenseCategoryMessage) return;
    expect(module.expenseCategoryDraftFor(null)).toEqual({ categoryId: null, expectedUpdatedAt: null, name: "", active: true });
    expect(module.expenseCategoryDraftFor(categories[0]!)).toMatchObject({ categoryId: "fuel", expectedUpdatedAt: categories[0]!.updatedAt, name: "Vehicle fuel", active: true });
    expect(module.expenseCategoryMessage("STALE_VERSION")).toMatch(/changed|latest|refresh/i);
    expect(module.expenseCategoryMessage("OFFLINE_CATEGORY_CHANGE")).toMatch(/online|connection/i);
  });

  it("renders an accessible edit sheet with status controls and immutable system origin", async () => {
    const module = await loadModule();
    expect(module?.ExpenseCategorySheet).toBeTypeOf("function");
    if (!module?.ExpenseCategorySheet) return;
    const html = renderToStaticMarkup(React.createElement(module.ExpenseCategorySheet, {
      open: true, businessId: "business-1", category: categories[1]!, role: "OWNER", onClose: noop, onSaved: noop, onMessage: noop,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Edit Utilities");
    expect(html).toContain("System category");
    expect(html).toContain("Archive category");
    expect(html).not.toContain("Delete");
  });

  it("pins focus handling, revision submission and online-only lifecycle truth", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "expense-category-card.tsx"), "utf8");
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("navigator.onLine");
    expect(source).toContain("Escape");
    expect(source).toContain("Tab");
    expect(source).toMatch(/focus\(/);
    expect(source).toMatch(/previous.*active|active.*element/i);
  });

  it("keeps category sheet controls phone-sized", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(root, "tradeos-app.css"), "utf8");
    expect(css).toMatch(/expense-category-sheet[\s\S]*min-height:\s*48px/);
  });
});
