import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./purchase-receipt-builder.tsx", import.meta.url), "utf8");

describe("purchase receipt builder contract", () => {
  it("shows an explicit settlement method instead of inventing one", () => {
    expect(source).toContain('htmlFor="pr-settlement"');
    expect(source).toContain('id="pr-settlement"');
    expect(source).toContain("SUPPLIER_CREDIT");
    expect(source).not.toContain("server chooses, not the client");
  });

  it("captures a purchasable unit and uses the canonical mutation builder", () => {
    expect(source).toContain("purchaseUnitCode");
    expect(source).toContain("purchasableUnits(selected)");
    expect(source).toContain("buildPurchaseReceivePayload");
    expect(source).not.toContain("currencyCode,\n          lines: validLines.map");
  });
});
