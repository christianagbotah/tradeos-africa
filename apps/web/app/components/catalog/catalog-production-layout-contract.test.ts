import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const catalog = readFileSync(resolve(__dirname, "catalog-item-sheet.tsx"), "utf8");
const supplier = readFileSync(resolve(__dirname, "../purchases/supplier-sheet.tsx"), "utf8");
const cashbook = readFileSync(resolve(__dirname, "../cashbook/cashbook-expenses.tsx"), "utf8");
const treasury = readFileSync(resolve(__dirname, "../treasury/money-account-sheet.tsx"), "utf8");
const css = readFileSync(resolve(root, "app/workspace-shell.css"), "utf8");

describe("production form density and copy", () => {
  it("keeps related catalog unit fields in one three-column desktop row", () => {
    expect(catalog).toContain('className="tos-form-grid tos-form-grid--3 tos-catalog-unit-grid"');
    expect(catalog).toContain('className="tos-catalog-conversion-grid"');
    expect(css).toMatch(/\.tos-form-grid--3\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.tos-form-grid--3[\s\S]*?grid-template-columns:\s*1fr/s);
  });

  it("gives the empty conversion hint deliberate spacing", () => {
    expect(catalog).toContain('className="tos-section__sub tos-catalog-empty-hint"');
    expect(css).toMatch(/\.tos-catalog-empty-hint\s*\{[^}]*margin:/s);
  });

  it("uses the same desktop density for related supplier, cashbook and treasury fields", () => {
    expect(supplier).toContain('className="tos-form-grid tos-form-grid--3"');
    expect(cashbook).toContain('className="tos-form-grid tos-form-grid--3"');
    expect(treasury).toContain('className="tos-form-grid tos-form-grid--3"');
  });

  it("does not show implementation-language copy in the affected production screens", () => {
    for (const source of [catalog, supplier, cashbook, treasury]) {
      expect(source).not.toContain("server-authoritative");
      expect(source).not.toContain("never the client");
      expect(source).not.toContain("The client");
    }
  });
});
