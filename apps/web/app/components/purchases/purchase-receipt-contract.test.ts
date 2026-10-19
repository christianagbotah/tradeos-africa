import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const builderPath = fileURLToPath(new URL("./purchase-receipt-builder.tsx", import.meta.url));
const serverPath = fileURLToPath(new URL("../../../../api/src/commerce/purchases.ts", import.meta.url));
const builder = readFileSync(builderPath, "utf8");
const server = readFileSync(serverPath, "utf8");

describe("purchase receipt settlement contract", () => {
  it("keeps the web payload aligned with the server purchase contract", () => {
    expect(server).toContain("settlementMethod: SettlementMethod");
    expect(server).toContain("purchaseUnitCode: string");
    expect(server).toContain("unitCostMinor: number");

    expect(builder).toContain("settlementMethod");
    expect(builder).toContain("purchaseUnitCode");
    expect(builder).toContain("unitCostMinor");
    expect(builder).not.toContain("costMinor: l.costMinor");
  });

  it("shows settlement method and money-account controls instead of claiming the server chooses", () => {
    expect(builder).toContain("SUPPLIER_CREDIT");
    expect(builder).toContain("Payment method");
    expect(builder).toContain("moneyAccountId");
    expect(builder).toContain("/v1/money-accounts");
    expect(builder).toContain("/v1/money-account-defaults");
    expect(builder).not.toContain("server chooses, not the client");
  });

  it("lets the user choose the configured purchasing unit for every receipt line", () => {
    expect(builder).toContain("purchasableUnits(selected)");
    expect(builder).toContain("purchase unit");
  });
});
