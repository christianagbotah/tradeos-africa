import { describe,expect,it } from "vitest";
import { proportionalMinor,quantityUnits,safeMinor } from "../src/commerce/valuation.js";
describe("inventory minor-unit arithmetic",()=>{
 it("converts bulk receipt cost to a glass cost without rounding intermediate unit cost",()=>{
  const purchaseCost=proportionalMinor(15000,2,1);
  expect(purchaseCost).toBe(30000);
  expect(proportionalMinor(purchaseCost,50,1500)).toBe(1000);
 });
 it("keeps large intermediate products exact and rejects unsafe totals",()=>{
  expect(proportionalMinor(Number.MAX_SAFE_INTEGER,1500,1500)).toBe(Number.MAX_SAFE_INTEGER);
  expect(()=>proportionalMinor(Number.MAX_SAFE_INTEGER,2,1)).toThrow();
  expect(()=>safeMinor(1.5)).toThrow();
  expect(()=>quantityUnits(Infinity)).toThrow();
 });
});
