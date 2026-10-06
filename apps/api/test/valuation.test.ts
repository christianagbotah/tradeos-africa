import { describe,expect,it } from "vitest";
import { addSignedMinor,cumulativeMinor,proportionalQuantity,proportionalMinor,quantityUnits,safeMinor,signedMinor } from "../src/commerce/valuation.js";
describe("inventory minor-unit arithmetic",()=>{
 it("converts bulk receipt cost to a glass cost without rounding intermediate unit cost",()=>{
  const purchaseCost=proportionalMinor(15000,2,1);
  expect(purchaseCost).toBe(30000);
  expect(proportionalMinor(purchaseCost,50,1500)).toBe(1000);
 });
 it("supports signed supplier balances while preserving safe-integer bounds",()=>{
  expect(signedMinor(-7000)).toBe(-7000);
  expect(addSignedMinor(500,-7500)).toBe(-7000);
  expect(()=>addSignedMinor(Number.MAX_SAFE_INTEGER,1)).toThrow();
 });
 it("allocates cumulative costs and stock snapshots without partial-return drift",()=>{
  const denominator=quantityUnits(3);
  expect([0.5,1,3].map(q=>cumulativeMinor(3,quantityUnits(q),denominator))).toEqual([1,1,3]);
  expect(proportionalQuantity(1500,quantityUnits(0.5),quantityUnits(2))).toBe(quantityUnits(375));
  expect(addSignedMinor(-7500,30000)).toBe(22500);
  expect(signedMinor(-7500)).toBe(-7500);
  expect(()=>addSignedMinor(Number.MAX_SAFE_INTEGER,1)).toThrow();
 });
 it("keeps large intermediate products exact and rejects unsafe totals",()=>{
  expect(proportionalMinor(Number.MAX_SAFE_INTEGER,1500,1500)).toBe(Number.MAX_SAFE_INTEGER);
  expect(()=>proportionalMinor(Number.MAX_SAFE_INTEGER,2,1)).toThrow();
  expect(()=>safeMinor(1.5)).toThrow();
  expect(()=>quantityUnits(Infinity)).toThrow();
 });
});
