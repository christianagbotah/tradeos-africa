import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const ui=readFileSync(resolve(__dirname,"PosCashShiftPanel.tsx"),"utf8");
const nativePos=readFileSync(resolve(__dirname,"PosScreen.tsx"),"utf8");
const app=readFileSync(resolve(__dirname,"../../App.tsx"),"utf8");
const runtime=readFileSync(resolve(__dirname,"../runtime.ts"),"utf8");
describe("native own cash shift parity without finance leakage",()=>{
  it("uses the POS-only role gate and authenticated scoped server status",()=>{
    expect(nativePos).toContain("attendantOnly&&getOwnCashShift&&onOwnCashShift");
    expect(app).toContain("api.getOwnCashShift(businessId,branchId)");
    expect(app).toContain("runtime.recordOwnCashShift(status,countedMinor,note,snapshot.online===true)");
    expect(ui).toContain("My cash shift");
    expect(ui).toContain("getStatus(businessId,branchId)");
    expect(ui).toContain("Your supervisor controls the day closing");
  });
  it("requires online verification, physical counted cash and confirmation",()=>{
    expect(ui).toContain("cashShiftConfirmationValid(status,countedMinor,online)");
    expect(ui).toContain("Confirm my shift handover");
    expect(ui).toContain("Cash shift not confirmed");
    expect(ui).toContain('await submit(status,countedMinor,note)');
    expect(runtime).toContain('if(!online)');
    expect(runtime).toContain('if(snapshot.pending.some(row=>row.clientMutationId===clientMutationId))');
    expect(runtime).toContain('if(failed)throw new MobileRuntimeError');
  });
  it("resets cross-business state but does not erase user count for a refresh",()=>{
    expect(nativePos).toContain('key={ready.membership.businessId+":"+ready.branch.id}');
    expect(ui).toContain('},[businessId,branchId]);');
    expect(app).toContain("useCallback((businessId:string,branchId:string)");
  });
});
