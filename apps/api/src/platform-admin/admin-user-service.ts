import { PLATFORM_ADMIN_ROLES, type AdminPlatformUserSummary, type PlatformAdminRole } from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

const ROLES = new Set<PlatformAdminRole>(PLATFORM_ADMIN_ROLES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: PlatformAdminRole;
  is_active: boolean;
  credential_provisioned: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function listPlatformAdmins(
  pool: DatabasePool,
  _actor: PlatformAdminContext,
): Promise<AdminPlatformUserSummary[]> {
  const result = await pool.query<AdminUserRow>(`
    SELECT id,email,display_name,role,is_active,(password_hash IS NOT NULL) AS credential_provisioned,
           last_login_at,created_at,updated_at
    FROM platform_users
    ORDER BY is_active DESC,
             CASE role WHEN 'SUPER_ADMIN' THEN 0 WHEN 'PLATFORM_ADMIN' THEN 1 ELSE 2 END,
             display_name,email
  `);
  return result.rows.map(mapAdmin);
}

export async function createPlatformAdmin(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: { email?: unknown; displayName?: unknown; role?: unknown; reason?: unknown },
): Promise<AdminPlatformUserSummary> {
  const email = parseEmail(input.email);
  const displayName = parseDisplayName(input.displayName);
  const role = parseRole(input.role);
  const reason = parseReason(input.reason);

  const id = await withTransaction(pool, async (client) => {
    await requireCurrentSuperAdmin(client, actor.id);
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
         VALUES($1,$2,$3,true,NULL,NULL)
         RETURNING id`,
        [email, displayName, role],
      );
      const createdId = inserted.rows[0]!.id;
      await writeAudit(client, actor.id, "PLATFORM_ADMIN_CREATED", createdId, reason, {
        next: { email, displayName, role, active: true, credentialProvisioned: false },
      });
      return createdId;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PlatformAdminError("An administrator already uses that email address", 409, "ADMIN_USER_EMAIL_IN_USE");
      }
      throw error;
    }
  });
  return getPlatformAdmin(pool, id);
}

export async function updatePlatformAdminRole(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  adminId: string,
  input: { role?: unknown; reason?: unknown },
): Promise<AdminPlatformUserSummary> {
  requireUuid(adminId);
  const nextRole = parseRole(input.role);
  const reason = parseReason(input.reason);

  await withTransaction(pool, async (client) => {
    const capableSupers = await lockCredentialedActiveSupers(client);
    await requireCurrentSuperAdmin(client, actor.id);
    const target = await getLockedAdmin(client, adminId);
    const removesSuper = target.role === "SUPER_ADMIN" && target.is_active && target.credential_provisioned && nextRole !== "SUPER_ADMIN";
    if (removesSuper && capableSupers.length <= 1) {
      throw new PlatformAdminError("At least one active, credentialed SUPER_ADMIN must remain", 409, "ADMIN_LAST_SUPER_ADMIN");
    }
    if (target.role === nextRole) return;
    await client.query(
      `UPDATE platform_users
       SET role=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [adminId, nextRole],
    );
    await writeAudit(client, actor.id, "PLATFORM_ADMIN_ROLE_CHANGED", adminId, reason, {
      previous: { role: target.role }, next: { role: nextRole },
    });
  });
  return getPlatformAdmin(pool, adminId);
}

