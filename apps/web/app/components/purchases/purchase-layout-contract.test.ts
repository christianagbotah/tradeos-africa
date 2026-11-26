import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const builder = readFileSync(fileURLToPath(
  new URL("./purchase-receipt-builder.tsx", import.meta.url)), "utf8");
const detail = readFileSync(fileURLToPath(
  new URL("./purchase-detail-sheet.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(
  new URL("../../workspace-shell.css", import.meta.url)), "utf8");

describe("purchase receiving and preview presentation", () => {
  it("uses one stable horizontal row for item, unit, quantity, cost, total and remove", () => {
    expect(builder).toContain('className="tos-receipt-lines-viewport"');
    expect(builder).toContain('className="tos-receipt-lines-grid"');
    expect(builder).toContain('className="tos-receipt-line__item"');
    expect(builder).toContain('className="tos-receipt-line__unit"');
    expect(builder).not.toContain('className="tos-receipt-line__item tos-stack"');
    expect(builder).toContain('disabled={!canWrite || !selected || Boolean(purchaseOrderId)}');
    expect(builder).toContain('aria-label={`Line ${idx + 1} purchase unit`}');
    const rowStyle = css.slice(css.lastIndexOf(".tos-sheet--purchase .tos-receipt-line {"));
    expect(rowStyle).toContain('grid-template-areas: "num item unit qty cost total remove"');
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("min-width: 854px");
  });

  it("keeps the receipt total light against the dark purchase-preview hero", () => {
    expect(detail).toContain('className="tos-purchase-hero__total"');
    expect(detail).toContain("<MoneyValue minor={purchase.totalMinor} currencyCode={currency} />");
    expect(css).toMatch(
      /\.tos-purchase-hero \.tos-purchase-hero__total \.tos-money-value\s*\{[^}]*color:\s*#fff;/,
    );
  });

  it("does not change submitted supplier, unit, quantity or cost fields", () => {
    for (const name of [
      "supplierId", "settlementMethod", "purchaseUnitCode", "quantity",
      "unitCostMinor", 'mutationType: "PURCHASE_RECEIVE_CREATE"',
    ]) expect(builder).toContain(name);
  });
});
