import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

export const MIGRATION_ADVISORY_LOCK_KEY = "8706112026102301";

export interface ApplyMigrationsOptions {
  migrationDirectory: string;
  releaseSha?: string;
}

export interface ApplyMigrationsResult {
  applied: string[];
  skipped: string[];
}

interface LedgerRow {
  migration_name: string;
  checksum_sha256: string;
  state: "APPLYING" | "APPLIED" | "FAILED";
}

interface MigrationFile {
  name: string;
  fullPath: string;
  checksum: string;
}

export async function applyMigrations(
  pool: Pick<Pool, "connect">,
  options: ApplyMigrationsOptions,
): Promise<ApplyMigrationsResult> {
  const migrations = discoverMigrations(options.migrationDirectory);
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  let lockHeld = false;

  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_ADVISORY_LOCK_KEY]);
    lockHeld = true;
    await ensureLedger(client);

    for (const migration of migrations) {
      const existing = await readLedgerRow(client, migration.name);
      if (existing) {
        if (existing.checksum_sha256 !== migration.checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.name}; applied migrations are immutable.`);
        }
        if (existing.state === "APPLIED") {
          skipped.push(migration.name);
          continue;
        }
        throw new Error(`Migration ${migration.name} is ${existing.state}; incomplete migrations require explicit reconciliation.`);
      }

      await client.query(
        `INSERT INTO lightworld_schema_migrations(
           migration_name,checksum_sha256,state,release_sha,started_at
         ) VALUES($1,$2,'APPLYING',$3,now())`,
        [migration.name, migration.checksum, normalizeReleaseSha(options.releaseSha)],
      );

      try {
        const sql = fs.readFileSync(migration.fullPath, "utf8");
        await client.query(sql);
        await client.query(
          `UPDATE lightworld_schema_migrations
           SET state='APPLIED',applied_at=now(),failed_at=NULL,error_message=NULL
           WHERE migration_name=$1`,
          [migration.name],
        );
        applied.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        await client.query(
          `UPDATE lightworld_schema_migrations
           SET state='FAILED',failed_at=now(),error_message=$2
           WHERE migration_name=$1 AND state='APPLYING'`,
          [migration.name, message.slice(0, 4000)],
        ).catch(() => undefined);
        throw new Error(`Migration ${migration.name} failed: ${message}`, { cause: error });
      }
    }

    return { applied, skipped };
  } finally {
    if (lockHeld) {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_ADVISORY_LOCK_KEY]).catch(() => undefined);
    }
    client.release();
  }
}

function discoverMigrations(directory: string): MigrationFile[] {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Migration directory must be a real directory.");
  }

  const sqlEntries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".sql"));
  const seenSequences = new Set<string>();
  const candidates: Array<{ name: string; fullPath: string }> = [];

  for (const entry of sqlEntries) {
    const match = /^(\d{4})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.exec(entry.name);
    if (!match) throw new Error(`Migration filename is not canonical: ${entry.name}`);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Migration file must be a regular file: ${entry.name}`);
    const sequence = match[1]!;
    if (seenSequences.has(sequence)) throw new Error(`Duplicate migration sequence ${sequence}.`);
    seenSequences.add(sequence);
    candidates.push({ name: entry.name, fullPath: path.join(directory, entry.name) });
  }

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  return candidates.map((candidate) => {
    assertTransactionalMigration(candidate.fullPath, candidate.name);
    return { ...candidate, checksum: checksumFile(candidate.fullPath) };
  });
}

function assertTransactionalMigration(file: string, name: string): void {
  const normalized = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
  if (!/^BEGIN;\s/i.test(normalized) || !/COMMIT;\s*$/i.test(normalized)) {
    throw new Error(`Migration ${name} must begin with BEGIN; and end with COMMIT;`);
  }
}


async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS lightworld_schema_migrations (
      migration_name text PRIMARY KEY,
      checksum_sha256 char(64) NOT NULL,
      state text NOT NULL CHECK (state IN ('APPLYING','APPLIED','FAILED')),
      release_sha char(40),
      started_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz,
      failed_at timestamptz,
      error_message text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readLedgerRow(client: PoolClient, migrationName: string): Promise<LedgerRow | null> {
  const result = await client.query<LedgerRow>(
    `SELECT migration_name,checksum_sha256,state
     FROM lightworld_schema_migrations
     WHERE migration_name=$1`,
    [migrationName],
  );
  return result.rows[0] ?? null;
}


function checksumFile(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function normalizeReleaseSha(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("TRADEOS_RELEASE_SHA must be a 40-character Git SHA.");
  return normalized;
}
