import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src=(name:string)=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
const migration=readFileSync(new URL(
  "../../../packages/db/migrations/0063_pos_attendant_branch_assignments.sql",
  import.meta.url),"utf8");
describe("POS branch security schema and API surface",()=>{
  it("uses tenant-composite FKs, audit, and no implicit grants",()=>{
    expect(migration).toContain("uq_staff_business_scope UNIQUE (business_id,id)");
    expect(migration).toContain("REFERENCES branches(business_id,id) ON DELETE CASCADE");
    expect(migration).toContain("REFERENCES staff(business_id,id) ON DELETE CASCADE");
    expect(migration).toContain("REFERENCES staff(business_id,id)");
    expect(migration).toContain("PRIMARY KEY (business_id,staff_id,branch_id)");
    expect(migration).not.toMatch(/INSERT INTO pos_attendant_branch_assignments/i);
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    const service=src("staff/branch-assignments.ts");
    expect(service).toContain("POS_ATTENDANT_BRANCHES_SET");
    expect(service).toContain("STAFF_ROLE_FORBIDDEN");
    expect(service).toContain("BRANCH_SCOPE_DENIED");
    expect(service).toContain("FOR UPDATE");
    expect(service).toContain("new Set(branchIds).size!==branchIds.length");
  });
  it("enforces real authenticated role across sync, quote, stock, receipt, branch context",()=>{
    const core=src("auth/authorization.ts");
    expect(core).toContain("await requireAnyBranchScope(pool, access)");
    const guard=src("auth/branch-scope.ts");
    expect(guard).toContain("access.role !== \"POS_ATTENDANT\"");
    expect(guard).toContain("ba.staff_id=$2 AND ba.branch_id=$3");
    expect(guard).toContain("br.is_active=true");
    expect(src("app.ts")).toContain("requireBranchScope(pool,access,normalizedMutation.branchId)");
    expect(src("commerce/pricing-routes.ts")).toContain("requireBranchScope(pool,a,branchId)");
    expect(src("suppliers-inventory.ts")).toContain("requireBranchScope(pool,access,branchId)");
    expect(src("sales-read.ts")).toContain("requireBranchScope(pool,access,sale.branch_id)");
    expect(src("businesses.ts")).toContain("visibleBranchesForAccess(pool,access,context.branches)");
  });
  it("only owners and admins can update memberships and role reassignment clears grants",()=>{
    expect(src("staff/branch-assignments.ts")).toContain('["OWNER","ADMIN"]');
    expect(src("staff/staff-service.ts")).toContain(
      "DELETE FROM pos_attendant_branch_assignments WHERE business_id=$1 AND staff_id=$2");
    expect(src("staff/routes.ts")).toContain('"/v1/staff/:staffId/branches"');
  });
});
