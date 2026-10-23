import path from "node:path";
import { createPool } from "../db.js";
import { applyMigrations } from "../migrations/migration-runner.js";

const migrationDirectory = process.argv[2];
if (!migrationDirectory) {
  console.error("usage: apply-migrations <migration-directory>");
  process.exitCode = 64;
} else {
  const pool = createPool();
  try {
    const releaseSha = process.env.TRADEOS_RELEASE_SHA;
    const result = await applyMigrations(pool, {
      migrationDirectory: path.resolve(migrationDirectory),
      ...(releaseSha ? { releaseSha } : {}),
    });
    console.log(`Migrations complete: ${result.applied.length} applied, ${result.skipped.length} already applied.`);
  } finally {
    await pool.end();
  }
}
