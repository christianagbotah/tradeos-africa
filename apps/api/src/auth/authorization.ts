import type { DatabasePool } from "../db.js";
import { AuthError, type AuthContext } from "./security.js";

export type BusinessRole = "OWNER" | "ADMIN" | "MANAGER" | "CASHIER" | "SALES" | "INVENTORY" | "ACCOUNTANT" | "STAFF" | "VIEWER";

export interface BusinessAccess {
  membershipId: string;
  businessId: string;
  role: BusinessRole;
  staffId: string | null;
}

export async function requireBusinessRole(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
  allowedRoles: readonly BusinessRole[],
): Promise<BusinessAccess> {
  const result = await pool.query<{
    membership_id: string;
    role: BusinessRole;
    staff_id: string | null;
    business_status: string;
  }>(
    `SELECT m.id AS membership_id,m.role,st.id AS staff_id,b.status AS business_status
     FROM business_memberships m
     JOIN businesses b ON b.id=m.business_id
     LEFT JOIN staff st ON st.id=m.staff_id AND st.business_id=m.business_id AND st.is_active=true
     WHERE m.business_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'`,
    [businessId, auth.userId],
  );
  const row = result.rows[0];
  if (!row || row.business_status !== "ACTIVE") {
    throw new AuthError("Business access is unavailable", 403, "BUSINESS_ACCESS_DENIED");
  }
  if (!allowedRoles.includes(row.role)) {
    throw new AuthError("Your role cannot perform this action", 403, "ROLE_FORBIDDEN");
  }
  return {
    membershipId: row.membership_id,
    businessId,
    role: row.role,
    staffId: row.staff_id,
  };
}
