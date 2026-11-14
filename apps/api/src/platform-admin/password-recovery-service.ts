import { randomBytes } from "node:crypto";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { hashPassword, normalizeEmail, tokenHash, verifyPassword } from "../auth/security.js";
import type { PasswordResetMail } from "../auth/password-recovery-mail.js";
import { PlatformAdminError } from "./security.js";

const GENERIC = "If an active administrator account uses that address, recovery instructions will be sent.";

type Options = {
  publicOrigin: string;
  deliver: (mail: PasswordResetMail) => Promise<void>;
  reportDeliveryFailure?: () => void;
};

/**
 * Separate administrator identity, cooldown, token namespace and mail origin.
 * Neither merchant access tokens nor merchant recovery tokens are accepted.
 */
export async function requestPlatformPasswordReset(
  pool: DatabasePool,emailInput:unknown,options:Options,
):Promise<{message:string}> {
  if(typeof emailInput!=="string" || emailInput.length>254) {
    throw new PlatformAdminError("A valid email is required",400,"ADMIN_RECOVERY_EMAIL_INVALID");
  }
  let email:string|null;
  try { email=normalizeEmail(emailInput); } catch {
    throw new PlatformAdminError("A valid email is required",400,"ADMIN_RECOVERY_EMAIL_INVALID");
  }
  if(!email)throw new PlatformAdminError("A valid email is required",400,"ADMIN_RECOVERY_EMAIL_INVALID");

  const issued=await withTransaction(pool,async(tx)=>{
    const rows=await tx.query<{id:string;email:string}>(
      "SELECT id,email FROM platform_users WHERE lower(email)=$1 "+
      "AND is_active=true AND password_hash IS NOT NULL FOR UPDATE",
      [email],
    );
    const account=rows.rows[0];
    if(!account)return null;
    const recent=await tx.query<{n:number;cooldown:boolean}>(
      "SELECT COUNT(*) FILTER (WHERE created_at>now()-interval '1 day')::int AS n,"+
      "COALESCE(BOOL_OR(created_at>now()-interval '5 minutes'),false) AS cooldown "+
      "FROM password_recovery_tokens WHERE platform_user_id=$1",
      [account.id],
    );
    if(recent.rows[0]!.n>=5 || recent.rows[0]!.cooldown) return null;
    await tx.query(
      "UPDATE password_recovery_tokens SET consumed_at=now() "+
      "WHERE platform_user_id=$1 AND consumed_at IS NULL",[account.id],
    );
    const token=randomBytes(32).toString("base64url");
    const row=await tx.query<{id:string}>(
      "INSERT INTO password_recovery_tokens"+
      "(account_kind,platform_user_id,token_hash,email_snapshot,expires_at) "+
      "VALUES('PLATFORM_ADMIN',$1,$2,$3,now()+interval '20 minutes') RETURNING id",
      [account.id,tokenHash(token),email],
    );
    const link=new URL("/reset-password",options.publicOrigin);
    link.hash = "token=" + encodeURIComponent(token);
    return {id:row.rows[0]!.id,to:email,link:link.toString()};
  });
  if(issued){
    try{await options.deliver({to:issued.to,link:issued.link,expiresInMinutes:20});}
    catch{
      await pool.query("UPDATE password_recovery_tokens SET consumed_at=COALESCE(consumed_at,now()) "+
        "WHERE id=$1",[issued.id]);
      options.reportDeliveryFailure?.();
    }
  }
  return {message:GENERIC};
}

export async function confirmPlatformPasswordReset(
  pool:DatabasePool,token:unknown,newPassword:unknown,
):Promise<void> {
  if(typeof token!=="string"||!/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new PlatformAdminError("Reset link is invalid or expired",400,"ADMIN_RECOVERY_TOKEN_INVALID");
  }
  if(typeof newPassword!=="string"||newPassword.length<12||newPassword.length>200){
    throw new PlatformAdminError("Use a password between 12 and 200 characters",400,"ADMIN_RECOVERY_PASSWORD_WEAK");
  }
  const passwordHash=await hashPassword(newPassword);
  await withTransaction(pool,async(tx)=>{
    const res=await tx.query<{id:string;platform_user_id:string;email_snapshot:string}>(
      "SELECT id,platform_user_id,email_snapshot FROM password_recovery_tokens "+
      "WHERE account_kind='PLATFORM_ADMIN' AND token_hash=$1 AND consumed_at IS NULL "+
      "AND expires_at>now() FOR UPDATE",
      [tokenHash(token)],
    );
    const reset=res.rows[0];
    if(!reset)throw new PlatformAdminError("Reset link is invalid or expired",400,"ADMIN_RECOVERY_TOKEN_INVALID");
    const users=await tx.query<{id:string;password_hash:string}>(
      "SELECT id,password_hash FROM platform_users WHERE id=$1 AND lower(email)=$2 "+
      "AND is_active=true AND password_hash IS NOT NULL FOR UPDATE",
      [reset.platform_user_id,reset.email_snapshot],
    );
    const admin=users.rows[0];
    if(!admin)throw new PlatformAdminError("Reset link is invalid or expired",400,"ADMIN_RECOVERY_TOKEN_INVALID");
    if(await verifyPassword(newPassword,admin.password_hash)){
      throw new PlatformAdminError("Choose a different password",400,"ADMIN_RECOVERY_PASSWORD_UNCHANGED");
    }
    await tx.query("UPDATE platform_users SET password_hash=$2,password_changed_at=now(),"+
      "failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1",
    [admin.id,passwordHash]);
    await tx.query("UPDATE platform_admin_sessions SET revoked_at=COALESCE(revoked_at,now()) "+
      "WHERE platform_user_id=$1 AND revoked_at IS NULL",[admin.id]);
    await tx.query("UPDATE password_recovery_tokens SET consumed_at=COALESCE(consumed_at,now()) "+
      "WHERE platform_user_id=$1 AND consumed_at IS NULL",[admin.id]);
    await tx.query("INSERT INTO platform_audit_events"+
      "(platform_user_id,event_type,entity_type,entity_id,reason,payload) "+
      "VALUES($1,'ADMIN_PASSWORD_RECOVERED','PLATFORM_USER',$1,"+
      "'Password reset with single-use email recovery link','{}'::jsonb)",[admin.id]);
  });
}
