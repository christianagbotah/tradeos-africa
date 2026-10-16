import type { AdminProfile, AdminSessionSummary } from "@tradeos/contracts";
import { hashPassword, verifyPassword } from "../auth/security.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

type PlatformUserProfileRow = {
  id: string;
  email: string;
  display_name: string;
  role: AdminProfile["role"];
  last_login_at: Date | null;
  password_hash?: string | null;
};

type AdminSessionRow = {
  id: string;
  device_key: string;
  platform: AdminSessionSummary["platform"];
  created_at: Date;
  last_used_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

export async function getAdminProfile(pool: DatabasePool, actor: PlatformAdminContext): Promise<AdminProfile> {
  const result = await pool.query<PlatformUserProfileRow>(
    `SELECT id,email,display_name,role,last_login_at
     FROM platform_users WHERE id=$1 AND is_active=true`,
    [actor.id],
  );
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Administrator profile was not found", 404, "ADMIN_PROFILE_NOT_FOUND");
  return mapProfile(row);
}

export async function updateAdminProfile(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: { email?: unknown; displayName?: unknown },
): Promise<AdminProfile> {
  const email = input.email === undefined ? undefined : parseEmail(input.email);
  const displayName = input.displayName === undefined ? undefined : parseDisplayName(input.displayName);
  if (email === undefined && displayName === undefined) {
    throw new PlatformAdminError("At least one profile field is required", 400, "ADMIN_PROFILE_EMPTY");
  }

  try {
    return await withTransaction(pool, async (client) => {
      const found = await client.query<PlatformUserProfileRow>(
        `SELECT id,email,display_name,role,last_login_at
         FROM platform_users WHERE id=$1 AND is_active=true FOR UPDATE`,
        [actor.id],
      );
      const current = found.rows[0];
      if (!current) throw new PlatformAdminError("Administrator profile was not found", 404, "ADMIN_PROFILE_NOT_FOUND");

      const nextEmail = email ?? current.email;
      const nextDisplayName = displayName ?? current.display_name;
      if (nextEmail !== current.email) {
        const duplicate = await client.query<{ id: string }>(
          "SELECT id FROM platform_users WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1",
          [nextEmail, actor.id],
        );
        if (duplicate.rowCount) throw new PlatformAdminError("Email address is already in use", 409, "ADMIN_EMAIL_CONFLICT");
      }

      const updated = await client.query<PlatformUserProfileRow>(
        `UPDATE platform_users
         SET email=$2,display_name=$3,updated_at=now()
         WHERE id=$1
         RETURNING id,email,display_name,role,last_login_at`,
        [actor.id, nextEmail, nextDisplayName],
      );
      await writeProfileAudit(client, actor.id, "ADMIN_PROFILE_UPDATED", actor.id, "Administrator updated own profile", {
        previous: { email: current.email, displayName: current.display_name },
        next: { email: nextEmail, displayName: nextDisplayName },
      });
      return mapProfile(updated.rows[0]!);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PlatformAdminError("Email address is already in use", 409, "ADMIN_EMAIL_CONFLICT");
    throw error;
  }
}

export async function changeAdminPassword(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: { currentPassword?: unknown; newPassword?: unknown },
): Promise<void> {
  const currentPassword = requirePassword(input.currentPassword, "Current password is required", "ADMIN_CURRENT_PASSWORD_REQUIRED");
  const newPassword = requirePassword(input.newPassword, "New password is required", "ADMIN_NEW_PASSWORD_REQUIRED");
  if (newPassword.length < 12 || newPassword.length > 200) {
    throw new PlatformAdminError("New password must contain at least 12 characters", 400, "ADMIN_PASSWORD_WEAK");
  }
  if (newPassword === currentPassword) {
    throw new PlatformAdminError("New password must be different from the current password", 400, "ADMIN_PASSWORD_UNCHANGED");
  }

  await withTransaction(pool, async (client) => {
    const found = await client.query<PlatformUserProfileRow & { password_hash: string | null }>(
      `SELECT id,email,display_name,role,last_login_at,password_hash
       FROM platform_users WHERE id=$1 AND is_active=true FOR UPDATE`,
      [actor.id],
    );
    const current = found.rows[0];
    if (!current?.password_hash || !(await verifyPassword(currentPassword, current.password_hash))) {
      throw new PlatformAdminError("Current password is incorrect", 400, "ADMIN_CURRENT_PASSWORD_INVALID");
    }

    const passwordHash = await hashPassword(newPassword);
    await client.query(
      `UPDATE platform_users
       SET password_hash=$2,password_changed_at=now(),failed_login_count=0,locked_until=NULL,updated_at=now()
       WHERE id=$1`,
      [actor.id, passwordHash],
    );
    const revoked = await client.query(
      `UPDATE platform_admin_sessions
       SET revoked_at=COALESCE(revoked_at,now())
       WHERE platform_user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
      [actor.id, actor.sessionId],
    );
    await writeProfileAudit(client, actor.id, "ADMIN_PASSWORD_CHANGED", actor.id, "Administrator changed own password", {
      revokedOtherSessionCount: revoked.rowCount ?? 0,
    });
  });
}

export async function listOwnAdminSessions(
  pool: DatabasePool,
  actor: PlatformAdminContext,
): Promise<AdminSessionSummary[]> {
  const result = await pool.query<AdminSessionRow>(
    `SELECT id,device_key,platform,created_at,last_used_at,expires_at,revoked_at
     FROM platform_admin_sessions
     WHERE platform_user_id=$1 AND revoked_at IS NULL AND expires_at>now()
     ORDER BY created_at DESC,id`,
    [actor.id],
  );
  return result.rows.map((row) => ({
    id: row.id,
    deviceKey: row.device_key,
    platform: row.platform,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    current: row.id === actor.sessionId,
  }));
}

export async function revokeOwnAdminSession(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  sessionId: string,
): Promise<void> {
  if (!isUuid(sessionId)) throw new PlatformAdminError("Administrator session was not found", 404, "ADMIN_SESSION_NOT_FOUND");
  await withTransaction(pool, async (client) => {
    const found = await client.query<AdminSessionRow>(
      `SELECT id,device_key,platform,created_at,last_used_at,expires_at,revoked_at
       FROM platform_admin_sessions
       WHERE id=$1 AND platform_user_id=$2
       FOR UPDATE`,
      [sessionId, actor.id],
    );
    const session = found.rows[0];
    if (!session) throw new PlatformAdminError("Administrator session was not found", 404, "ADMIN_SESSION_NOT_FOUND");
    if (session.id === actor.sessionId) {
      throw new PlatformAdminError("Use sign out to end the current session", 400, "ADMIN_SESSION_CURRENT");
    }
    if (!session.revoked_at) {
      await client.query("UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1", [session.id]);
      await writeProfileAudit(client, actor.id, "ADMIN_SESSION_REVOKED", session.id, "Administrator revoked own session", {
        deviceKey: session.device_key,
        platform: session.platform,
      }, "PLATFORM_ADMIN_SESSION");
    }
  });
}

function mapProfile(row: PlatformUserProfileRow): AdminProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  };
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string") throw new PlatformAdminError("A valid email address is required", 400, "ADMIN_EMAIL_INVALID");
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PlatformAdminError("A valid email address is required", 400, "ADMIN_EMAIL_INVALID");
  }
  return email;
}

function parseDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new PlatformAdminError("Display name is required", 400, "ADMIN_DISPLAY_NAME_INVALID");
  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 120) {
    throw new PlatformAdminError("Display name must be between 2 and 120 characters", 400, "ADMIN_DISPLAY_NAME_INVALID");
  }
  return displayName;
}

function requirePassword(value: unknown, message: string, code: string): string {
  if (typeof value !== "string" || !value) throw new PlatformAdminError(message, 400, code);
  return value;
}

async function writeProfileAudit(
  client: DatabaseClient,
  platformUserId: string,
  eventType: string,
  entityId: string,
  reason: string,
  payload: Record<string, unknown>,
  entityType = "PLATFORM_USER",
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [platformUserId, eventType, entityType, entityId, reason, JSON.stringify(payload)],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
