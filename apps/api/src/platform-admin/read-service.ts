import type {
  AdminAuditEvent,
  AdminClientRelease,
  AdminDeviceSummary,
  AdminFeatureFlag,
  AdminTenantDetail,
  AdminTenantSummary,
  PlatformClient,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { PlatformAdminError } from "./security.js";

interface TenantRow {
  id: string;
  name: string;
  business_type: string;
  status: string;
  country_code: string;
  currency_code: string;
  plan_code: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  branch_count: string | number;
  device_count: string | number;
  last_seen_at: Date | null;
  updated_at: Date;
}

export async function listAdminTenants(pool: DatabasePool): Promise<AdminTenantSummary[]> {
  const result = await pool.query<TenantRow>(tenantListSql("ORDER BY b.created_at DESC"));
  return result.rows.map(mapTenant);
}

export async function getAdminTenant(pool: DatabasePool, businessId: string): Promise<AdminTenantDetail> {
  const result = await pool.query<TenantRow>(tenantListSql("WHERE b.id=$1"), [businessId]);
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Tenant was not found", 404, "ADMIN_TENANT_NOT_FOUND");

  const [branches, subscription, overrides] = await Promise.all([
    pool.query<{ id: string; name: string; code: string; is_active: boolean; timezone: string }>(
      `SELECT id,name,code,is_active,timezone FROM branches WHERE business_id=$1 ORDER BY name,id`,
      [businessId],
    ),
    pool.query<{
      id: string;
      plan_id: string;
      plan_code: string;
      plan_name: string;
      status: string;
      trial_ends_at: Date | null;
      current_period_ends_at: Date | null;
      cancel_at_period_end: boolean;
    }>(
      `SELECT bs.id,bs.plan_id,sp.code AS plan_code,sp.name AS plan_name,bs.status,
              bs.trial_ends_at,bs.current_period_ends_at,bs.cancel_at_period_end
       FROM business_subscriptions bs
       JOIN subscription_plans sp ON sp.id=bs.plan_id
       WHERE bs.business_id=$1
       ORDER BY bs.created_at DESC LIMIT 1`,
      [businessId],
    ),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business_entitlement_overrides WHERE business_id=$1`,
      [businessId],
    ),
  ]);

  const currentSubscription = subscription.rows[0];
  return {
    ...mapTenant(row),
    branches: branches.rows.map((branch) => ({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      active: branch.is_active,
      timezone: branch.timezone,
    })),
    subscription: currentSubscription ? {
      id: currentSubscription.id,
      planId: currentSubscription.plan_id,
      planCode: currentSubscription.plan_code,
      planName: currentSubscription.plan_name,
      status: currentSubscription.status,
      trialEndsAt: toIso(currentSubscription.trial_ends_at),
      currentPeriodEndsAt: toIso(currentSubscription.current_period_ends_at),
      cancelAtPeriodEnd: currentSubscription.cancel_at_period_end,
    } : null,
    entitlementOverrideCount: Number(overrides.rows[0]?.count ?? 0),
  };
}

export async function listAdminDevices(pool: DatabasePool): Promise<AdminDeviceSummary[]> {
  const result = await pool.query<{
    id: string;
    business_id: string;
    business_name: string;
    branch_id: string | null;
    branch_name: string | null;
    device_key: string;
    platform: PlatformClient;
    app_version: string;
    release_channel: string;
    status: string;
    last_seen_at: Date | null;
    last_sync_at: Date | null;
  }>(
    `SELECT d.id,d.business_id,b.name AS business_name,d.branch_id,br.name AS branch_name,
            d.device_key,d.platform,d.app_version,d.release_channel,d.status,d.last_seen_at,d.last_sync_at
     FROM registered_devices d
     JOIN businesses b ON b.id=d.business_id
     LEFT JOIN branches br ON br.id=d.branch_id
     ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC
     LIMIT 500`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    deviceKey: row.device_key,
    platform: row.platform,
    appVersion: row.app_version,
    releaseChannel: row.release_channel,
    status: row.status,
    lastSeenAt: toIso(row.last_seen_at),
    lastSyncAt: toIso(row.last_sync_at),
    health: deviceHealth(row.last_seen_at),
  }));
}

export async function listAdminAuditEvents(pool: DatabasePool, requestedLimit?: unknown): Promise<AdminAuditEvent[]> {
  const limit = boundedLimit(requestedLimit, 100, 250);
  const result = await pool.query<{
    id: string;
    platform_user_id: string | null;
    platform_user_display_name: string | null;
    business_id: string | null;
    business_name: string | null;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    reason: string | null;
    payload: Record<string, unknown>;
    occurred_at: Date;
  }>(
    `SELECT e.id,e.platform_user_id,u.display_name AS platform_user_display_name,
            e.business_id,b.name AS business_name,e.event_type,e.entity_type,e.entity_id,
            e.reason,e.payload,e.occurred_at
     FROM platform_audit_events e
     LEFT JOIN platform_users u ON u.id=e.platform_user_id
     LEFT JOIN businesses b ON b.id=e.business_id
     ORDER BY e.occurred_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    platformUserId: row.platform_user_id,
    platformUserDisplayName: row.platform_user_display_name,
    businessId: row.business_id,
    businessName: row.business_name,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    payload: row.payload ?? {},
    occurredAt: row.occurred_at.toISOString(),
  }));
}

