import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const ui=readFileSync(resolve(__dirname,"pos-attendant-cash-shift.tsx"),"utf8");
const workspace=readFileSync(resolve(__dirname,"pos-workspace.tsx"),"utf8");
describe("restricted POS cash drawer from Sell",()=>{
  it("shows to POS attendant only, without exposing the accounting navigation",()=>{
    expect(workspace).toContain("{cashOnly ? <PosAttendantCashShift /> : null}");
    expect(ui).toContain("My cash shift");
    expect(ui).toContain("/v1/operations/current?");
    expect(ui).not.toContain("/v1/operations/days");
  });
  it("keeps cash-only counting on opening and closing own server shift",()=>{
    expect(ui).toContain('mutationType:closing?"SHIFT_CLOSE_CREATE":"SHIFT_OPEN_CREATE"');
    expect(ui).toContain("shiftId:data.shift!.id");
    expect(ui).toContain("dayId:data.operatingDay.id");
    expect(ui).toContain('method:"CASH",countedMinor:cashCount');
    expect(ui).toContain('const nonCashZero=["MOMO","CARD","BANK","OTHER"]');
    expect(ui).toContain("MoneyValue minor={difference}");
    expect(ui).toContain("Confirm my shift close");
  });
  it("requires online confirmation and clears amounts on branch switch",()=>{
    expect(ui).toContain("if(!session||busy||!data?.operatingDay||!queue.online)return;");
    expect(ui).toContain("await getOfflineQueue().flushOrThrow(");
    expect(ui).toContain("[session?.businessId,session?.branchId]");
    expect(ui).toContain("Connect to the internet to verify");
  });
});
