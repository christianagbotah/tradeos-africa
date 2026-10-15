import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { provisionPlatformAdmin } from "../src/platform-admin/provision.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

beforeAll(async () => {
  await pool.query("SELECT 1");
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE platform_admin_sessions, platform_users CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("platform administrator provisioning", () => {
  it("upserts case-insensitively and returns only safe identity metadata", async () => {
    await pool.query(
      `INSERT INTO platform_users(email,display_name,role,is_active,password_hash)
       VALUES('OPS@TRADEOS.TEST','Old Name','SUPPORT',false,NULL)`,
    );

    const provisioned = await provisionPlatformAdmin(pool, {
      email: "ops@tradeos.test",
      displayName: "Platform Owner",
      role: "SUPER_ADMIN",
      password: "a-strong-platform-password",
    });

    expect(provisioned).toMatchObject({
      email: "ops@tradeos.test",
      displayName: "Platform Owner",
      role: "SUPER_ADMIN",
    });
    expect(JSON.stringify(provisioned)).not.toMatch(/password|hash/i);

    const rows = await pool.query<{ email: string; display_name: string; role: string; is_active: boolean; password_hash: string | null }>(
      `SELECT email,display_name,role,is_active,password_hash FROM platform_users WHERE lower(email)='ops@tradeos.test'`,
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ email: "ops@tradeos.test", display_name: "Platform Owner", role: "SUPER_ADMIN", is_active: true });
    expect(rows.rows[0]?.password_hash).toMatch(/^scrypt:v1:/);
  });

  it("requires a platform-admin password of at least 12 characters", async () => {
    await expect(provisionPlatformAdmin(pool, {
      email: "weak-password@tradeos.test",
      displayName: "Weak Password",
      role: "SUPPORT",
      password: "short123",
    })).rejects.toMatchObject({ code: "ADMIN_PASSWORD_WEAK" });
    const rows = await pool.query("SELECT 1 FROM platform_users WHERE lower(email)='weak-password@tradeos.test'");
    expect(rows.rowCount).toBe(0);
  });

  it("rejects unsupported roles before changing the database", async () => {
    await expect(provisionPlatformAdmin(pool, {
      email: "bad-role@tradeos.test",
      displayName: "Bad Role",
      role: "OWNER",
      password: "a-strong-platform-password",
    })).rejects.toMatchObject({ code: "ADMIN_ROLE_INVALID" });
    const rows = await pool.query("SELECT 1 FROM platform_users WHERE lower(email)='bad-role@tradeos.test'");
    expect(rows.rowCount).toBe(0);
  });
});
