import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { applyMigrations, MIGRATION_ADVISORY_LOCK_KEY } from "../src/migrations/migration-runner.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const schemas: string[] = [];
const directories: string[] = [];

afterAll(async () => {
  for (const schema of schemas) await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  await adminPool.end();
});

describe("PostgreSQL migration ledger runner", () => {
  it("applies canonical migrations once in order and skips them on the second run", async () => {
    const fixture = await makeFixture();
    writeMigration(fixture.dir, "0002_second.sql", `BEGIN; CREATE TABLE second_marker(id integer PRIMARY KEY); COMMIT;`);
    writeMigration(fixture.dir, "0001_first.sql", `BEGIN; CREATE TABLE first_marker(id integer PRIMARY KEY); COMMIT;`);

    const first = await applyMigrations(fixture.pool, { migrationDirectory: fixture.dir, releaseSha: "a".repeat(40) });
    const second = await applyMigrations(fixture.pool, { migrationDirectory: fixture.dir, releaseSha: "b".repeat(40) });

    expect(first).toEqual({ applied: ["0001_first.sql", "0002_second.sql"], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: ["0001_first.sql", "0002_second.sql"] });
    const rows = await fixture.pool.query(`SELECT migration_name,state FROM lightworld_schema_migrations ORDER BY migration_name`);
    expect(rows.rows).toEqual([
      { migration_name: "0001_first.sql", state: "APPLIED" },
      { migration_name: "0002_second.sql", state: "APPLIED" },
    ]);
    await fixture.pool.end();
  });

  it("fails closed when an applied migration checksum changes", async () => {
    const fixture = await makeFixture();
    const file = writeMigration(fixture.dir, "0001_once.sql", `BEGIN; CREATE TABLE once_marker(id integer PRIMARY KEY); COMMIT;`);
    await applyMigrations(fixture.pool, { migrationDirectory: fixture.dir });
    fs.appendFileSync(file, "\n-- drift\n");

    await expect(applyMigrations(fixture.pool, { migrationDirectory: fixture.dir })).rejects.toThrow(/checksum/i);
    await fixture.pool.end();
  });

  it("marks a failed migration FAILED and rolls back its schema changes", async () => {
    const fixture = await makeFixture();
    writeMigration(fixture.dir, "0001_broken.sql", `BEGIN; CREATE TABLE must_rollback(id integer); SELECT * FROM table_that_does_not_exist; COMMIT;`);

    await expect(applyMigrations(fixture.pool, { migrationDirectory: fixture.dir })).rejects.toThrow(/0001_broken\.sql/);
    const state = await fixture.pool.query(`SELECT state,error_message FROM lightworld_schema_migrations WHERE migration_name='0001_broken.sql'`);
    expect(state.rows[0]?.state).toBe("FAILED");
    expect(String(state.rows[0]?.error_message ?? "")).toMatch(/table_that_does_not_exist/i);
    const rolledBack = await fixture.pool.query(`SELECT to_regclass('must_rollback')::text AS relation`);
    expect(rolledBack.rows[0]?.relation).toBeNull();
    await fixture.pool.end();
  });

  it("blocks replay when a previous migration is left APPLYING", async () => {
    const fixture = await makeFixture();
    const file = writeMigration(fixture.dir, "0001_interrupted.sql", `BEGIN; CREATE TABLE interrupted_marker(id integer); COMMIT;`);
    await applyMigrations(fixture.pool, { migrationDirectory: fixture.emptyDir });
    await fixture.pool.query(
      `INSERT INTO lightworld_schema_migrations(migration_name,checksum_sha256,state,started_at)
       VALUES($1,$2,'APPLYING',now())`,
      ["0001_interrupted.sql", sha256(file)],
    );

    await expect(applyMigrations(fixture.pool, { migrationDirectory: fixture.dir })).rejects.toThrow(/APPLYING|incomplete|interrupted/i);
    const relation = await fixture.pool.query(`SELECT to_regclass('interrupted_marker')::text AS relation`);
    expect(relation.rows[0]?.relation).toBeNull();
    await fixture.pool.end();
  });

  it("rejects noncanonical SQL filenames and duplicate sequence numbers before execution", async () => {
    const invalid = await makeFixture();
    writeMigration(invalid.dir, "create_table.sql", `CREATE TABLE should_not_run(id integer);`);
    await expect(applyMigrations(invalid.pool, { migrationDirectory: invalid.dir })).rejects.toThrow(/canonical|filename/i);
    expect((await invalid.pool.query(`SELECT to_regclass('should_not_run')::text AS relation`)).rows[0]?.relation).toBeNull();
    await invalid.pool.end();

    const duplicate = await makeFixture();
    writeMigration(duplicate.dir, "0001_one.sql", `CREATE TABLE one_marker(id integer);`);
    writeMigration(duplicate.dir, "0001_two.sql", `CREATE TABLE two_marker(id integer);`);
    await expect(applyMigrations(duplicate.pool, { migrationDirectory: duplicate.dir })).rejects.toThrow(/duplicate|sequence/i);
    await duplicate.pool.end();
  });

  it("wraps legacy nontransactional migrations so failures still roll back atomically", async () => {
    const fixture = await makeFixture();
    writeMigration(
      fixture.dir,
      "0001_nontransactional.sql",
      `CREATE TABLE unsafe_marker(id integer); SELECT * FROM nontransactional_missing_table;`,
    );

    await expect(applyMigrations(fixture.pool, { migrationDirectory: fixture.dir })).rejects.toThrow(/0001_nontransactional\.sql/);
    const state = await fixture.pool.query(`SELECT state FROM lightworld_schema_migrations WHERE migration_name='0001_nontransactional.sql'`);
    expect(state.rows[0]?.state).toBe("FAILED");
    expect((await fixture.pool.query(`SELECT to_regclass('unsafe_marker')::text AS relation`)).rows[0]?.relation).toBeNull();
    await fixture.pool.end();
  });

  it("waits for the PostgreSQL advisory lock before applying migrations", async () => {
    const fixture = await makeFixture();
    writeMigration(fixture.dir, "0001_locked.sql", `BEGIN; CREATE TABLE locked_marker(id integer); COMMIT;`);
    const blocker = await fixture.pool.connect();
    await blocker.query(`SELECT pg_advisory_lock($1::bigint)`, [MIGRATION_ADVISORY_LOCK_KEY]);

    let settled = false;
    const pending = applyMigrations(fixture.pool, { migrationDirectory: fixture.dir }).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);
    await blocker.query(`SELECT pg_advisory_unlock($1::bigint)`, [MIGRATION_ADVISORY_LOCK_KEY]);
    blocker.release();

    await expect(pending).resolves.toEqual({ applied: ["0001_locked.sql"], skipped: [] });
    await fixture.pool.end();
  });
});

async function makeFixture() {
  const schema = `migration_test_${crypto.randomBytes(8).toString("hex")}`;
  schemas.push(schema);
  await adminPool.query(`CREATE SCHEMA ${quoteIdent(schema)}`);
  const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema}` });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tradeos-migrations-"));
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "tradeos-migrations-empty-"));
  directories.push(dir, emptyDir);
  return { schema, pool, dir, emptyDir };
}

function writeMigration(directory: string, name: string, sql: string): string {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${sql}\n`);
  return file;
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
