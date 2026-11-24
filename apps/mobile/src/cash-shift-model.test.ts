import {describe,expect,it} from "vitest";
import {cashShiftConfirmationValid,ownShiftCashExpected,parseCashShiftMinor,formatCashShiftMinor} from "./cash-shift-model";
import type {MobileOwnCashShiftStatus} from "./api-client";
const status:MobileOwnCashShiftStatus={
  operatingDay:{id:"day-id",status:"OPEN",openedAt:"2026-11-24T08:00:00Z"},
  shift:{id:"shift-id",status:"OPEN",openedAt:"2026-11-24T09:00:00Z",
    balances:[{method:"CASH",openingCountedMinor:2000,movementMinor:3000,
      expectedClosingMinor:5000}]},
  openShiftCount:1,
};
describe("native POS attendant cash parsing and custody state",()=>{
  it("uses native currency exponent for Ghana, Uganda and Tunisia",()=>{
    expect(parseCashShiftMinor("12.50","GHS")).toBe(1250);
    expect(parseCashShiftMinor("12.5","GHS")).toBe(1250);
    expect(parseCashShiftMinor("0","GHS")).toBe(0);
    expect(parseCashShiftMinor("5000","UGX")).toBe(5000);
    expect(parseCashShiftMinor("12.345","TND")).toBe(12345);
    expect(parseCashShiftMinor("12.3","TND")).toBe(12300);
  });
  it("formats cedi, whole-unit and three-decimal currencies without a fixed /100",()=>{
    expect(formatCashShiftMinor(1250,"GHS")).toContain("₵12.50");
    expect(formatCashShiftMinor(5000,"UGX")).toContain("5,000");
    expect(formatCashShiftMinor(12345,"TND")).toContain("12,345");
    expect(formatCashShiftMinor(-50,"GHS")).toContain("-₵0.50");
  });
  it("rejects invalid, negative, too-precise, overflow and unknown money",()=>{
    expect(parseCashShiftMinor("-3","GHS")).toBeNull();
    expect(parseCashShiftMinor("1.234","GHS")).toBeNull();
    expect(parseCashShiftMinor("12.1","UGX")).toBeNull();
    expect(parseCashShiftMinor("9.5.1","GHS")).toBeNull();
    expect(parseCashShiftMinor("900719925474099999999","GHS")).toBeNull();
    expect(parseCashShiftMinor("1","XYZ")).toBeNull();
    expect(parseCashShiftMinor("","GHS")).toBeNull();
  });
  it("shows only the authenticated own cash expectation",()=>{
    expect(ownShiftCashExpected(status)).toBe(5000);
    expect(ownShiftCashExpected({...status,shift:null})).toBeNull();
    expect(ownShiftCashExpected(null)).toBeNull();
  });
  it("requires a verified open day, online and an explicit nonnegative count",()=>{
    expect(cashShiftConfirmationValid(status,0,true)).toBe(true);
    expect(cashShiftConfirmationValid(status,3900,true)).toBe(true);
    expect(cashShiftConfirmationValid(status,null,true)).toBe(false);
    expect(cashShiftConfirmationValid(status,3900,false)).toBe(false);
    expect(cashShiftConfirmationValid({...status,operatingDay:null},3900,true)).toBe(false);
    expect(cashShiftConfirmationValid(status,-1,true)).toBe(false);
  });
});
