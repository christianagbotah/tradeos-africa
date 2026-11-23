#!/usr/bin/env node
/**
 * PRE-CUTOVER OBSERVABILITY ONLY. Counts unresolved finance/offline work in
 * one repeatable-read, READ ONLY PostgreSQL transaction. No record values,
 * tenant identifiers, payment references, refunds, updates or activation.
 * A clear count is NEVER sufficient to authorize a release.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PromotionRejected, validateBundleIdentity } from './check-promotion-migrations.mjs';

export const FINANCE_QUERIES = Object.freeze([
  ['pendingSalePayments', "SELECT COUNT(*)::text AS total FROM payments WHERE status='PENDING'"],
  ['pendingRefunds', "SELECT COUNT(*)::text AS total FROM refund_transactions WHERE status='PENDING'"],
  ['openHubtelPosCheckouts', "SELECT COUNT(*)::text AS total FROM hubtel_sale_checkout_attempts WHERE state IN ('PREPARED','READY','PENDING_VERIFICATION','REVIEW_REQUIRED')"],
  ['openSubscriptionCheckouts', "SELECT COUNT(*)::text AS total FROM subscription_checkout_attempts WHERE state IN ('PREPARED','READY','PENDING_VERIFICATION')"],
  ['requestedSubscriptionRefunds', "SELECT COUNT(*)::text AS total FROM subscription_payment_refunds WHERE status='REQUESTED'"],
  ['receivedOfflineMutations', "SELECT COUNT(*)::text AS total FROM sync_mutations WHERE status='RECEIVED'"],
  ['unpublishedOutboxEvents', 'SELECT COUNT(*)::text AS total FROM outbox_events WHERE published_at IS NULL'],
  ['inconsistentHubtelSettlements', "SELECT COUNT(*)::text AS total FROM hubtel_sale_checkout_attempts a JOIN payments p ON p.id=a.payment_id WHERE a.state='RECONCILED' AND (p.status<>'SUCCEEDED' OR a.verified_provider_transaction_id IS NULL OR p.provider_reference IS DISTINCT FROM a.verified_provider_transaction_id)"],
  ['unreferencedExternalRefunds', "SELECT COUNT(*)::text AS total FROM refund_transactions WHERE status='SUCCEEDED' AND method IN ('MOMO','CARD','BANK') AND (provider_reference IS NULL OR btrim(provider_reference)='')"],
]);

const VALID_NAMES = new Set(FINANCE_QUERIES.map(([name]) => name));
export function assessFinanceSnapshot(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts) ||
      Object.keys(counts).length !== VALID_NAMES.size ||
      Object.keys(counts).some((key) => !VALID_NAMES.has(key))) {
    throw new PromotionRejected('Incomplete finance readiness snapshot');
  }
  const backlog = [];
  for (const [name] of FINANCE_QUERIES) {
    const value = counts[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PromotionRejected('Invalid finance readiness count');
    }
    if (value > 0) backlog.push({ check: name, count: value });
  }
  return {
    readOnly: true,
    aggregateCountsOnly: true,
    reviewedFinanceBacklogClear: backlog.length === 0,
    counts: Object.fromEntries(FINANCE_QUERIES.map(([name]) => [name, counts[name]])),
    blockers: backlog,
    // No financial aggregate, even all zero, can by itself authorize cutover.
    authorizedToDeploy: false,
  };
}

export async function queryFinanceSnapshotReadOnly(pool) {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    const counts = {};
    for (const [name, sql] of FINANCE_QUERIES) {
      const response = await client.query(sql);
      if (!response || response.rows?.length !== 1 ||
          typeof response.rows[0]?.total !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(response.rows[0].total)) {
        throw new PromotionRejected('Invalid aggregate database response');
      }
      const count = BigInt(response.rows[0].total);
      if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new PromotionRejected('Finance readiness count exceeds supported precision');
      }
      counts[name] = Number(count);
    }
    return assessFinanceSnapshot(counts);
  } finally {
    try {
      // Fail closed if rollback itself fails; never report a clean state.
      if (started) await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

async function main() {
  const [runtimeRoot, sha, ...rest] = process.argv.slice(2);
  if (!runtimeRoot || !sha || rest.length) {
    throw new PromotionRejected('usage: node [--env-file=trusted-external-env] check-promotion-finance.mjs <verified-pilot-root> <exact-main-sha>');
  }
  validateBundleIdentity(runtimeRoot, sha);
  if (!process.env.DATABASE_URL) throw new PromotionRejected('DATABASE_URL is not configured');
  const requireFromRelease = createRequire(path.join(runtimeRoot, 'apps/api/package.json'));
  const { Pool } = requireFromRelease('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
    statement_timeout: 7000,
    application_name: 'tradeos-finance-readonly',
  });
  try {
    const result = await queryFinanceSnapshotReadOnly(pool);
    console.log(JSON.stringify({
      sourceCommit: sha,
      artifactDeployable: false,
      financeReadiness: result,
      authorizedToDeploy: false,
    }));
    if (!result.reviewedFinanceBacklogClear) process.exitCode = 65;
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never leak database credentials, SQL server messages or raw row contents.
    const message = error instanceof PromotionRejected
      ? error.message : 'Read-only financial readiness could not be completed';
    console.error('finance-preflight-blocked: ' + message);
    process.exitCode = 65;
  });
}
