import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { hashPassword, tokenHash, verifyPassword } from "../src/auth/security.js";
import {
  requestMerchantPasswordReset,confirmMerchantPasswordReset,
} from "../src/auth/password-recovery-service.js";
import {
  requestPlatformPasswordReset,confirmPlatformPasswordReset,
} from "../src/platform-admin/password-recovery-service.js";
import { passwordRecoveryMailSettings } from "../src/auth/password-recovery-mail.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,platform_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});

const MERCHANT_PW="original-merchant-password";
const ADMIN_PW="original-platform-admin-password";
const NEW_MERCHANT_PW="new-tradeos-password-2026";
const NEW_ADMIN_PW="new-secure-admin-password-2026";
const ORIGIN="https://tradeosafrica.lightworldtech.com";
const ADMIN_ORIGIN="https://secure-admin.lightworldtech.com";

function capturedMail(origin=ORIGIN){
  const links:string[]=[];
  return {
    links,
    options:{
      publicOrigin:origin,
      deliver:async(mail:{to:string;link:string;expiresInMinutes:number})=>{
        expect(mail.expiresInMinutes).toBe(20);
        expect(new URL(mail.link).origin).toBe(origin);
        links.push(mail.link);
      },
    },
    token:()=>new URL(links.at(-1)??"https://invalid.example").searchParams.get("token")??"",
  };
}
async function merchant(email="forgot-merchant@tradeos.test"){
  const registered=await app.inject({
    method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Recovery Merchant",email,password:MERCHANT_PW,
      platform:"WEB",deviceKey:"forgot-web-device",appVersion:"test"},
  });
  expect(registered.statusCode,registered.body).toBe(201);
  return {
    id:registered.json().user.id as string,
    access:registered.json().session.accessToken as string,
    refresh:registered.json().session.refreshToken as string,
    email,
  };
}
async function admin(email="forgot-admin@tradeos.test"){
  const passwordHash=await hashPassword(ADMIN_PW);
  const res=await pool.query<{id:string}>(
    "INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at) "+
    "VALUES($1,'Recovery Admin','SUPER_ADMIN',true,$2,now()) RETURNING id",
    [email,passwordHash],
  );
  return {id:res.rows[0]!.id,email};
}

