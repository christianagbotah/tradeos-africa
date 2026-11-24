import {describe,it,expect} from "vitest";
import {blankCounts,branchBusinessDate,operationInput,canManageDays,canManageOwnShift,canChangeShiftPolicy} from "./operations-workspace";
import type {MobileOperationsCurrent,MobileOperationInterval} from "./api-client";
const day={id:"day",businessId:"b",branchId:"br",status:"OPEN"} as MobileOperationInterval;
const shift={...day,id:"shift",operatingDayId:"day"};
const empty:MobileOperationsCurrent={operatingDay:null,shift:null,openShiftCount:0};
const counts={CASH:"12.34",MOMO:"0",CARD:"0",BANK:"0",OTHER:"0"};
const date="2026-11-24";
describe("native operations",()=>{
 it("requires actual counts and uses branch-local business date",()=>{
  expect(branchBusinessDate("Africa/Accra",new Date("2026-11-24T23:30:00Z"))).toBe(date);
  expect(branchBusinessDate("Africa/Nairobi",new Date("2026-11-24T23:30:00Z"))).toBe("2026-11-25");
  expect(()=>operationInput("OPERATING_DAY_OPEN_CREATE",empty,blankCounts(),date,"","OWNER","b","br")).toThrow();
  expect(operationInput("OPERATING_DAY_OPEN_CREATE",empty,counts,date,"handover","OWNER","b","br").payload.openingBalances).toHaveLength(5);
 });
 it("prevents day closure with open shifts or foreign branch scope",()=>{
  const current={operatingDay:day,shift:null,openShiftCount:1};
  expect(()=>operationInput("OPERATING_DAY_CLOSE_CREATE",current,counts,date,"","OWNER","b","br")).toThrow();
  expect(()=>operationInput("OPERATING_DAY_CLOSE_CREATE",{...current,openShiftCount:0},counts,date,"","OWNER","b","other")).toThrow();
  expect(operationInput("OPERATING_DAY_CLOSE_CREATE",{...current,openShiftCount:0},counts,date,"","OWNER","b","br").payload).toMatchObject({dayId:"day",closingBalances:expect.arrayContaining([{method:"CASH",countedMinor:1234}])});
 });
 it("enforces own shift lifecycle and policy role boundaries",()=>{
  expect(canManageDays("CASHIER")).toBe(false);expect(canManageOwnShift("CASHIER")).toBe(true);expect(canChangeShiftPolicy("MANAGER")).toBe(false);
  const current={operatingDay:day,shift:null,openShiftCount:0};
  expect(operationInput("SHIFT_OPEN_CREATE",current,counts,date,"","CASHIER","b","br").payload).toMatchObject({dayId:"day"});
  expect(operationInput("SHIFT_CLOSE_CREATE",{...current,shift,openShiftCount:1},counts,date,"","CASHIER","b","br").payload).toMatchObject({shiftId:"shift"});
  expect(()=>operationInput("SHIFT_CLOSE_CREATE",current,counts,date,"","CASHIER","b","br")).toThrow();
  expect(()=>operationInput("OPERATING_DAY_OPEN_CREATE",empty,counts,date,"","CASHIER","b","br")).toThrow();
 });
});