export async function setPlatformAdminActive(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  adminId: string,
  input: { active?: unknown; reason?: unknown },
): Promise<AdminPlatformUserSummary> {
  requireUuid(adminId);
  const active = parseActive(input.active);
  const reason = parseReason(input.reason);

  await withTransaction(pool, async (client) => {
    const capableSupers = await lockCredentialedActiveSupers(client);
    await requireCurrentSuperAdmin(client, actor.id);
    const target = await getLockedAdmin(client, adminId);
    const removesSuper = target.role === "SUPER_ADMIN" && target.is_active && target.credential_provisioned && !active;
    if (removesSuper && capableSupers.length <= 1) {
      throw new PlatformAdminError("At least one active, credentialed SUPER_ADMIN must remain", 409, "ADMIN_LAST_SUPER_ADMIN");
    }
    if (target.is_active === active) return;
    await client.query(
      `UPDATE platform_users
       SET is_active=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [adminId, active],
    );
    if (!active) {
      await client.query(
        `UPDATE platform_admin_sessions
         SET revoked_at=COALESCE(revoked_at,now())
         WHERE platform_user_id=$1 AND revoked_at IS NULL`,
        [adminId],
      );
    }
    await writeAudit(client, actor.id, "PLATFORM_ADMIN_STATUS_CHANGED", adminId, reason, {
      previous: { active: target.is_active }, next: { active },
    });
  });
  return getPlatformAdmin(pool, adminId);
}

async function lockCredentialedActiveSupers(client: DatabaseClient): Promise<Array<{ id: string }>> {
  const result = await client.query<{ id: string }>(`
    SELECT id
    FROM platform_users
    WHERE role='SUPER_ADMIN' AND is_active=true AND password_hash IS NOT NULL
    ORDER BY id
    FOR UPDATE
  `);
  return result.rows;
}

async function requireCurrentSuperAdmin(client: DatabaseClient, actorId: string): Promise<void> {
  const found = await client.query<{ role: PlatformAdminRole; is_active: boolean }>(
    `SELECT role,is_active FROM platform_users WHERE id=$1`,
    [actorId],
  );
  const current = found.rows[0];
  if (!current || !current.is_active || current.role !== "SUPER_ADMIN") {
    throw new PlatformAdminError("Only an active SUPER_ADMIN can manage platform administrators", 403, "ADMIN_USER_WRITE_FORBIDDEN");
  }
}

async function getLockedAdmin(client: DatabaseClient, adminId: string): Promise<AdminUserRow> {
  const result = await client.query<AdminUserRow>(`
    SELECT id,email,display_name,role,is_active,(password_hash IS NOT NULL) AS credential_provisioned,
           last_login_at,created_at,updated_at
    FROM platform_users
    WHERE id=$1
    FOR UPDATE
  `, [adminId]);
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Platform administrator was not found", 404, "ADMIN_USER_NOT_FOUND");
  return row;
}

async function getPlatformAdmin(pool: DatabasePool, adminId: string): Promise<AdminPlatformUserSummary> {
  const result = await pool.query<AdminUserRow>(`
    SELECT id,email,display_name,role,is_active,(password_hash IS NOT NULL) AS credential_provisioned,
           last_login_at,created_at,updated_at
    FROM platform_users WHERE id=$1
  `, [adminId]);
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Platform administrator was not found", 404, "ADMIN_USER_NOT_FOUND");
  return mapAdmin(row);
}

function mapAdmin(row: AdminUserRow): AdminPlatformUserSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: row.is_active,
    credentialProvisioned: row.credential_provisioned,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string") throw new PlatformAdminError("A valid administrator email is required", 400, "ADMIN_USER_EMAIL_INVALID");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new PlatformAdminError("A valid administrator email is required", 400, "ADMIN_USER_EMAIL_INVALID");
  }
  return email;
}

function parseDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new PlatformAdminError("Administrator display name is required", 400, "ADMIN_USER_NAME_INVALID");
  const displayName = value.trim();
  if (!displayName || displayName.length > 160) throw new PlatformAdminError("Administrator display name is invalid", 400, "ADMIN_USER_NAME_INVALID");
  return displayName;
}

function parseRole(value: unknown): PlatformAdminRole {
  if (typeof value !== "string" || !ROLES.has(value as PlatformAdminRole)) {
    throw new PlatformAdminError("Administrator role is invalid", 400, "ADMIN_USER_ROLE_INVALID");
  }
  return value as PlatformAdminRole;
}

function parseActive(value: unknown): boolean {
  if (typeof value !== "boolean") throw new PlatformAdminError("Administrator active state is required", 400, "ADMIN_USER_STATUS_INVALID");
  return value;
}

function parseReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new PlatformAdminError("A reason is required", 400, "ADMIN_REASON_REQUIRED");
  const reason = value.trim();
  if (reason.length > 500) throw new PlatformAdminError("Reason is too long", 400, "ADMIN_REASON_INVALID");
  return reason;
}

function requireUuid(value: string): void {
  if (!UUID.test(value)) throw new PlatformAdminError("Platform administrator was not found", 404, "ADMIN_USER_NOT_FOUND");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

async function writeAudit(
  client: DatabaseClient,
  actorId: string,
  eventType: string,
  targetId: string,
  reason: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,'PLATFORM_USER',$3,$4,$5::jsonb)`,
    [actorId, eventType, targetId, reason, JSON.stringify(payload)],
  );
}
