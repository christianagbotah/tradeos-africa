import { randomBytes } from "node:crypto";
import type { PlatformAdminRole, PlatformAdminSession, PlatformAdminUser, PlatformClient } from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { tokenHash, verifyPassword } from "../auth/security.js";

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLATFORMS = new Set<PlatformClient>(["WEB", "WINDOWS", "MACOS", "ANDROID", "IOS"]);

export interface PlatformAdminContext extends PlatformAdminUser {
  sessionId: string;
  deviceKey: string;
  platform: PlatformClient;
}

interface PlatformUserRow {
  id: string;
  email: string;
  display_name: string;
  role: PlatformAdminRole;
  is_active: boolean;
  password_hash: string | null;
  last_login_at: Date | null;
}

export class PlatformAdminError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function loginPlatformAdmin(
  pool: DatabasePool,
  input: { identifier?: unknown; password?: unknown; platform?: unknown; deviceKey?: unknown },
): Promise<{ adminUser: PlatformAdminUser; session: PlatformAdminSession }> {
  const identifier = requireString(input.identifier, "Email is required", "ADMIN_IDENTIFIER_REQUIRED").trim().toLowerCase();
  const password = requireString(input.password, "Password is required", "ADMIN_PASSWORD_REQUIRED");
  const platform = parsePlatform(input.platform);
  const deviceKey = parseDeviceKey(input.deviceKey);

  const found = await pool.query<PlatformUserRow>(
    `SELECT id,email,display_name,role,is_active,password_hash,last_login_at
     FROM platform_users
     WHERE lower(email)=$1
     LIMIT 1`,
    [identifier],
  );
  const row = found.rows[0];
  if (!row || !row.is_active || !row.password_hash || !(await verifyPassword(password, row.password_hash))) {
    throw new PlatformAdminError("Email or password is incorrect", 401, "ADMIN_LOGIN_REJECTED");
  }

  const result = await withTransaction(pool, async (client) => {
    const session = await issuePlatformAdminSession(client, { platformUserId: row.id, platform, deviceKey });
    const updated = await client.query<PlatformUserRow>(
      `UPDATE platform_users SET last_login_at=now(),updated_at=now()
       WHERE id=$1
       RETURNING id,email,display_name,role,is_active,password_hash,last_login_at`,
      [row.id],
    );
    return { adminUser: mapUser(updated.rows[0]!), session };
  });
  return result;
}

export async function refreshPlatformAdminSession(
  pool: DatabasePool,
  refreshToken: string,
): Promise<{ adminUser: PlatformAdminUser; session: PlatformAdminSession }> {
  if (!refreshToken?.startsWith("tos_admin_refresh_")) {
    throw new PlatformAdminError("Admin refresh token is invalid", 401, "ADMIN_REFRESH_REJECTED");
  }

  return withTransaction(pool, async (client) => {
    const found = await client.query<PlatformUserRow & { session_id: string; platform: PlatformClient; device_key: string }>(
      `SELECT s.id AS session_id,s.platform,s.device_key,
              u.id,u.email,u.display_name,u.role,u.is_active,u.password_hash,u.last_login_at
       FROM platform_admin_sessions s
       JOIN platform_users u ON u.id=s.platform_user_id
       WHERE s.refresh_token_hash=$1
         AND s.refresh_expires_at > now()
         AND s.revoked_at IS NULL
         AND u.is_active=true
       FOR UPDATE`,
      [tokenHash(refreshToken)],
    );
    const row = found.rows[0];
    if (!row) throw new PlatformAdminError("Admin refresh token is expired or revoked", 401, "ADMIN_REFRESH_REJECTED");
    await client.query(`UPDATE platform_admin_sessions SET revoked_at=now() WHERE id=$1`, [row.session_id]);
    const session = await issuePlatformAdminSession(client, {
      platformUserId: row.id,
      platform: row.platform,
      deviceKey: row.device_key,
    });
    return { adminUser: mapUser(row), session };
  });
}

export async function authenticatePlatformAdmin(
  pool: DatabasePool,
  authorization: string | undefined,
): Promise<PlatformAdminContext> {
  const token = extractBearer(authorization);
  if (!token.startsWith("tos_admin_access_")) {
    throw new PlatformAdminError("Platform administrator authentication is required", 401, "ADMIN_AUTH_REQUIRED");
  }
  const found = await pool.query<PlatformUserRow & { session_id: string; platform: PlatformClient; device_key: string }>(
    `SELECT s.id AS session_id,s.platform,s.device_key,
            u.id,u.email,u.display_name,u.role,u.is_active,u.password_hash,u.last_login_at
     FROM platform_admin_sessions s
     JOIN platform_users u ON u.id=s.platform_user_id
     WHERE s.access_token_hash=$1
       AND s.access_expires_at > now()
       AND s.revoked_at IS NULL
       AND u.is_active=true`,
    [tokenHash(token)],
  );
  const row = found.rows[0];
  if (!row) throw new PlatformAdminError("Platform administrator session is expired or revoked", 401, "ADMIN_ACCESS_REJECTED");
  await pool.query(`UPDATE platform_admin_sessions SET last_used_at=now() WHERE id=$1`, [row.session_id]);
  return {
    ...mapUser(row),
    sessionId: row.session_id,
    platform: row.platform,
    deviceKey: row.device_key,
  };
}

export async function logoutPlatformAdmin(pool: DatabasePool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE platform_admin_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1`,
    [sessionId],
  );
}

async function issuePlatformAdminSession(
  client: DatabaseClient,
  input: { platformUserId: string; platform: PlatformClient; deviceKey: string },
): Promise<PlatformAdminSession> {
  const accessToken = `tos_admin_access_${randomBytes(32).toString("base64url")}`;
  const refreshToken = `tos_admin_refresh_${randomBytes(40).toString("base64url")}`;
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);
  await client.query(
    `INSERT INTO platform_admin_sessions(
       platform_user_id,device_key,platform,access_token_hash,refresh_token_hash,
       access_expires_at,refresh_expires_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.platformUserId,
      input.deviceKey,
      input.platform,
      tokenHash(accessToken),
      tokenHash(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    ],
  );
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
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

function extractBearer(authorization: string | undefined): string {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new PlatformAdminError("Platform administrator authentication is required", 401, "ADMIN_AUTH_REQUIRED");
  return token;
}