export async function listAdminReleases(pool: DatabasePool): Promise<AdminClientRelease[]> {
  const result = await pool.query<{
    id: string;
    platform: PlatformClient;
    version: string;
    build_number: string | null;
    release_channel: string;
    status: string;
    minimum_supported_version: string | null;
    rollout_percent: string | number;
    release_notes: string | null;
    released_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id,platform,version,build_number,release_channel,status,minimum_supported_version,
            rollout_percent,release_notes,released_at,created_at
     FROM client_releases
     ORDER BY created_at DESC LIMIT 300`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    version: row.version,
    buildNumber: row.build_number,
    releaseChannel: row.release_channel,
    status: row.status,
    minimumSupportedVersion: row.minimum_supported_version,
    rolloutPercent: Number(row.rollout_percent),
    releaseNotes: row.release_notes,
    releasedAt: toIso(row.released_at),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listAdminFeatureFlags(pool: DatabasePool): Promise<AdminFeatureFlag[]> {
  const result = await pool.query<{
    id: string;
    code: string;
    business_id: string | null;
    business_name: string | null;
    enabled: boolean;
    configuration: Record<string, unknown>;
    updated_by_platform_user_id: string | null;
    updated_at: Date;
  }>(
    `SELECT f.id,f.code,f.business_id,b.name AS business_name,f.enabled,f.configuration,
            f.updated_by_platform_user_id,f.updated_at
     FROM platform_feature_flags f
     LEFT JOIN businesses b ON b.id=f.business_id
     ORDER BY f.code,b.name NULLS FIRST,f.updated_at DESC
     LIMIT 500`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    businessId: row.business_id,
    businessName: row.business_name,
    enabled: row.enabled,
    configuration: row.configuration ?? {},
    updatedByPlatformUserId: row.updated_by_platform_user_id,
    updatedAt: row.updated_at.toISOString(),
  }));
}

function tenantListSql(suffix: string): string {
  return `SELECT b.id,b.name,b.business_type,b.status,b.country_code,b.currency_code,b.updated_at,
                 sub.plan_code,sub.plan_name,sub.subscription_status,
                 (SELECT count(*) FROM branches br WHERE br.business_id=b.id)::text AS branch_count,
                 (SELECT count(*) FROM registered_devices rd WHERE rd.business_id=b.id)::text AS device_count,
                 (SELECT max(rd.last_seen_at) FROM registered_devices rd WHERE rd.business_id=b.id) AS last_seen_at
          FROM businesses b
          LEFT JOIN LATERAL (
            SELECT sp.code AS plan_code,sp.name AS plan_name,bs.status AS subscription_status
            FROM business_subscriptions bs
            JOIN subscription_plans sp ON sp.id=bs.plan_id
            WHERE bs.business_id=b.id
            ORDER BY bs.created_at DESC LIMIT 1
          ) sub ON true
          ${suffix}`;
}

function mapTenant(row: TenantRow): AdminTenantSummary {
  return {
    id: row.id,
    name: row.name,
    businessType: row.business_type,
    status: row.status,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    planCode: row.plan_code,
    planName: row.plan_name,
    subscriptionStatus: row.subscription_status,
    branchCount: Number(row.branch_count),
    deviceCount: Number(row.device_count),
    lastSeenAt: toIso(row.last_seen_at),
    updatedAt: row.updated_at.toISOString(),
  };
}

function deviceHealth(lastSeenAt: Date | null): "ONLINE" | "STALE" | "UNKNOWN" {
  if (!lastSeenAt) return "UNKNOWN";
  return Date.now() - lastSeenAt.getTime() <= 15 * 60 * 1000 ? "ONLINE" : "STALE";
}

function boundedLimit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
