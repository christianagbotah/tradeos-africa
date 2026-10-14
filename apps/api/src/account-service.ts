import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";
import {
  AuthError,
  hashPassword,
  normalizeEmail,
  normalizePhone,
  verifyPassword,
  type AuthContext,
  type ClientPlatform,
} from "./auth/security.js";

export interface AccountProfileUpdateRequest {
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  currentPassword?: string;
}

export interface AccountProfile {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  avatarUrl: string | null;
}

export interface AccountSessionView {
  id: string;
  deviceKey: string;
  platform: ClientPlatform;
  appVersion: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  refreshExpiresAt: string;
}

export async function updateOwnProfile(
  pool: DatabasePool,
  auth: AuthContext,
  input: AccountProfileUpdateRequest,
): Promise<AccountProfile> {
  try {
    return await withTransaction(pool, async (client) => {
      const current = await client.query<{
        id: string;
        display_name: string;
        email: string | null;
        phone_e164: string | null;
        avatar_url: string | null;
        password_hash: string;
      }>(
        `SELECT id,display_name,email,phone_e164,avatar_url,password_hash
         FROM app_users WHERE id=$1 FOR UPDATE`,
        [auth.userId],
      );
      const row = current.rows[0];
      if (!row) throw new AuthError("Account was not found", 404, "ACCOUNT_NOT_FOUND");

      const displayName = input.displayName === undefined ? row.display_name : validateDisplayName(input.displayName);
      const avatarUrl = input.avatarUrl === undefined ? row.avatar_url : validateAvatarUrl(input.avatarUrl);
      const emailProvided = Object.prototype.hasOwnProperty.call(input, "email");
      const phoneProvided = Object.prototype.hasOwnProperty.call(input, "phone");
      const email = emailProvided ? normalizeNullableEmail(input.email) : row.email;
      const phoneE164 = phoneProvided ? normalizeNullablePhone(input.phone) : row.phone_e164;
      const identityChanged = email !== row.email || phoneE164 !== row.phone_e164;

      if (!email && !phoneE164) {
        throw new AuthError("Email or phone number is required", 400, "IDENTIFIER_REQUIRED");
      }
      if (identityChanged) {
        if (!input.currentPassword) {
          throw new AuthError("Current password is required to change email or phone", 400, "CURRENT_PASSWORD_REQUIRED");
        }
        if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
          throw new AuthError("Current password is incorrect", 401, "CURRENT_PASSWORD_REJECTED");
        }
      }

      const updated = await client.query<{
        id: string;
        display_name: string;
        email: string | null;
        phone_e164: string | null;
        avatar_url: string | null;
      }>(
        `UPDATE app_users
         SET display_name=$2,
             email=$3,
             phone_e164=$4,
             avatar_url=$5,
             email_verified_at=CASE WHEN email IS DISTINCT FROM $3 THEN NULL ELSE email_verified_at END,
             phone_verified_at=CASE WHEN phone_e164 IS DISTINCT FROM $4 THEN NULL ELSE phone_verified_at END,
             updated_at=now()
         WHERE id=$1
         RETURNING id,display_name,email,phone_e164,avatar_url`,
        [auth.userId, displayName, email, phoneE164, avatarUrl],
      );

      const changedFields = [
        displayName !== row.display_name ? "displayName" : null,
        email !== row.email ? "email" : null,
        phoneE164 !== row.phone_e164 ? "phone" : null,
        avatarUrl !== row.avatar_url ? "avatarUrl" : null,
      ].filter((value): value is string => Boolean(value));
      await writeAccountEvent(client, auth.userId, "PROFILE_UPDATED", { changedFields });
      return mapProfile(updated.rows[0]!);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthError("An account already uses that email or phone number", 409, "ACCOUNT_EXISTS");
    }
    throw error;
  }
}

