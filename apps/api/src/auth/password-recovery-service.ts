import { randomBytes } from "node:crypto";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { AuthError, hashPassword, normalizeEmail, tokenHash, verifyPassword } from "./security.js";
import type { PasswordResetMail } from "./password-recovery-mail.js";

const TOKEN_TTL_MINUTES = 20;
const GENERIC_REPLY =
  "If this email belongs to an active TradeOS account, a reset link will be sent. Check your inbox and spam folder.";

type RecoveryOptions = {
  publicOrigin: string;
  deliver: (mail: PasswordResetMail) => Promise<void>;
  reportDeliveryFailure?: (error: unknown) => void;
};
type UserRow = { id: string; email: string; status: string };
type TokenRow = {
  id: string; app_user_id: string | null; platform_user_id: string | null;
  email_snapshot: string; expires_at: Date;
};

/**
 * A recovery request never confirms whether the address is registered.
 * Limits mail to one request every five minutes and five per rolling day
 * for each active account. No token or email is written to logs.
 */
export async function requestMerchantPasswordReset(
  pool: DatabasePool, emailInput: unknown, options: RecoveryOptions,
): Promise<{ message: string }> {
  if (typeof emailInput !== "string" || emailInput.length > 254) {
    throw new AuthError("Enter a valid email address", 400, "RESET_EMAIL_INVALID");
  }
  const email = normalizeEmail(emailInput);
  if (!email) throw new AuthError("Enter a valid email address", 400, "RESET_EMAIL_INVALID");
  const issued = await withTransaction(pool, async (client) => {
    const found = await client.query<UserRow>(
      "SELECT id,email,status FROM app_users WHERE lower(email)=$1 LIMIT 1 FOR UPDATE",
      [email],
    );
    const user = found.rows[0];
    if (!user || user.status !== "ACTIVE") return null;
    const history = await client.query<{ count_day: number; recent: boolean }>(
      "SELECT COUNT(*) FILTER (WHERE created_at > now()-interval '1 day')::int AS count_day," +
      "COALESCE(BOOL_OR(created_at > now()-interval '5 minutes'),false) AS recent " +
      "FROM password_recovery_tokens WHERE app_user_id=$1", [user.id],
    );
    if (history.rows[0]!.recent || history.rows[0]!.count_day >= 5) return null;
    await client.query(
      "UPDATE password_recovery_tokens SET consumed_at=now() " +
      "WHERE app_user_id=$1 AND consumed_at IS NULL",
      [user.id],
    );
    const token = randomBytes(32).toString("base64url");
    const saved = await client.query<{ id: string }>(
      "INSERT INTO password_recovery_tokens(" +
      "account_kind,app_user_id,token_hash,email_snapshot,expires_at) " +
      "VALUES('MERCHANT',$1,$2,$3,now()+interval '20 minutes') RETURNING id",
      [user.id, tokenHash(token), email],
    );
    const url = new URL("/reset-password", options.publicOrigin);
    url.searchParams.set("token", token);
    return { id: saved.rows[0]!.id, email, link: url.toString() };
  });
  if (issued) {
    try {
      await options.deliver({ to: issued.email, link: issued.link, expiresInMinutes: TOKEN_TTL_MINUTES });
    } catch (error) {
      // A failed submission may not leave an actionable token; no false success
      // about delivery is returned to the caller or an anonymous requestor.
      await pool.query(
        "UPDATE password_recovery_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE id=$1",
        [issued.id],
      );
      options.reportDeliveryFailure?.(error);
    }
  }
  return { message: GENERIC_REPLY };
}

/**
 * Consume atomically so two simultaneous requests cannot both reset a password.
 * Every old mobile/desktop/web session is revoked on success.
 */
export async function confirmMerchantPasswordReset(
  pool: DatabasePool, token: unknown, newPassword: unknown,
): Promise<void> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new AuthError("Reset link is invalid or has expired", 400, "RESET_TOKEN_INVALID");
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 200) {
    throw new AuthError("Use a password between 8 and 200 characters", 400, "WEAK_PASSWORD");
  }
  await withTransaction(pool, async (client) => {
    const res = await client.query<TokenRow>(
      "SELECT id,app_user_id,platform_user_id,email_snapshot,expires_at " +
      "FROM password_recovery_tokens " +
      "WHERE token_hash=$1 AND account_kind='MERCHANT' " +
      "AND consumed_at IS NULL AND expires_at > now() FOR UPDATE",
      [tokenHash(token)],
    );
    const reset = res.rows[0];
    if (!reset?.app_user_id) {
      throw new AuthError("Reset link is invalid or has expired", 400, "RESET_TOKEN_INVALID");
    }
    const users = await client.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM app_users " +
      "WHERE id=$1 AND lower(email)=$2 AND status='ACTIVE' FOR UPDATE",
      [reset.app_user_id, reset.email_snapshot],
    );
    const user = users.rows[0];
    if (!user) {
      throw new AuthError("Reset link is invalid or has expired", 400, "RESET_TOKEN_INVALID");
    }
    if (await verifyPassword(newPassword, user.password_hash)) {
      throw new AuthError("Choose a password different from your current password", 400, "PASSWORD_UNCHANGED");
    }
    const hash = await hashPassword(newPassword);
    await client.query(
      "UPDATE app_users SET password_hash=$2,updated_at=now() WHERE id=$1",
      [user.id, hash],
    );
    await client.query(
      "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) " +
      "WHERE user_id=$1 AND revoked_at IS NULL",
      [user.id],
    );
    await client.query(
      "UPDATE password_recovery_tokens SET consumed_at=COALESCE(consumed_at,now()) " +
      "WHERE app_user_id=$1 AND consumed_at IS NULL",
      [user.id],
    );
    await client.query(
      "INSERT INTO account_security_events(user_id,event_type,payload) " +
      "VALUES($1,'PASSWORD_RESET_COMPLETED',$2::jsonb)",
      [user.id, JSON.stringify({ revokedAllSessions: true })],
    );
  });
}
