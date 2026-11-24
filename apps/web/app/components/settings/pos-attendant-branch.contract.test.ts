import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
import {canManageStaffRole} from "./team-access";
const team=readFileSync(resolve(__dirname,"team-access.tsx"),"utf8");
describe("branch assignments in owner admin Team & access",()=>{
  it("makes POS attendant assignable by owner/admin but not cashiers or managers",()=>{
    expect(canManageStaffRole("OWNER","POS_ATTENDANT")).toBe(true);
    expect(canManageStaffRole("ADMIN","POS_ATTENDANT")).toBe(true);
    expect(canManageStaffRole("CASHIER","POS_ATTENDANT")).toBe(false);
    expect(canManageStaffRole("MANAGER","POS_ATTENDANT")).toBe(false);
    expect(canManageStaffRole("ADMIN","OWNER")).toBe(false);
  });
  it("shows only active branch choices and a real authenticated save",()=>{
    expect(team).toContain("Assign branches");
    expect(team).toContain("POS attendant branch assignments");
    expect(team).toContain("/branches?businessId=");
    expect(team).toContain('method:"PUT"');
    expect(team).toContain("branchIds:branchEditor.selected");
    expect(team).toContain(".filter(branch=>branch.active)");
    expect(team).toContain("Leaving all unchecked revokes POS access immediately");
    expect(team).toContain("disabled={Boolean(busyId)}");
  });
});