export async function changeOwnPassword(
  pool: DatabasePool,
  auth: AuthContext,
  input: { currentPassword?: string; newPassword?: string; revokeOtherSessions?: boolean },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    if (!input.currentPassword) {
      throw new AuthError("Current password is required", 400, "CURRENT_PASSWORD_REQUIRED");
    }
    if (!input.newPassword) {
      throw new AuthError("New password is required", 400, "NEW_PASSWORD_REQUIRED");
    }
    const found = await client.query<{ password_hash: string }>(
      "SELECT password_hash FROM app_users WHERE id=$1 FOR UPDATE",
      [auth.userId],
    );
    const row = found.rows[0];
    if (!row) throw new AuthError("Account was not found", 404, "ACCOUNT_NOT_FOUND");
    if (!(await verifyPassword(input.currentPassword, row.password_hash))) {
      throw new AuthError("Current password is incorrect", 401, "CURRENT_PASSWORD_REJECTED");
    }

    const nextHash = await hashPassword(input.newPassword);
    await client.query("UPDATE app_users SET password_hash=$2,updated_at=now() WHERE id=$1", [auth.userId, nextHash]);
    const revokeOthers = input.revokeOtherSessions !== false;
    let revokedCount = 0;
    if (revokeOthers) {
      const revoked = await client.query(
        `UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now())
         WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
        [auth.userId, auth.sessionId],
      );
      revokedCount = revoked.rowCount ?? 0;
    }
    await writeAccountEvent(client, auth.userId, "PASSWORD_CHANGED", { revokeOtherSessions: revokeOthers, revokedCount });
  });
}

export async function listOwnSessions(pool: DatabasePool, auth: AuthContext): Promise<AccountSessionView[]> {
  const result = await pool.query<{
    id: string;
    device_key: string;
    platform: ClientPlatform;
    app_version: string;
    created_at: Date;
    last_used_at: Date | null;
    refresh_expires_at: Date;
  }>(
    `SELECT id,device_key,platform,app_version,created_at,last_used_at,refresh_expires_at
     FROM auth_sessions
     WHERE user_id=$1 AND revoked_at IS NULL AND refresh_expires_at>now()
     ORDER BY created_at DESC`,
    [auth.userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    deviceKey: row.device_key,
    platform: row.platform,
    appVersion: row.app_version,
    current: row.id === auth.sessionId,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    refreshExpiresAt: row.refresh_expires_at.toISOString(),
  }));
}

export async function revokeOwnSession(pool: DatabasePool, auth: AuthContext, sessionId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const revoked = await client.query(
      `UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now())
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
      [sessionId, auth.userId],
    );
    if (!revoked.rowCount) throw new AuthError("Session was not found", 404, "SESSION_NOT_FOUND");
    await writeAccountEvent(client, auth.userId, "SESSION_REVOKED", {
      sessionId,
      currentSession: sessionId === auth.sessionId,
    });
  });
}

export async function revokeOtherSessions(pool: DatabasePool, auth: AuthContext): Promise<void> {
  await withTransaction(pool, async (client) => {
    const revoked = await client.query(
      `UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now())
       WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
      [auth.userId, auth.sessionId],
    );
    await writeAccountEvent(client, auth.userId, "OTHER_SESSIONS_REVOKED", { revokedCount: revoked.rowCount ?? 0 });
  });
}

function validateDisplayName(value: string): string {
  const displayName = value.trim();
  if (!displayName || displayName.length > 120) {
    throw new AuthError("Display name must contain 1 to 120 characters", 400, "INVALID_DISPLAY_NAME");
  }
  return displayName;
}

function validateAvatarUrl(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > 2048) throw new AuthError("Avatar URL is too long", 400, "INVALID_AVATAR_URL");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new AuthError("Avatar URL must be a valid HTTP or HTTPS URL", 400, "INVALID_AVATAR_URL");
  }
  return trimmed;
}

function normalizeNullableEmail(value: string | null | undefined): string | null {
  return value === null || value === undefined || !value.trim() ? null : normalizeEmail(value);
}

function normalizeNullablePhone(value: string | null | undefined): string | null {
  return value === null || value === undefined || !value.trim() ? null : normalizePhone(value);
}

function mapProfile(row: {
  id: string;
  display_name: string;
  email: string | null;
  phone_e164: string | null;
  avatar_url: string | null;
}): AccountProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    phoneE164: row.phone_e164,
    avatarUrl: row.avatar_url,
  };
}

async function writeAccountEvent(
  client: DatabaseClient,
  userId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    "INSERT INTO account_security_events(user_id,event_type,payload) VALUES($1,$2,$3::jsonb)",
    [userId, eventType, JSON.stringify(payload)],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
