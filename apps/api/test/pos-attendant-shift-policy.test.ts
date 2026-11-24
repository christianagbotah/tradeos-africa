import {describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {assertPosAttendantShiftPayload} from "../src/auth/pos-attendant-shift-policy.js";
import {PosAttendantPolicyError} from "../src/auth/pos-attendant-policy.js";
import {readFileSync} from "node:fs";
const dayId=randomUUID(),shiftId=randomUUID();
const opening={dayId,openingBalances:[{method:"CASH",countedMinor:1500}]};
const closing={shiftId,closingBalances:[
  {method:"CASH",countedMinor:2000},
  {method:"MOMO",countedMinor:0},
  {method:"CARD",countedMinor:0},
  {method:"BANK",countedMinor:0},
  {method:"OTHER",countedMinor:0},
]};
describe("authenticated POS attendant cash shift request policy",()=>{
  it("allows only own cash-only shift payloads",()=>{
    expect(()=>assertPosAttendantShiftPayload("SHIFT_OPEN_CREATE",opening)).not.toThrow();
    expect(()=>assertPosAttendantShiftPayload("SHIFT_CLOSE_CREATE",closing)).not.toThrow();
    expect(()=>assertPosAttendantShiftPayload("SHIFT_CLOSE_CREATE",{...closing,note:"Bag and change counted"})).not.toThrow();
  });
  it.each([
    ["actor forgery",{...opening,actorStaffId:randomUUID()},"SHIFT_OPEN_CREATE"],
    ["claim another employee",{...closing,staffId:randomUUID()},"SHIFT_CLOSE_CREATE"],
    ["business-date control",{...opening,businessDate:"2026-11-24"},"SHIFT_OPEN_CREATE"],
    ["negative cash",{...opening,openingBalances:[{method:"CASH",countedMinor:-1}]},"SHIFT_OPEN_CREATE"],
    ["unsafe amount",{...opening,openingBalances:[{method:"CASH",countedMinor:Number.MAX_SAFE_INTEGER+1}]},"SHIFT_OPEN_CREATE"],
    ["extra tender",{...opening,openingBalances:[...opening.openingBalances,{method:"MOMO",countedMinor:0}]},"SHIFT_OPEN_CREATE"],
    ["noncash custody",{...closing,closingBalances:[
      {method:"CASH",countedMinor:2000},{method:"MOMO",countedMinor:1},
      {method:"CARD",countedMinor:0},{method:"BANK",countedMinor:0},{method:"OTHER",countedMinor:0},
    ]},"SHIFT_CLOSE_CREATE"],
    ["missing method",{...closing,closingBalances:[{method:"CASH",countedMinor:2000}]},"SHIFT_CLOSE_CREATE"],
    ["duplicate method",{...closing,closingBalances:[
      {method:"CASH",countedMinor:2000},{method:"MOMO",countedMinor:0},
      {method:"CARD",countedMinor:0},{method:"BANK",countedMinor:0},{method:"CASH",countedMinor:0},
    ]},"SHIFT_CLOSE_CREATE"],
    ["overridden counted row",{...opening,openingBalances:[{method:"CASH",countedMinor:1500,varianceMinor:0}]},"SHIFT_OPEN_CREATE"],
    ["invalid day ID",{...opening,dayId:"fake"},"SHIFT_OPEN_CREATE"],
    ["null",null,"SHIFT_OPEN_CREATE"],
    ["array",[],"SHIFT_CLOSE_CREATE"],
  ] as const)("rejects %s with 403 before an accounting write",(_description,input,mode)=>{
    expect(()=>assertPosAttendantShiftPayload(mode,input)).toThrow(PosAttendantPolicyError);
  });
  it("retains server-side role and branch authorization and excludes full finance",()=>{
    const api=readFileSync(new URL("../src/app.ts",import.meta.url),"utf8");
    const ops=readFileSync(new URL("../src/operations.ts",import.meta.url),"utf8");
    expect(api).toContain('const SHIFT_ROLES: readonly BusinessRole[] = [...EXPENSE_ROLES, "POS_ATTENDANT"]');
    expect(api).toContain("assertPosAttendantShiftPayload(normalizedMutation.mutationType,normalizedMutation.payload)");
    expect(api).toContain("await requireBranchScope(pool,access,normalizedMutation.branchId)");
    expect(ops).toContain('access.role==="POS_ATTENDANT" && resource==="days"');
    expect(ops).toContain("await requireBranchScope(pool,access,branchId)");
    expect(ops).toContain('balances.filter(b=>b.method==="CASH")');
    expect(ops).toContain('["CASHIER","POS_ATTENDANT"].includes(access.role)');
  });
});
