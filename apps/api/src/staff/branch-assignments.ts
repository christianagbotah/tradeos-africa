import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { requireBusinessRole } from "../auth/authorization.js";
import { AuthError, type AuthContext } from "../auth/security.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(v:unknown,label:string):string {
  if(typeof v!=="string"||!UUID.test(v)){
    throw new AuthError(label+" must be a valid identifier.",400,"BRANCH_ASSIGNMENT_INVALID");
  }
  return v;
}
async function managementAccess(pool:DatabasePool,auth:AuthContext,businessId:string){
  return requireBusinessRole(pool,auth,businessId,["OWNER","ADMIN"]);
}
export async function readAttendantAssignments(
  pool:DatabasePool,auth:AuthContext,businessIdRaw:unknown,staffIdRaw:unknown,
):Promise<string[]> {
  const businessId=validId(businessIdRaw,"Business");
  const staffId=validId(staffIdRaw,"Staff");
  await managementAccess(pool,auth,businessId);
  const staff=await pool.query<{role:string}>(
    `SELECT role FROM staff WHERE business_id=$1 AND id=$2`,[businessId,staffId],
  );
  if(staff.rows[0]?.role!=="POS_ATTENDANT")throw new AuthError(
    "Only POS attendants have branch assignments.",403,"STAFF_ROLE_FORBIDDEN",
  );
  const assigned=await pool.query<{branch_id:string}>(
    `SELECT ba.branch_id FROM pos_attendant_branch_assignments ba
       JOIN branches b ON b.id=ba.branch_id AND b.business_id=ba.business_id
      WHERE ba.business_id=$1 AND ba.staff_id=$2 ORDER BY b.code,b.id`,
    [businessId,staffId],
  );
  return assigned.rows.map(row=>row.branch_id);
}

export async function replaceAttendantAssignments(
  pool:DatabasePool,auth:AuthContext,businessIdRaw:unknown,
  staffIdRaw:unknown,branchIdsRaw:unknown,
):Promise<string[]> {
  const businessId=validId(businessIdRaw,"Business");
  const staffId=validId(staffIdRaw,"Staff");
  if(!Array.isArray(branchIdsRaw)||branchIdsRaw.length>100){
    throw new AuthError("Provide up to 100 selected branches.",400,"BRANCH_ASSIGNMENT_INVALID");
  }
  const branchIds=branchIdsRaw.map(id=>validId(id,"Branch"));
  if(new Set(branchIds).size!==branchIds.length)throw new AuthError(
    "Each branch can be assigned once.",400,"BRANCH_ASSIGNMENT_INVALID",
  );
  await managementAccess(pool,auth,businessId);
  return withTransaction(pool,async db=>{
    // Serialize against role changes and competing staff-management writes.
    await db.query(`SELECT id FROM businesses WHERE id=$1 FOR UPDATE`,[businessId]);
    const actor=await db.query<{staff_id:string;role:string}>(
      `SELECT m.staff_id,m.role FROM business_memberships m
         JOIN staff s ON s.id=m.staff_id AND s.business_id=m.business_id
        WHERE m.business_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'
          AND m.role IN ('OWNER','ADMIN') AND s.is_active=true`,
      [businessId,auth.userId],
    );
    if(!actor.rows[0]?.staff_id ||
      (actor.rows[0].role!=="OWNER" && actor.rows[0].role!=="ADMIN"))throw new AuthError(
      "Staff management access was revoked.",403,"STAFF_ROLE_FORBIDDEN",
    );
    const staff=await db.query<{role:string}>(
      `SELECT role FROM staff WHERE business_id=$1 AND id=$2 AND is_active=true FOR UPDATE`,
      [businessId,staffId],
    );
    if(staff.rows[0]?.role!=="POS_ATTENDANT")throw new AuthError(
      "Only active POS attendants can be assigned branches.",403,"STAFF_ROLE_FORBIDDEN",
    );
    if(branchIds.length){
      const valid=await db.query<{id:string}>(
        `SELECT id FROM branches WHERE business_id=$1 AND is_active=true
          AND id=ANY($2::uuid[]) FOR SHARE`,
        [businessId,branchIds],
      );
      if(valid.rowCount!==branchIds.length)throw new AuthError(
        "Select active branches from this business only.",403,"BRANCH_SCOPE_DENIED",
      );
    }
    const before=await db.query<{branch_id:string}>(
      `SELECT branch_id FROM pos_attendant_branch_assignments
        WHERE business_id=$1 AND staff_id=$2`,[businessId,staffId],
    );
    await db.query(`DELETE FROM pos_attendant_branch_assignments
      WHERE business_id=$1 AND staff_id=$2`,[businessId,staffId]);
    for(const branchId of branchIds){
      await db.query(
        `INSERT INTO pos_attendant_branch_assignments
          (business_id,staff_id,branch_id,assigned_by_staff_id)
          VALUES($1,$2,$3,$4)`,
        [businessId,staffId,branchId,actor.rows[0].staff_id],
      );
    }
    await db.query(
      `INSERT INTO audit_events(business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
         VALUES($1,$2,'POS_ATTENDANT_BRANCHES_SET','STAFF',$3,$4::jsonb)`,
      [businessId,actor.rows[0].staff_id,staffId,JSON.stringify({
        before:before.rows.map(r=>r.branch_id).sort(),
        after:[...branchIds].sort(),
      })],
    );
    return branchIds;
  });
}
