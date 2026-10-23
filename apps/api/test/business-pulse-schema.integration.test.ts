import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `pulse_schema_test_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

beforeAll(async () => { await adminPool.query(`CREATE SCHEMA ${quotedSchema}`); await applyMigrations(pool, { migrationDirectory }); });
afterAll(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`); await adminPool.end(); });

describe("business intelligence pulse persistence", () => {
  it("stores only a user/business/branch last-seen cursor", async () => {
    expect((await pool.query(`SELECT to_regclass('business_intelligence_pulse_state')::text AS relation`)).rows[0]?.relation).toBe("business_intelligence_pulse_state");
    const columns = await pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='business_intelligence_pulse_state' ORDER BY ordinal_position`);
    expect(columns.rows.map((row) => row.column_name)).toEqual(["id","business_id","branch_id","user_id","last_seen_at","created_at","updated_at"]);
  });

  it("enforces membership scope, branch consistency, and null-safe uniqueness", async () => {
    const b1="91000000-0000-4000-8000-000000000001", b2="92000000-0000-4000-8000-000000000001";
    const br1="91000000-0000-4000-8000-000000000002", br2="92000000-0000-4000-8000-000000000002";
    const u1="91000000-0000-4000-8000-000000000010", u2="91000000-0000-4000-8000-000000000011";
    await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES ($1,'Pulse A','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),($2,'Pulse B','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`,[b1,b2]);
    await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES ($1,$2,'A','MAIN','Africa/Accra',true),($3,$4,'B','MAIN','Africa/Accra',true)`,[br1,b1,br2,b2]);
    await pool.query(`INSERT INTO app_users(id,display_name,email,password_hash,status) VALUES ($1,'Pulse User','pulse@test.local','hash','ACTIVE'),($2,'No Membership','pulse2@test.local','hash','ACTIVE')`,[u1,u2]);
    await pool.query(`INSERT INTO business_memberships(business_id,user_id,role,status) VALUES($1,$2,'OWNER','ACTIVE')`,[b1,u1]);
    await expect(pool.query(`INSERT INTO business_intelligence_pulse_state(business_id,branch_id,user_id) VALUES($1,$2,$3)`,[b1,br1,u1])).resolves.toBeTruthy();
    await expect(pool.query(`INSERT INTO business_intelligence_pulse_state(business_id,branch_id,user_id) VALUES($1,$2,$3)`,[b1,br1,u1])).rejects.toMatchObject({code:"23505"});
    await expect(pool.query(`INSERT INTO business_intelligence_pulse_state(business_id,branch_id,user_id) VALUES($1,$2,$3)`,[b1,br2,u1])).rejects.toMatchObject({code:"23503"});
    await expect(pool.query(`INSERT INTO business_intelligence_pulse_state(business_id,user_id) VALUES($1,$2)`,[b1,u2])).rejects.toMatchObject({code:"23503"});
    await expect(pool.query(`INSERT INTO business_intelligence_pulse_state(business_id,user_id) VALUES($1,$2)`,[b1,u1])).resolves.toBeTruthy();
    await expect(pool.query(`INSERT INTO business_intelligence_pulse_state(business_id,user_id) VALUES($1,$2)`,[b1,u1])).rejects.toMatchObject({code:"23505"});
  });
});
