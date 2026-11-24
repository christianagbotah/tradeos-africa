import {describe,expect,it} from "vitest";
import {
  buildOperationsMutation,businessDateAt,operationsPermission,
  validateOperationsCounts,OPERATIONS_METHODS,operationsVariance,
} from "./operations-flow";
const day={id:"day-1",status:"OPEN" as const};
const shift={id:"shift-1",status:"OPEN" as const};
const open={operatingDay:day,shift,openShiftCount:1};
const counted={CASH:12345,MOMO:5600,CARD:0,BANK:0,OTHER:0};
describe("SME cashier shift/day control payloads",()=>{
  it("uses business-local calendar date at a timezone boundary",()=>{
    expect(businessDateAt(new Date("2026-10-06T23:15:00Z"),"Africa/Accra")).toBe("2026-10-06");
    expect(businessDateAt(new Date("2026-10-06T23:15:00Z"),"Africa/Lagos")).toBe("2026-10-07");
    expect(businessDateAt(new Date("2026-10-06T23:15:00Z"),"America/New_York")).toBe("2026-10-06");
  });
  it("opens a day with a business date and counted cash float",()=>{
    expect(buildOperationsMutation("open-day",{operatingDay:null,shift:null,openShiftCount:0},
      {CASH:5000},"Africa/Accra",new Date("2026-11-24T09:00:00Z"))).toEqual({
        mutationType:"OPERATING_DAY_OPEN_CREATE",
        payload:{businessDate:"2026-11-24",openingBalances:[{method:"CASH",countedMinor:5000}],note:undefined},
      });
  });
  it("opens staff shift explicitly attributed to current open day",()=>{
    expect(buildOperationsMutation("open-shift",{operatingDay:day,shift:null,openShiftCount:0},
      {CASH:2000},"Africa/Accra").payload).toMatchObject({
        dayId:"day-1",openingBalances:[{method:"CASH",countedMinor:2000}],
      });
  });
  it("closes only current staff shift, submitting all five counted methods",()=>{
    expect(buildOperationsMutation("close-shift",open,counted,"Africa/Accra",new Date("2026-11-24T15:00:00Z")).payload)
      .toMatchObject({shiftId:"shift-1",closingBalances:OPERATIONS_METHODS.map(method=>({
        method,countedMinor:counted[method],
      }))});
  });
  it("closes a day only after staff shifts finish",()=>{
    expect(()=>buildOperationsMutation("close-day",open,counted,"Africa/Accra")).toThrow("Close all staff shifts");
    expect(buildOperationsMutation("close-day",{...open,shift:null,openShiftCount:0},
      counted,"Africa/Accra").payload).toMatchObject({
        dayId:"day-1",closingBalances:expect.arrayContaining([{method:"CASH",countedMinor:12345}]),
      });
  });
  it("never silently converts missing closing counts into zero",()=>{
    expect(()=>validateOperationsCounts({CASH:0},"closing")).toThrow("MOMO");
    expect(()=>validateOperationsCounts({},"opening")).toThrow("CASH");
    expect(()=>validateOperationsCounts({CASH:-1},"closing")).toThrow("nonnegative");
    expect(()=>validateOperationsCounts({CASH:1.2},"opening")).toThrow("nonnegative");
    expect(validateOperationsCounts(counted,"closing")).toHaveLength(5);
    expect(validateOperationsCounts({CASH:0},"opening")).toEqual([{method:"CASH",countedMinor:0}]);
  });
  it("restricts close day to supervisor and gives cashier own shifts only",()=>{
    expect(operationsPermission("CASHIER","close-day")).toBe(false);
    expect(operationsPermission("CASHIER","open-day")).toBe(false);
    expect(operationsPermission("CASHIER","close-shift")).toBe(true);
    expect(operationsPermission("POS_ATTENDANT","close-shift")).toBe(false);
    expect(operationsPermission("OWNER","close-day")).toBe(true);
    expect(operationsPermission("VIEWER","open-shift")).toBe(false);
  });
  it("displays variance without posting a balancing cashbook adjustment",()=>{
    expect(operationsVariance({CASH:4500},5000)).toBe(-500);
    expect(operationsVariance({CASH:5200},5000)).toBe(200);
    expect(operationsVariance({},5000)).toBeNull();
  });
});
