import { randomBytes } from "node:crypto";
import type { PlatformAdminRole, PlatformAdminSession, PlatformAdminUser, PlatformClient } from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { tokenHash, verifyPassword } from "../auth/security.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const PLATFORMS = new Set<PlatformClient>(["WEB", "WINDOWS", "MACOS", "ANDROID", "IOS"]);

export interface PlatformAdminContext extends PlatformAdminUser {
  sessionId: string;
  deviceKey: string;
  platform: PlatformClient;
  expiresAt: string;
  idleExpiresAt: string;
}

interface PlatformUserRow {
  id: string;
  email: string;
  display_name: string;
  role: PlatformAdminRole;
  is_active: boolean;
  password_hash: string | null;
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at: Date | null;
}

interface PlatformSessionRow extends PlatformUserRow {
  session_id: string;
  platform: PlatformClient;
  device_key: string;
  expires_at: Date;
}

export class PlatformAdminError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
  }
}

export async function loginPlatformAdmin(
  pool: DatabasePool,
  input: { identifier?: unknown; password?: unknown; platform?: unknown; deviceKey?: unknown },
): Promise<{ adminUser: PlatformAdminUser; session: PlatformAdminSession; sessionToken: string }> {
  const identifier = requireString(input.identifier, "Email is required", "ADMIN_IDENTIFIER_REQUIRED").trim().toLowerCase();
  const password = requireString(input.password, "Password is required", "ADMIN_PASSWORD_REQUIRED");
  const platform = parsePlatform(input.platform);
  const deviceKey = parseDeviceKey(input.deviceKey);

  const attempt = await withTransaction(pool, async (client) => {
    const found = await client.query<PlatformUserRow>(
      `SELECT id,email,display_name,role,is_active,password_hash,failed_login_count,locked_until,last_login_at
       FROM platform_users
       WHERE lower(email)=$1
       LIMIT 1
       FOR UPDATE`,
      [identifier],
    );
    const row = found.rows[0];
    if (!row || !row.is_active || !row.password_hash) return { ok: false as const };
    if (row.locked_until && row.locked_until.getTime() > Date.now()) return { ok: false as const };

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      const failedCount = row.failed_login_count + 1;
      const lockNow = failedCount >= MAX_FAILED_LOGINS;
      await client.query(
        `UPDATE platform_users
         SET failed_login_count=$2,
             locked_until=CASE WHEN $3 THEN now()+interval '15 minutes' ELSE locked_until END,
             updated_at=now()
         WHERE id=$1`,
        [row.id, failedCount, lockNow],
      );
      if (lockNow) {
        await writePlatformAudit(client, row.id, "ADMIN_LOGIN_LOCKED", "Repeated failed administrator sign-in attempts");
      }
      return { ok: false as const };
    }

    const issued = await issuePlatformAdminSession(client, { platformUserId: row.id, platform, deviceKey });
    const updated = await client.query<PlatformUserRow>(
      `UPDATE platform_users
       SET last_login_at=now(),failed_login_count=0,locked_until=NULL,updated_at=now()
       WHERE id=$1
       RETURNING id,email,display_name,role,is_active,password_hash,failed_login_count,locked_until,last_login_at`,
      [row.id],
    );
    await writePlatformAudit(client, row.id, "ADMIN_LOGIN_SUCCEEDED", "Administrator signed in");
    return { ok: true as const, row: updated.rows[0]!, issued };
  });

  if (!attempt.ok) {
    throw new PlatformAdminError("Email or password is incorrect", 401, "ADMIN_LOGIN_REJECTED");
  }
  return {
    adminUser: mapUser(attempt.row),
    session: attempt.issued.session,
    sessionToken: attempt.issued.sessionToken,
  };
}

