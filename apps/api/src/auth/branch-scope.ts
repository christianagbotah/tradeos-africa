import type { DatabasePool } from "../db.js";
import { AuthError } from "./security.js";
import type { BusinessAccess } from "./authorization.js";

export const BRANCH_SCOPE_DENIED = "BRANCH_SCOPE_DENIED";

/** Enforce on server every time; ignore the branch selected in a stale device session. */
export async function requireBranchScope(
  pool: DatabasePool, access: BusinessAccess, branchId: unknown,
): Promise<void> {
  if (access.role !== "POS_ATTENDANT") return;
  if (!access.staffId || typeof branchId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) {
    throw new AuthError("This POS attendant has no access to that branch.",403,BRANCH_SCOPE_DENIED);
  }
  const rows = await pool.query(
    `SELECT 1 FROM pos_attendant_branch_assignments ba
       JOIN branches br ON br.id=ba.branch_id AND br.business_id=ba.business_id
      WHERE ba.business_id=$1 AND ba.staff_id=$2 AND ba.branch_id=$3
        AND br.is_active=true LIMIT 1`,
    [access.businessId,access.staffId,branchId],
  );
  if (!rows.rowCount) throw new AuthError(
    "This POS attendant is not assigned to the selected branch.",403,BRANCH_SCOPE_DENIED,
  );
}

/** Unassigned or fully deactivated POS staff fail closed at membership read. */
export async function requireAnyBranchScope(
  pool: DatabasePool, access: BusinessAccess,
): Promise<void> {
  if (access.role !== "POS_ATTENDANT") return;
  if (!access.staffId) throw new AuthError("No assigned branch.",403,BRANCH_SCOPE_DENIED);
  const rows = await pool.query(
    `SELECT 1 FROM pos_attendant_branch_assignments ba
       JOIN branches br ON br.id=ba.branch_id AND br.business_id=ba.business_id
      WHERE ba.business_id=$1 AND ba.staff_id=$2 AND br.is_active=true LIMIT 1`,
    [access.businessId,access.staffId],
  );
  if (!rows.rowCount) throw new AuthError(
    "No active branch is assigned. Ask your business administrator.",403,BRANCH_SCOPE_DENIED,
  );
}

export async function visibleBranchesForAccess<T extends {id:string}>(
  pool: DatabasePool, access: BusinessAccess, branches: readonly T[],
): Promise<T[]> {
  if (access.role !== "POS_ATTENDANT") return [...branches];
  const allowed = await pool.query<{branch_id:string}>(
    `SELECT ba.branch_id FROM pos_attendant_branch_assignments ba
       JOIN branches br ON br.id=ba.branch_id AND br.business_id=ba.business_id
      WHERE ba.business_id=$1 AND ba.staff_id=$2 AND br.is_active=true`,
    [access.businessId,access.staffId],
  );
  const ids = new Set(allowed.rows.map(row=>row.branch_id));
  return branches.filter(branch=>ids.has(branch.id));
}
