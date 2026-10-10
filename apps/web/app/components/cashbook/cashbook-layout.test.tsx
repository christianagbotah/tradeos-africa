import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cssPath = path.join(appRoot, "cashbook.css");

function css() {
  expect(fs.existsSync(cssPath)).toBe(true);
  return fs.readFileSync(cssPath, "utf8");
}

describe("Cashbook responsive layout contract", () => {
  it("uses a compact desktop toolbar and four-card summary grid", () => {
    const source = css();
    expect(source).toMatch(/\.cashbook-toolbar\s*\{[\s\S]*grid-template-columns:/);
    expect(source).toMatch(/\.cashbook-stat-grid\s*\{[\s\S]*repeat\(4,/);
  });

  it("uses a two-column form with a full-width description and comfortable controls", () => {
    const source = css();
    expect(source).toMatch(/\.cashbook-form-grid\s*\{[\s\S]*repeat\(2,/);
    expect(source).toMatch(/\.cashbook-form-wide\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
    expect(source).toMatch(/min-height:\s*(44|45|46|47|48)px/);
  });

  it("contains tables locally and collapses forms on mobile without page overflow", () => {
    const source = css();
    expect(source).toMatch(/\.cashbook-table-scroll\s*\{[\s\S]*overflow-x:\s*auto/);
    expect(source).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*\.cashbook-form-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
    expect(source).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*\.cashbook-stat-grid\s*\{[\s\S]*grid-template-columns:/);
  });

  it("imports Cashbook CSS and keeps primary Cashbook composition off generic form-row", () => {
    const layout = fs.readFileSync(path.join(appRoot, "layout.tsx"), "utf8");
    expect(layout).toContain('import "./cashbook.css";');
    const files = ["cashbook-summary.tsx", "cashbook-entry-form.tsx", "expense-category-card.tsx", "cashbook-history.tsx"];
    for (const file of files) {
      const source = fs.readFileSync(path.join(appRoot, "components", "cashbook", file), "utf8");
      expect(source).not.toContain('className="form-row"');
    }
  });

  it("uses canonical TradeOS tokens and 48px controls instead of a private cashbook skin", () => {
    const source = css();
    expect(source).not.toMatch(/--cashbook-(gold|gold-soft|navy|border|muted):/);
    expect(source).toContain("var(--tos-border)");
    expect(source).toContain("var(--tos-text-muted)");
    expect(source).toContain("var(--tos-focus-ring)");
    expect(source).toMatch(/min-height:\s*48px/);
  });

  it("gives Treasury a Cashbook-scoped presentational hook", () => {
    const treasury = fs.readFileSync(path.join(appRoot, "components", "treasury.tsx"), "utf8");
    expect(treasury).toContain('className="treasury-section"');
  });
});