export async function authenticatePlatformAdmin(
  pool: DatabasePool,
  sessionToken: string | undefined,
): Promise<PlatformAdminContext> {
  if (!sessionToken?.startsWith("tos_admin_session_")) {
    throw new PlatformAdminError("Platform administrator authentication is required", 401, "ADMIN_AUTH_REQUIRED");
  }

  const found = await pool.query<PlatformSessionRow>(
    `SELECT s.id AS session_id,s.platform,s.device_key,s.expires_at,
            u.id,u.email,u.display_name,u.role,u.is_active,u.password_hash,
            u.failed_login_count,u.locked_until,u.last_login_at
     FROM platform_admin_sessions s
     JOIN platform_users u ON u.id=s.platform_user_id
     WHERE s.session_token_hash=$1
       AND s.expires_at > now()
       AND s.last_used_at > now() - interval '30 minutes'
       AND s.revoked_at IS NULL
       AND u.is_active=true`,
    [tokenHash(sessionToken)],
  );
  const row = found.rows[0];
  if (!row) {
    throw new PlatformAdminError("Platform administrator session is expired or revoked", 401, "ADMIN_SESSION_EXPIRED");
  }

  await pool.query(`UPDATE platform_admin_sessions SET last_used_at=now() WHERE id=$1`, [row.session_id]);
  return {
    ...mapUser(row),
    sessionId: row.session_id,
    platform: row.platform,
    deviceKey: row.device_key,
    expiresAt: row.expires_at.toISOString(),
    idleExpiresAt: new Date(Date.now() + IDLE_TTL_MS).toISOString(),
  };
}

export async function logoutPlatformAdmin(
  pool: DatabasePool,
  sessionId: string,
  platformUserId: string,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE platform_admin_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND platform_user_id=$2`,
      [sessionId, platformUserId],
    );
    await writePlatformAudit(client, platformUserId, "ADMIN_LOGOUT", "Administrator signed out");
  });
}

async function issuePlatformAdminSession(
  client: DatabaseClient,
  input: { platformUserId: string; platform: PlatformClient; deviceKey: string },
): Promise<{ sessionToken: string; session: PlatformAdminSession }> {
  const sessionToken = `tos_admin_session_${randomBytes(40).toString("base64url")}`;
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS);
  const idleExpiresAt = new Date(now + IDLE_TTL_MS);
  await client.query(
    `INSERT INTO platform_admin_sessions(
       platform_user_id,device_key,platform,session_token_hash,expires_at,last_used_at
     ) VALUES($1,$2,$3,$4,$5,now())`,
    [input.platformUserId, input.deviceKey, input.platform, tokenHash(sessionToken), expiresAt],
  );
  return {
    sessionToken,
    session: { expiresAt: expiresAt.toISOString(), idleExpiresAt: idleExpiresAt.toISOString() },
  };
}

async function writePlatformAudit(
  client: DatabaseClient,
  platformUserId: string,
  eventType: "ADMIN_LOGIN_LOCKED" | "ADMIN_LOGIN_SUCCEEDED" | "ADMIN_LOGOUT",
  reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,'PLATFORM_USER',$3,$4,'{}'::jsonb)`,
    [platformUserId, eventType, platformUserId, reason],
  );
}

function mapUser(row: PlatformUserRow): PlatformAdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
  };
}

function parsePlatform(value: unknown): PlatformClient {
  if (typeof value !== "string" || !PLATFORMS.has(value as PlatformClient)) {
    throw new PlatformAdminError("A supported platform is required", 400, "ADMIN_PLATFORM_INVALID");
  }
  return value as PlatformClient;
}

function parseDeviceKey(value: unknown): string {
  const deviceKey = requireString(value, "deviceKey is required", "ADMIN_DEVICE_REQUIRED").trim();
  if (!deviceKey || deviceKey.length > 200) {
    throw new PlatformAdminError("A valid deviceKey is required", 400, "ADMIN_DEVICE_REQUIRED");
  }
  return deviceKey;
}

function requireString(value: unknown, message: string, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PlatformAdminError(message, 400, code);
  return value;
}
