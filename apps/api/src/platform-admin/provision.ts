import type { PlatformAdminRole } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { hashPassword } from "../auth/security.js";
import { PlatformAdminError } from "./security.js";

const ROLES = new Set<PlatformAdminRole>([
  "SUPER_ADMIN", "PLATFORM_ADMIN", "DEVELOPER", "SUPPORT", "BILLING", "OPERATIONS",
]);

export async function provisionPlatformAdmin(
  pool: DatabasePool,
  input: { email: string; displayName: string; role: string; password: string },
): Promise<{ id: string; email: string; displayName: string; role: PlatformAdminRole }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PlatformAdminError("A valid platform administrator email is required", 400, "ADMIN_EMAIL_INVALID");
  }
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 120) {
    throw new PlatformAdminError("Administrator display name must contain 2–120 characters", 400, "ADMIN_NAME_INVALID");
  }
  if (!ROLES.has(input.role as PlatformAdminRole)) {
    throw new PlatformAdminError("A valid platform administrator role is required", 400, "ADMIN_ROLE_INVALID");
  }
  const role = input.role as PlatformAdminRole;
  if (input.password.length < 12 || input.password.length > 200) {
    throw new PlatformAdminError("Administrator password must contain at least 12 characters", 400, "ADMIN_PASSWORD_WEAK");
  }
  const passwordHash = await hashPassword(input.password);

  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM platform_users WHERE lower(email)=$1 FOR UPDATE`,
      [email],
    );
    const result = existing.rows[0]
      ? await client.query<{ id: string; email: string; display_name: string; role: PlatformAdminRole }>(
          `UPDATE platform_users
           SET email=$2,display_name=$3,role=$4,is_active=true,password_hash=$5,
               failed_login_count=0,locked_until=NULL,password_changed_at=now(),updated_at=now()
           WHERE id=$1
           RETURNING id,email,display_name,role`,
          [existing.rows[0].id, email, displayName, role, passwordHash],
        )
      : await client.query<{ id: string; email: string; display_name: string; role: PlatformAdminRole }>(
          `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
           VALUES($1,$2,$3,true,$4,now())
           RETURNING id,email,display_name,role`,
          [email, displayName, role, passwordHash],
        );
    const row = result.rows[0]!;
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  });
}
