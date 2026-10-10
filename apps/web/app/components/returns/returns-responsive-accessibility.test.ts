import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("returns responsive and accessibility hardening", () => {
  it("recovers keyboard focus into both modal sheets if DOM changes leave focus outside", () => {
    const returnSheet = read("components/returns/return-refund-sheet.tsx");
    const exchangeSheet = read("components/returns/exchange-sheet.tsx");
    expect(returnSheet).toMatch(/!sheetRef\.current\.contains\(document\.activeElement\)/);
    expect(exchangeSheet).toMatch(/!sheetRef\.current\.contains\(document\.activeElement\)/);
    expect(returnSheet).toMatch(/event\.shiftKey \? last : first/);
    expect(exchangeSheet).toMatch(/event\.shiftKey \? last : first/);
  });

  it("gives native correction controls a visible focus ring", () => {
    const css = read("tradeos-app.css");
    expect(css).toMatch(/\.return-refund-sheet\s+:is\(button,input,select\):focus-visible\s*\{[^}]*var\(--tos-focus-ring\)/);
    expect(css).toMatch(/\.exchange-sheet\s+:is\(button,input,select\):focus-visible\s*\{[^}]*var\(--tos-focus-ring\)/);
  });

  it("keeps phone correction actions reachable and uses dedicated mobile sale cards", () => {
    const css = read("tradeos-app.css");
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.return-sale-row--desktop\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.return-sale-row--mobile\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/@media\s*\(max-width:\s*520px\)[\s\S]*?\.return-sheet-footer\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/@media\s*\(max-width:767px\)[\s\S]*?\.exchange-sheet-footer\s*\{[^}]*position:\s*sticky/);
  });

  it("keeps transaction controls touch-safe and browser-prompt free", () => {
    const css = read("tradeos-app.css");
    const sources = [
      read("components/returns/return-refund-workspace.tsx"),
      read("components/returns/return-refund-sheet.tsx"),
      read("components/returns/exchange-sheet.tsx"),
      read("components/sales-returns.tsx"),
    ].join("\n");
    expect(css).toMatch(/\.return-sheet-line input[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/\.exchange-return-line input[\s\S]*min-height:\s*48px/);
    expect(sources).not.toMatch(/\b(?:alert|prompt|confirm)\s*\(/);
  });
});
