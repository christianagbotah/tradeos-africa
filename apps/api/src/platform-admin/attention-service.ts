import type {
  AdminAttentionEvidence,
  AdminAttentionItem,
  AdminAttentionSeverity,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

const MANAGED_RULES = [
  "TRIAL_EXPIRING_3D",
  "SUBSCRIPTION_PAST_DUE",
  "COLLECTION_FAILED_3X",
  "DEVICE_STALE",
  "SYNC_RISK",
  "CLIENT_BELOW_MINIMUM",
  "ENTITLEMENT_OVERRIDE_HIGH",
  "ADMIN_LOGIN_FAILURES_HIGH",
] as const;

const EVALUATE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "OPERATIONS"]);

interface AttentionSignal {
  sourceKey: string;
  ruleCode: typeof MANAGED_RULES[number];
  businessId: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: AdminAttentionSeverity;
  title: string;
  summary: string;
  evidence: AdminAttentionEvidence[];
}

interface AttentionRow {
  id: string;
  source_key: string;
  rule_code: string;
  business_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  severity: AdminAttentionSeverity;
  state: "OPEN" | "RESOLVED" | "DISMISSED";
  title: string;
  summary: string;
  evidence: AdminAttentionEvidence[];
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function listPlatformAttention(
  pool: DatabasePool,
  _actor: PlatformAdminContext,
): Promise<AdminAttentionItem[]> {
  const result = await pool.query<AttentionRow>(
    `SELECT id,source_key,rule_code,business_id,entity_type,entity_id,severity,state,title,summary,evidence,
            first_seen_at,last_seen_at,resolved_at,created_at,updated_at
     FROM platform_attention_items
     WHERE state='OPEN'
     ORDER BY CASE severity
       WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
       last_seen_at DESC,id`,
  );
  return result.rows.map(mapAttention);
}

export async function evaluatePlatformAttention(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  _input: { correlationId?: unknown } = {},
): Promise<AdminAttentionItem[]> {
  if (!EVALUATE_ROLES.has(actor.role)) {
    throw new PlatformAdminError(
      "Your platform role cannot force attention evaluation.",
      403,
      "ADMIN_ATTENTION_EVALUATE_FORBIDDEN",
    );
  }

  return withTransaction(pool, async (client) => {
    const signals = await detectSignals(client);
    for (const signal of signals) await upsertSignal(client, signal);

    const activeKeys = signals.map((signal) => signal.sourceKey);
    await client.query(
      `UPDATE platform_attention_items
       SET state='RESOLVED',resolved_at=now(),updated_at=now()
       WHERE state='OPEN'
         AND rule_code = ANY($1::text[])
         AND NOT (source_key = ANY($2::text[]))`,
      [MANAGED_RULES, activeKeys],
    );

    const result = await client.query<AttentionRow>(
      `SELECT id,source_key,rule_code,business_id,entity_type,entity_id,severity,state,title,summary,evidence,
              first_seen_at,last_seen_at,resolved_at,created_at,updated_at
       FROM platform_attention_items
       WHERE state='OPEN'
       ORDER BY CASE severity
         WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
         last_seen_at DESC,id`,
    );
    return result.rows.map(mapAttention);
  });
}

async function detectSignals(client: DatabaseClient): Promise<AttentionSignal[]> {
  const signals: AttentionSignal[] = [];

  const trials = await client.query<{ id: string; business_id: string; trial_ends_at: Date }>(
    `SELECT id,business_id,trial_ends_at
     FROM business_subscriptions
     WHERE status='TRIALING'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at > now()
       AND trial_ends_at <= now()+interval '3 days'`,
  );
  for (const row of trials.rows) {
    signals.push({
      sourceKey: `trial-expiring:${row.id}`,
      ruleCode: "TRIAL_EXPIRING_3D",
      businessId: row.business_id,
      entityType: "SUBSCRIPTION",
      entityId: row.id,
      severity: "MEDIUM",
      title: "Trial ending soon",
      summary: "A tenant trial ends within the next three days.",
      evidence: [evidence("SUBSCRIPTION", row.id, "trialEndsAt", row.trial_ends_at.toISOString())],
    });
  }

  const pastDue = await client.query<{ id: string; business_id: string; status: string }>(
    `SELECT id,business_id,status FROM business_subscriptions WHERE status='PAST_DUE'`,
  );
  for (const row of pastDue.rows) {
    signals.push({
      sourceKey: `subscription-past-due:${row.id}`,
      ruleCode: "SUBSCRIPTION_PAST_DUE",
      businessId: row.business_id,
      entityType: "SUBSCRIPTION",
      entityId: row.id,
      severity: "HIGH",
      title: "Subscription past due",
      summary: "A tenant subscription is past due and needs billing attention.",
      evidence: [evidence("SUBSCRIPTION", row.id, "status", row.status)],
    });
  }

  const failedCollections = await client.query<{ business_id: string; failed_count: string; latest_failure_at: Date }>(
    `SELECT business_id,count(*)::text AS failed_count,max(received_at) AS latest_failure_at
     FROM subscription_payments
     WHERE status='FAILED' AND received_at >= now()-interval '24 hours'
     GROUP BY business_id
     HAVING count(*) >= 3`,
  );
  for (const row of failedCollections.rows) {
    signals.push({
      sourceKey: `collection-failed-3x:${row.business_id}`,
      ruleCode: "COLLECTION_FAILED_3X",
      businessId: row.business_id,
      entityType: "BUSINESS",
      entityId: row.business_id,
      severity: "HIGH",
      title: "Repeated collection failures",
      summary: "At least three SaaS collection attempts failed in the last 24 hours.",
      evidence: [
        evidence("SUBSCRIPTION_PAYMENT", row.business_id, "failedCount", Number(row.failed_count)),
        evidence("SUBSCRIPTION_PAYMENT", row.business_id, "latestFailureAt", row.latest_failure_at.toISOString()),
      ],
    });
  }

  const devices = await client.query<{
    id: string; business_id: string; platform: string; release_channel: string; app_version: string;
    last_seen_at: Date | null; last_sync_at: Date | null;
  }>(
    `SELECT id,business_id,platform,release_channel,app_version,last_seen_at,last_sync_at
     FROM registered_devices WHERE status='ACTIVE'`,
  );
  for (const row of devices.rows) {
    const seenFresh = row.last_seen_at && row.last_seen_at.getTime() >= Date.now() - 15 * 60 * 1000;
    if (!seenFresh) {
      signals.push({
        sourceKey: `device-stale:${row.id}`,
        ruleCode: "DEVICE_STALE",
        businessId: row.business_id,
        entityType: "DEVICE",
        entityId: row.id,
        severity: "MEDIUM",
        title: "Device has gone stale",
        summary: "An active registered device has not checked in within the expected window.",
        evidence: [evidence("DEVICE", row.id, "lastSeenAt", row.last_seen_at?.toISOString() ?? null)],
      });
    } else if (!row.last_sync_at || row.last_sync_at.getTime() < Date.now() - 60 * 60 * 1000) {
      signals.push({
        sourceKey: `sync-risk:${row.id}`,
        ruleCode: "SYNC_RISK",
        businessId: row.business_id,
        entityType: "DEVICE",
        entityId: row.id,
        severity: "HIGH",
        title: "Device sync risk",
        summary: "A recently active device has not synchronized within the expected window.",
        evidence: [evidence("DEVICE", row.id, "lastSyncAt", row.last_sync_at?.toISOString() ?? null)],
      });
    }
  }

  const releases = await client.query<{
    platform: string; release_channel: string; minimum_supported_version: string;
  }>(
    `SELECT DISTINCT ON (platform,release_channel)
       platform,release_channel,minimum_supported_version
     FROM client_releases
     WHERE status IN ('ACTIVE','ROLLOUT') AND minimum_supported_version IS NOT NULL
     ORDER BY platform,release_channel,released_at DESC NULLS LAST,created_at DESC`,
  );
  const minimumByClient = new Map(releases.rows.map((row) => [`${row.platform}:${row.release_channel}`, row.minimum_supported_version]));
  for (const row of devices.rows) {
    const minimum = minimumByClient.get(`${row.platform}:${row.release_channel}`);
    if (!minimum || compareVersion(row.app_version, minimum) >= 0) continue;
    signals.push({
      sourceKey: `client-below-minimum:${row.id}`,
      ruleCode: "CLIENT_BELOW_MINIMUM",
      businessId: row.business_id,
      entityType: "DEVICE",
      entityId: row.id,
      severity: "HIGH",
      title: "Client below minimum supported version",
      summary: "A registered client is below the platform minimum supported version.",
      evidence: [
        evidence("DEVICE", row.id, "appVersion", row.app_version),
        evidence("CLIENT_RELEASE", `${row.platform}:${row.release_channel}`, "minimumSupportedVersion", minimum),
      ],
    });
  }

  const overrides = await client.query<{ business_id: string; override_count: string }>(
    `SELECT business_id,count(*)::text AS override_count
     FROM business_entitlement_overrides
     WHERE expires_at IS NULL OR expires_at > now()
     GROUP BY business_id HAVING count(*) >= 5`,
  );
  for (const row of overrides.rows) {
    signals.push({
      sourceKey: `entitlement-override-high:${row.business_id}`,
      ruleCode: "ENTITLEMENT_OVERRIDE_HIGH",
      businessId: row.business_id,
      entityType: "BUSINESS",
      entityId: row.business_id,
      severity: "MEDIUM",
      title: "High entitlement override count",
      summary: "This tenant has an unusually high number of active entitlement overrides.",
      evidence: [evidence("ENTITLEMENT_OVERRIDE", row.business_id, "overrideCount", Number(row.override_count))],
    });
  }

  const loginFailures = await client.query<{ id: string; failed_login_count: number; locked_until: Date | null }>(
    `SELECT id,failed_login_count,locked_until
     FROM platform_users
     WHERE is_active=true AND (failed_login_count >= 3 OR locked_until > now())`,
  );
  for (const row of loginFailures.rows) {
    signals.push({
      sourceKey: `admin-login-failures-high:${row.id}`,
      ruleCode: "ADMIN_LOGIN_FAILURES_HIGH",
      businessId: null,
      entityType: "PLATFORM_ADMIN",
      entityId: row.id,
      severity: "HIGH",
      title: "Repeated administrator login failures",
      summary: "A platform administrator account has repeated failed login attempts.",
      evidence: [
        evidence("PLATFORM_ADMIN", row.id, "failedLoginCount", row.failed_login_count),
        ...(row.locked_until ? [evidence("PLATFORM_ADMIN", row.id, "lockedUntil", row.locked_until.toISOString())] : []),
      ],
    });
  }

  return signals;
}

async function upsertSignal(client: DatabaseClient, signal: AttentionSignal): Promise<void> {
  await client.query(
    `INSERT INTO platform_attention_items(
       source_key,rule_code,business_id,entity_type,entity_id,severity,state,title,summary,evidence,first_seen_at,last_seen_at
     ) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9::jsonb,now(),now())
     ON CONFLICT (source_key,business_id,entity_type,entity_id) NULLS NOT DISTINCT WHERE state='OPEN'
     DO UPDATE SET rule_code=EXCLUDED.rule_code,severity=EXCLUDED.severity,title=EXCLUDED.title,
       summary=EXCLUDED.summary,evidence=EXCLUDED.evidence,last_seen_at=now(),updated_at=now(),resolved_at=NULL`,
    [
      signal.sourceKey, signal.ruleCode, signal.businessId, signal.entityType, signal.entityId,
      signal.severity, signal.title, signal.summary, JSON.stringify(signal.evidence),
    ],
  );
}

function evidence(sourceType: string, sourceId: string, label: string, value: unknown): AdminAttentionEvidence {
  return { sourceType, sourceId, label, value };
}

function compareVersion(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseVersion(value: string): number[] | null {
  const core = value.trim().replace(/^v/i, "").split(/[+-]/, 1)[0];
  if (!core || !/^\d+(?:\.\d+)*$/.test(core)) return null;
  return core.split(".").map((part) => Number(part));
}

function mapAttention(row: AttentionRow): AdminAttentionItem {
  return {
    id: row.id,
    sourceKey: row.source_key,
    ruleCode: row.rule_code,
    businessId: row.business_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    state: row.state,
    title: row.title,
    summary: row.summary,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
