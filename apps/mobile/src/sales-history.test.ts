import { describe,it,expect } from "vitest";
import { canReadSalesHistory,saleMatchesScope,displaySaleDate } from "./sales-history";
import type { MobileSaleDetail } from "./api-client";
describe("native sales history privacy and display",()=>{
  it("does not grant branch-wide history to POS attendants or unknown roles",()=>{
    expect(canReadSalesHistory("OWNER")).toBe(true);
    expect(canReadSalesHistory("CASHIER")).toBe(true);
    expect(canReadSalesHistory("POS_ATTENDANT")).toBe(false);
    expect(canReadSalesHistory("UNKNOWN")).toBe(false);
  });
  it("rejects detail from any different business, branch or sale",()=>{
    const sale={id:"sale",businessId:"business",branchId:"branch"} as MobileSaleDetail;
    expect(saleMatchesScope(sale,"business","branch","sale")).toBe(true);
    expect(saleMatchesScope(sale,"other","branch","sale")).toBe(false);
    expect(saleMatchesScope(sale,"business","other","sale")).toBe(false);
    expect(saleMatchesScope(sale,"business","branch","other")).toBe(false);
  });
  it("includes the year and does not render invalid dates",()=>{
    expect(displaySaleDate("2026-11-24T14:20:00Z","Africa/Accra")).toContain("2026");
    expect(displaySaleDate("bad","Africa/Accra")).toBe("Date unavailable");
  });
});
