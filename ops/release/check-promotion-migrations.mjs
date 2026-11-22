#!/usr/bin/env node
/**
 * Read-only migration compatibility gate for future GitHub-built TradeOS releases.
 * NEVER invokes the SQL mutation runner, executes release SQL, or changes services.
 *
 * CLI: node [--env-file=/trusted/external/env] ops/release/check-promotion-migrations.mjs
 *        <absolute-release-root> <exact-full-main-sha>
 * Accepts ONLY a properly verified source-light bundle (pilot is NOT deployable).
 * Database connection uses the bundled `pg` package and environment DATABASE_URL.
 *
 * Tests import the pure functions; only CLI mode connects to PostgreSQL.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const VALID_SHA = /^[0-9a-f]{40}$/;
const VALID_FILE = /^(\d{4})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
const VALID_DIGEST = /^[0-9a-f]{64}$/;

export class PromotionRejected extends Error {}

function safeRealDirectory(directory, label) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new PromotionRejected(`${label} must be an absolute path`);
  }
  const st = fs.lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    throw new PromotionRejected(`${label} must be an ordinary directory`);
  }
  return directory;
}

export function inspectMigrationDirectory(directory) {
  safeRealDirectory(directory, 'Migration directory');
  const seen = new Set();
  const files = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.sql')) continue;
    const match = VALID_FILE.exec(entry.name);
    if (!match || !entry.isFile() || entry.isSymbolicLink()) {
      throw new PromotionRejected('Noncanonical or nonregular SQL migration found');
    }
    if (seen.has(match[1])) throw new PromotionRejected('Duplicate migration sequence found');
    seen.add(match[1]);
    const file = path.join(directory, entry.name);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size === 0 || st.size > 3 * 1024 * 1024) {
      throw new PromotionRejected('Unsafe, empty or unexpectedly large SQL migration');
    }
    files.set(entry.name, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  }
  if (!files.size) throw new PromotionRejected('No canonical migration files found');
  return files;
}

export function assessMigrationLedger(files, rows) {
  if (!(files instanceof Map) || files.size < 1 || !Array.isArray(rows)) {
    throw new PromotionRejected('Migration input is missing or invalid');
  }
  const seen = new Set();
  const errors = [];
  let applied = 0;
  for (const row of rows) {
    if (!row || typeof row.migration_name !== 'string' ||
        !VALID_FILE.test(row.migration_name) ||
        typeof row.checksum_sha256 !== 'string' ||
        !VALID_DIGEST.test(row.checksum_sha256.trim()) ||
        !['APPLIED', 'APPLYING', 'FAILED'].includes(row.state) ||
        seen.has(row.migration_name)) {
      errors.push('Invalid or duplicated ledger row');
      continue;
    }
    seen.add(row.migration_name);
    if (!files.has(row.migration_name)) {
      errors.push(`Ledger migration absent from candidate: ${row.migration_name}`);
    } else if (files.get(row.migration_name) !== row.checksum_sha256.trim()) {
      errors.push(`Migration checksum mismatch: ${row.migration_name}`);
    }
    if (row.state !== 'APPLIED') {
      errors.push(`Migration not successfully applied: ${row.migration_name}`);
    } else {
      applied += 1;
    }
  }
  const pending = [...files.keys()].filter((name) => !seen.has(name)).sort();
  if (pending.length) errors.push(`${pending.length} bundled migrations are not in the applied ledger`);
  return {
    compatible: errors.length === 0,
    bundledMigrations: files.size,
    recordedMigrations: rows.length,
    appliedMigrations: applied,
    pendingMigrations: pending,
    blockers: errors,
  };
}

export function validateBundleIdentity(root, sha) {
  if (!VALID_SHA.test(sha)) throw new PromotionRejected('Expected exact lowercase source SHA');
  safeRealDirectory(root, 'Release root');
  const manifestPath = path.join(root, 'manifest.json');
  const info = fs.lstatSync(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) {
    throw new PromotionRejected('Unsafe release manifest');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 ||
      manifest.sourceCommit !== sha ||
      manifest.requiredNodeMajor !== 22 ||
      manifest.type !== 'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT' ||
      manifest.deployable !== false) {
    throw new PromotionRejected('Not an exact-match, nondeployable signed pilot bundle');
  }
  const packagePath = path.join(root, 'apps/api/package.json');
  const packageInfo = fs.lstatSync(packagePath);
  if (!packageInfo.isFile() || packageInfo.isSymbolicLink()) {
    throw new PromotionRejected('Unsafe production API package descriptor');
  }
  const migrationDirectory = path.join(root, 'packages/db/migrations');
  // Refuse symlink path components rather than trusting resolved parent paths.
  for (const relative of ['packages', 'packages/db', 'packages/db/migrations',
                          'apps', 'apps/api', 'apps/api/node_modules']) {
    safeRealDirectory(path.join(root, relative), `Release path ${relative}`);
  }
  return migrationDirectory;
}

export async function queryLedgerReadOnly(pool) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;
    const response = await client.query(
      'SELECT migration_name, checksum_sha256, state FROM lightworld_schema_migrations ORDER BY migration_name',
    );
    if (!Array.isArray(response.rows)) throw new PromotionRejected('Database response missing ledger rows');
    return response.rows;
  } finally {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    client.release();
  }
}

async function main() {
  const [root, sha, ...rest] = process.argv.slice(2);
  if (!root || !sha || rest.length !== 0) throw new PromotionRejected(
    'usage: node [--env-file=external-file] check-promotion-migrations.mjs <absolute-runtime-root> <full-source-SHA>',
  );
  const migrationDirectory = validateBundleIdentity(root, sha);
  const files = inspectMigrationDirectory(migrationDirectory);
  if (!process.env.DATABASE_URL) throw new PromotionRejected('DATABASE_URL is not configured');
  // `pg` must load from the verified release, never from the developer source
  // checkout. This command is not part of the runtime archive.
  const requireFromRelease = createRequire(path.join(root, 'apps/api/package.json'));
  const { Pool } = requireFromRelease('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
    statement_timeout: 7000,
    application_name: 'tradeos-promotion-readonly',
  });
  try {
    const ledger = await queryLedgerReadOnly(pool);
    const result = assessMigrationLedger(files, ledger);
    console.log(JSON.stringify({
      sourceCommit: sha,
      readOnly: true,
      artifactDeployable: false,
      migrationLedger: result,
      authorizedToDeploy: false,
    }));
    if (!result.compatible) process.exitCode = 65;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // Intentionally NEVER print PostgreSQL connection strings, PG server errors,
    // parameters or stack traces from this privileged finance preflight.
    const message = err instanceof PromotionRejected ? err.message : 'Database read-only preflight could not be completed';
    console.error(`promotion-preflight-blocked: ${message}`);
    process.exitCode = 65;
  });
}
