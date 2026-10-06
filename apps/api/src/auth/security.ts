import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const scryptAsync = promisify(scryptCallback);
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ClientPlatform = "WEB" | "WINDOWS" | "MACOS" | "ANDROID" | "IOS";

export interface AuthContext {
  sessionId: string;
  userId: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  platform: ClientPlatform;
  deviceKey: string;
  appVersion: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:v1:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, saltEncoded, hashEncoded] = encoded.split(":");
  if (algorithm !== "scrypt" || version !== "v1" || !saltEncoded || !hashEncoded) return false;

  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(hashEncoded, "base64url");
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function normalizeEmail(value: string | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("A valid email address is required", 400, "INVALID_EMAIL");
  }
  return email;
}

export function normalizePhone(value: string | undefined): string | null {
  const phone = value?.trim().replace(/[\s()-]/g, "") ?? "";
  if (!phone) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new AuthError("Phone number must use international format, for example +233...", 400, "INVALID_PHONE");
  }
  return phone;
}

export function assertPlatform(value: unknown): asserts value is ClientPlatform {
  if (!(["WEB", "WINDOWS", "MACOS", "ANDROID", "IOS"] as const).includes(value as ClientPlatform)) {
    throw new AuthError("A supported client platform is required", 400, "INVALID_PLATFORM");
  }
}

export async function issueSession(
  client: DatabaseClient,
  input: { userId: string; platform: ClientPlatform; deviceKey: string; appVersion: string },
): Promise<SessionTokens> {
  if (!input.deviceKey.trim()) throw new AuthError("deviceKey is required", 400, "DEVICE_REQUIRED");
  if (!input.appVersion.trim()) throw new AuthError("appVersion is required", 400, "APP_VERSION_REQUIRED");

  const accessToken = `tos_access_${randomBytes(32).toString("base64url")}`;
  const refreshToken = `tos_refresh_${randomBytes(40).toString("base64url")}`;
  const now = Date.now();
  const accessExpiresAt = new Date(now + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_MS);

  await client.query(
    `INSERT INTO auth_sessions (
       user_id,device_key,platform,app_version,access_token_hash,refresh_token_hash,
       access_expires_at,refresh_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.userId,
      input.deviceKey,
      input.platform,
      input.appVersion,
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

export async function rotateSession(pool: DatabasePool, refreshToken: string): Promise<SessionTokens> {
  if (!refreshToken.startsWith("tos_refresh_")) {
    throw new AuthError("Refresh token is invalid", 401, "INVALID_REFRESH_TOKEN");
  }

  return withTransaction(pool, async (client) => {
    const found = await client.query<{
      id: string;
      user_id: string;
      platform: ClientPlatform;
      device_key: string;
      app_version: string;
    }>(
      `SELECT s.id,s.user_id,s.platform,s.device_key,s.app_version
       FROM auth_sessions s
       JOIN app_users u ON u.id=s.user_id
       WHERE s.refresh_token_hash=$1
         AND s.refresh_expires_at > now()
         AND s.revoked_at IS NULL
         AND u.status='ACTIVE'
       FOR UPDATE`,
      [tokenHash(refreshToken)],
    );
    const prior = found.rows[0];
    if (!prior) throw new AuthError("Refresh token is expired or revoked", 401, "REFRESH_REJECTED");

    await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE id=$1`, [prior.id]);
    return issueSession(client, {
      userId: prior.user_id,
      platform: prior.platform,
      deviceKey: prior.device_key,
      appVersion: prior.app_version,
    });
  });
}

export async function authenticateAccessToken(
  pool: DatabasePool,
  authorization: string | undefined,
): Promise<AuthContext> {
  const token = extractBearerToken(authorization);
  const result = await pool.query<{
    session_id: string;
    user_id: string;
    display_name: string;
    email: string | null;
    phone_e164: string | null;
    platform: ClientPlatform;
    device_key: string;
    app_version: string;
  }>(
    `SELECT s.id AS session_id,u.id AS user_id,u.display_name,u.email,u.phone_e164,
            s.platform,s.device_key,s.app_version
     FROM auth_sessions s
     JOIN app_users u ON u.id=s.user_id
     WHERE s.access_token_hash=$1
       AND s.access_expires_at > now()
       AND s.revoked_at IS NULL
       AND u.status='ACTIVE'`,
    [tokenHash(token)],
  );

  const row = result.rows[0];
  if (!row) throw new AuthError("Access token is expired or revoked", 401, "ACCESS_REJECTED");
  await pool.query(`UPDATE auth_sessions SET last_used_at=now() WHERE id=$1`, [row.session_id]);

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    phoneE164: row.phone_e164,
    platform: row.platform,
    deviceKey: row.device_key,
    appVersion: row.app_version,
  };
}

export async function revokeSession(pool: DatabasePool, sessionId: string): Promise<void> {
  await pool.query(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1`, [sessionId]);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function extractBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) throw new AuthError("Bearer access token is required", 401, "AUTH_REQUIRED");
  return token;
}

function assertPassword(password: string): void {
  if (password.length < 8 || password.length > 200) {
    throw new AuthError("Password must contain at least 8 characters", 400, "WEAK_PASSWORD");
  }
}
