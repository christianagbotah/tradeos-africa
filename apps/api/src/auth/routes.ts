import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import {
  assertPlatform,
  authenticateAccessToken,
  AuthError,
  hashPassword,
  issueSession,
  normalizeEmail,
  normalizePhone,
  revokeSession,
  rotateSession,
  verifyPassword,
  type ClientPlatform,
} from "./security.js";

interface RegisterBody {
  displayName: string;
  email?: string;
  phone?: string;
  password: string;
  platform: ClientPlatform;
  deviceKey: string;
  appVersion: string;
}

interface LoginBody {
  identifier: string;
  password: string;
  platform: ClientPlatform;
  deviceKey: string;
  appVersion: string;
}

interface RefreshBody { refreshToken: string; }

export function registerAuthRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: RegisterBody }>("/v1/auth/register", async (request, reply) => {
    try {
      const body = request.body;
      const displayName = body.displayName?.trim();
      if (!displayName) throw new AuthError("Display name is required", 400, "DISPLAY_NAME_REQUIRED");
      assertPlatform(body.platform);
      if (!body.deviceKey?.trim()) throw new AuthError("deviceKey is required", 400, "DEVICE_REQUIRED");
      if (!body.appVersion?.trim()) throw new AuthError("appVersion is required", 400, "APP_VERSION_REQUIRED");

      const email = normalizeEmail(body.email);
      const phoneE164 = normalizePhone(body.phone);
      if (!email && !phoneE164) {
        throw new AuthError("Email or phone number is required", 400, "IDENTIFIER_REQUIRED");
      }
      const passwordHash = await hashPassword(body.password ?? "");

      const created = await withTransaction(pool, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO app_users (display_name,email,phone_e164,password_hash)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [displayName, email, phoneE164, passwordHash],
        );
        const userId = inserted.rows[0]!.id;
        const session = await issueSession(client, {
          userId,
          platform: body.platform,
          deviceKey: body.deviceKey.trim(),
          appVersion: body.appVersion.trim(),
        });
        return { userId, session };
      });

      return reply.code(201).send({
        user: { id: created.userId, displayName, email, phoneE164 },
        session: created.session,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: "ACCOUNT_EXISTS", message: "An account already uses that email or phone number." });
      }
      return sendAuthError(request, reply, error);
    }
  });

  app.post<{ Body: LoginBody }>("/v1/auth/login", async (request, reply) => {
    try {
      const body = request.body;
      assertPlatform(body.platform);
      if (!body.deviceKey?.trim()) throw new AuthError("deviceKey is required", 400, "DEVICE_REQUIRED");
      if (!body.appVersion?.trim()) throw new AuthError("appVersion is required", 400, "APP_VERSION_REQUIRED");
      const identifier = body.identifier?.trim();
      if (!identifier) throw new AuthError("Email or phone number is required", 400, "IDENTIFIER_REQUIRED");

      const emailCandidate = identifier.toLowerCase();
      const phoneCandidate = identifier.replace(/[\s()-]/g, "");
      const result = await pool.query<{
        id: string;
        display_name: string;
        email: string | null;
        phone_e164: string | null;
        password_hash: string;
        status: string;
      }>(
        `SELECT id,display_name,email,phone_e164,password_hash,status
         FROM app_users
         WHERE lower(email)=$1 OR phone_e164=$2
         LIMIT 1`,
        [emailCandidate, phoneCandidate],
      );
      const user = result.rows[0];
      const valid = user ? await verifyPassword(body.password ?? "", user.password_hash) : false;
      if (!user || !valid || user.status !== "ACTIVE") {
        throw new AuthError("Email/phone or password is incorrect", 401, "LOGIN_REJECTED");
      }

      const session = await withTransaction(pool, (client) => issueSession(client, {
        userId: user.id,
        platform: body.platform,
        deviceKey: body.deviceKey.trim(),
        appVersion: body.appVersion.trim(),
      }));

      return {
        user: { id: user.id, displayName: user.display_name, email: user.email, phoneE164: user.phone_e164 },
        session,
      };
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.post<{ Body: RefreshBody }>("/v1/auth/refresh", async (request, reply) => {
    try {
      if (!request.body.refreshToken) throw new AuthError("refreshToken is required", 400, "REFRESH_REQUIRED");
      return { session: await rotateSession(pool, request.body.refreshToken) };
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      await revokeSession(pool, auth.sessionId);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.get("/v1/me", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const memberships = await pool.query<{
        membership_id: string;
        business_id: string;
        business_name: string;
        business_type: string;
        business_status: string;
        role: string;
        staff_id: string | null;
      }>(
        `SELECT m.id AS membership_id,b.id AS business_id,b.name AS business_name,
                b.business_type,b.status AS business_status,m.role,m.staff_id
         FROM business_memberships m
         JOIN businesses b ON b.id=m.business_id
         WHERE m.user_id=$1 AND m.status='ACTIVE'
         ORDER BY b.created_at`,
        [auth.userId],
      );

      return {
        user: {
          id: auth.userId,
          displayName: auth.displayName,
          email: auth.email,
          phoneE164: auth.phoneE164,
        },
        client: {
          platform: auth.platform,
          deviceKey: auth.deviceKey,
          appVersion: auth.appVersion,
        },
        memberships: memberships.rows.map((row) => ({
          id: row.membership_id,
          businessId: row.business_id,
          businessName: row.business_name,
          businessType: row.business_type,
          businessStatus: row.business_status,
          role: row.role,
          staffId: row.staff_id,
        })),
      };
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });
}

function sendAuthError(request: { log: { error: (error: unknown) => void } }, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "AUTH_FAILED", message: "The authentication request could not be completed." });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
