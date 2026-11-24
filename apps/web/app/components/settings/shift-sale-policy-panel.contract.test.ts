import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const ui=readFileSync(resolve(__dirname,"shift-sale-policy-panel.tsx"),"utf8");
const settings=readFileSync(resolve(__dirname,"settings-workspace.tsx"),"utf8");
const route=readFileSync(resolve(__dirname,"../../../../api/src/operations/shift-sale-policy-routes.ts"),"utf8");
const guard=readFileSync(resolve(__dirname,"../../../../api/src/operations/shift-sale-policy.ts"),"utf8");
const sales=readFileSync(resolve(__dirname,"../../../../api/src/commerce/sales.ts"),"utf8");
describe("branch opt-in shift-before-sale controls",()=>{
  it("shows the current branch setting and does not silently enable enforcement",()=>{
    expect(ui).toContain("session?.businessId");
    expect(ui).toContain("session?.branchId");
    expect(ui).toContain("data.policy.required");
    expect(ui).toContain("expectedRevision:data.policy.revision");
    expect(ui).toContain('role="dialog" aria-modal="true"');
    expect(ui).toContain("reason.trim().length<10");
    expect(ui).toContain("refetch()");
    expect(settings).toContain("<ShiftSalePolicyPanel online={online} canManage={canManage}/>");
    expect(route).toContain('"OWNER","ADMIN"');
    expect(route).toContain("SHIFT_POLICY_REVISION_CONFLICT");
  });
  it("enforces policy in the domain transaction at the original sale timestamp",()=>{
    expect(sales).toContain("await assertBranchShiftAtSaleTime(client,{");
    expect(guard).toContain("effective_at<=$3");
    expect(guard).toContain("sh.staff_id=$3");
    expect(guard).toContain("sh.closed_at>=$4");
    expect(guard).toContain("d.closed_at>=$4");
    expect(guard).toContain("SHIFT_REQUIRED_FOR_SALE");
    expect(route).toContain("SHIFT_SALE_POLICY_");
  });
});