describe("TradeOS merchant email-password recovery",()=>{
  it("issues a hashed, one-time 20 minute link, changes password and revokes every session",async()=>{
    const u=await merchant();
    const mail=capturedMail();
    const requested=await requestMerchantPasswordReset(pool,u.email,mail.options);
    expect(requested.message).toMatch(/if this email belongs/i);
    expect(mail.links).toHaveLength(1);
    const token=mail.token();
    expect(token.length).toBeGreaterThanOrEqual(40);
    const row=await pool.query<{token_hash:string;email_snapshot:string;minutes:number;consumed_at:Date|null}>(
      "SELECT token_hash,email_snapshot,"+
      "ROUND(EXTRACT(EPOCH FROM(expires_at-created_at))/60)::int AS minutes,consumed_at "+
      "FROM password_recovery_tokens WHERE app_user_id=$1",
      [u.id],
    );
    expect(row.rows[0]).toMatchObject({
      token_hash:tokenHash(token),email_snapshot:u.email,minutes:20,consumed_at:null,
    });
    expect(row.rows[0]!.token_hash).not.toBe(token);

    await confirmMerchantPasswordReset(pool,token,NEW_MERCHANT_PW);
    expect((await app.inject({
      method:"GET",url:"/v1/me",headers:{authorization:"Bearer "+u.access},
    })).statusCode).toBe(401);
    expect((await app.inject({
      method:"POST",url:"/v1/auth/refresh",payload:{refreshToken:u.refresh},
    })).statusCode).toBe(401);
    const old=await app.inject({method:"POST",url:"/v1/auth/login",payload:{
      identifier:u.email,password:MERCHANT_PW,platform:"WEB",
      deviceKey:"web-relogin",appVersion:"test",
    }});
    expect(old.statusCode).toBe(401);
    const next=await app.inject({method:"POST",url:"/v1/auth/login",payload:{
      identifier:u.email,password:NEW_MERCHANT_PW,platform:"WEB",
      deviceKey:"web-new-password",appVersion:"test",
    }});
    expect(next.statusCode,next.body).toBe(200);
    await expect(confirmMerchantPasswordReset(pool,token,"third-password-2026"))
      .rejects.toMatchObject({code:"RESET_TOKEN_INVALID"});
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM account_security_events "+
      "WHERE user_id=$1 AND event_type='PASSWORD_RESET_COMPLETED'",[u.id])).rows[0].n).toBe(1);
  });

  it("does not disclose non-existent emails and rate limits repeated requests",async()=>{
    const u=await merchant();
    const mail=capturedMail();
    const first=await requestMerchantPasswordReset(pool,u.email,mail.options);
    const repeat=await requestMerchantPasswordReset(pool,u.email,mail.options);
    const unknown=await requestMerchantPasswordReset(pool,"unknown@tradeos.test",mail.options);
    expect(first).toEqual(repeat);
    expect(first).toEqual(unknown);
    expect(mail.links).toHaveLength(1);
    const count=await pool.query<{n:number}>(
      "SELECT COUNT(*)::int AS n FROM password_recovery_tokens WHERE app_user_id=$1",
      [u.id],
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it("invalidates a failed email delivery, old email changes and expired tokens",async()=>{
    const u=await merchant();
    const failedMail=capturedMail();
    const requested=await requestMerchantPasswordReset(pool,u.email,{
      publicOrigin:ORIGIN,
      deliver:async(mail)=>{
        failedMail.links.push(mail.link);
        throw new Error("SMTP rejected");
      },
    });
    expect(requested.message).toMatch(/if this email belongs/i);
    await expect(confirmMerchantPasswordReset(pool,failedMail.token(),NEW_MERCHANT_PW))
      .rejects.toMatchObject({code:"RESET_TOKEN_INVALID"});
    await pool.query("UPDATE password_recovery_tokens "+
      "SET created_at=now()-interval '2 days' WHERE app_user_id=$1",[u.id]);
    const delivered=capturedMail();
    await requestMerchantPasswordReset(pool,u.email,delivered.options);
    expect(delivered.links).toHaveLength(1);
    await pool.query("UPDATE app_users SET email='updated@tradeos.test' WHERE id=$1",[u.id]);
    await expect(confirmMerchantPasswordReset(pool,delivered.token(),NEW_MERCHANT_PW))
      .rejects.toMatchObject({code:"RESET_TOKEN_INVALID"});
    await pool.query("UPDATE app_users SET email=$2 WHERE id=$1",[u.id,u.email]);
    await pool.query("UPDATE password_recovery_tokens "+
      "SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' "+
      "WHERE token_hash=$1",[tokenHash(delivered.token())]);
    await expect(confirmMerchantPasswordReset(pool,delivered.token(),NEW_MERCHANT_PW))
      .rejects.toMatchObject({code:"RESET_TOKEN_INVALID"});
  });

  it("keeps password unchanged for invalid links and refuses same-old passwords",async()=>{
    const u=await merchant();
    const mail=capturedMail();
    await requestMerchantPasswordReset(pool,u.email,mail.options);
    await expect(confirmMerchantPasswordReset(pool,"garbage","longer-valid-password"))
      .rejects.toMatchObject({code:"RESET_TOKEN_INVALID"});
    await expect(confirmMerchantPasswordReset(pool,mail.token(),"short"))
      .rejects.toMatchObject({code:"WEAK_PASSWORD"});
    await expect(confirmMerchantPasswordReset(pool,mail.token(),MERCHANT_PW))
      .rejects.toMatchObject({code:"PASSWORD_UNCHANGED"});
    const row=await pool.query<{password_hash:string}>(
      "SELECT password_hash FROM app_users WHERE id=$1",[u.id],
    );
    expect(await verifyPassword(MERCHANT_PW,row.rows[0]!.password_hash)).toBe(true);
  });
});

describe("separate privileged administrator email recovery",()=>{
  it("never accepts a merchant token to reset a platform administrator",async()=>{
    const m=await merchant();
    const a=await admin();
    const merchantMail=capturedMail();
    const adminMail=capturedMail(ADMIN_ORIGIN);
    await requestMerchantPasswordReset(pool,m.email,merchantMail.options);
    await requestPlatformPasswordReset(pool,a.email,adminMail.options);
    expect(adminMail.links).toHaveLength(1);
    await expect(confirmPlatformPasswordReset(pool,merchantMail.token(),NEW_ADMIN_PW))
      .rejects.toMatchObject({code:"ADMIN_RECOVERY_TOKEN_INVALID"});
    await expect(confirmMerchantPasswordReset(pool,adminMail.token(),NEW_MERCHANT_PW))
      .rejects.toMatchObject({code:"RESET_TOKEN_INVALID"});
    await expect(confirmPlatformPasswordReset(pool,adminMail.token(),"too-short"))
      .rejects.toMatchObject({code:"ADMIN_RECOVERY_PASSWORD_WEAK"});
    await confirmPlatformPasswordReset(pool,adminMail.token(),NEW_ADMIN_PW);
    await expect(confirmPlatformPasswordReset(pool,adminMail.token(),"another-new-password-2026"))
      .rejects.toMatchObject({code:"ADMIN_RECOVERY_TOKEN_INVALID"});
    const row=await pool.query<{password_hash:string;failed_login_count:number}>(
      "SELECT password_hash,failed_login_count FROM platform_users WHERE id=$1",[a.id],
    );
    expect(await verifyPassword(NEW_ADMIN_PW,row.rows[0]!.password_hash)).toBe(true);
    expect(row.rows[0]!.failed_login_count).toBe(0);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM platform_audit_events "+
      "WHERE platform_user_id=$1 AND event_type='ADMIN_PASSWORD_RECOVERED'",[a.id])).rows[0]!.n).toBe(1);
  });

  it("administrator reset revokes pre-existing active platform sessions",async()=>{
    const a=await admin("sessions@tradeos.test");
    const login=await app.inject({method:"POST",url:"/api/admin/session/login",payload:{
      identifier:a.email,password:ADMIN_PW,platform:"WEB",deviceKey:"recovery-admin-test",
    }});
    expect(login.statusCode,login.body).toBe(200);
    const cookie=login.headers["set-cookie"];
    const value=Array.isArray(cookie)?cookie[0]!:cookie!;
    const mail=capturedMail(ADMIN_ORIGIN);
    await requestPlatformPasswordReset(pool,a.email,mail.options);
    await confirmPlatformPasswordReset(pool,mail.token(),NEW_ADMIN_PW);
    const stale=await app.inject({
      method:"GET",url:"/api/admin/session/me",headers:{cookie:value.split(";")[0]!},
    });
    expect(stale.statusCode).toBe(401);
    const fresh=await app.inject({method:"POST",url:"/api/admin/session/login",payload:{
      identifier:a.email,password:NEW_ADMIN_PW,platform:"WEB",deviceKey:"new-admin-test",
    }});
    expect(fresh.statusCode,fresh.body).toBe(200);
  });
});

describe("recovery mail configuration",()=>{
  it("requires explicit HTTPS origins and sender address",()=>{
    expect(passwordRecoveryMailSettings({
      TRADEOS_PASSWORD_RESET_FROM:"mail@lightworldtech.com",
      TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN:ORIGIN,
      TRADEOS_SENDMAIL_PATH:"/usr/sbin/sendmail",
    })).toEqual({
      sender:"mail@lightworldtech.com",publicOrigin:ORIGIN,
      sendmailPath:"/usr/sbin/sendmail",
    });
    expect(passwordRecoveryMailSettings({
      TRADEOS_PASSWORD_RESET_FROM:"mail@lightworldtech.com",
      TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN:"http://localhost:3036",
    })).toBeNull();
    expect(passwordRecoveryMailSettings({
      TRADEOS_PASSWORD_RESET_FROM:"evil\r\nBcc:attacker@ex.test",
      TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN:ORIGIN,
    })).toBeNull();
  });
});
