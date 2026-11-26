import type {
  AdminAuditEvent,
  AdminDeviceSummary,
  AdminTenant360,
  AdminTenantAccessRoleSummary,
  PlatformClient,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { deviceHealth, getAdminTenant } from "./read-service.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_LIFECYCLE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "OPERATIONS"]);
const TENANT_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

export async function getTenant360(
  pool: DatabasePool,
  _actor: PlatformAdminContext,
  businessId: string,
): Promise<AdminTenant360> {
  requireBusinessId(businessId);
  const base = await getAdminTenant(pool, businessId);
  const [staffRoles, membershipRoles, membershipStatuses, contacts, devices, recentActivity] = await Promise.all([
    pool.query<{ role: string; total: string; active: string }>(
      `SELECT role,count(*)::text AS total,count(*) FILTER (WHERE is_active)::text AS active
       FROM staff WHERE business_id=$1 GROUP BY role ORDER BY role`,
      [businessId],
    ),
    pool.query<{ role: string; total: string; active: string }>(
      `SELECT role,count(*)::text AS total,count(*) FILTER (WHERE status='ACTIVE')::text AS active
       FROM business_memberships WHERE business_id=$1 GROUP BY role ORDER BY role`,
      [businessId],
    ),
    pool.query<{ status: string; count: string }>(
      `SELECT status,count(*)::text AS count FROM business_memberships
       WHERE business_id=$1 GROUP BY status ORDER BY status`,
      [businessId],
    ),
    pool.query<{
      user_id: string;
      staff_id: string | null;
      display_name: string;
      email: string | null;
      phone_e164: string | null;
      role: string;
      membership_status: string;
    }>(
      `SELECT m.user_id,m.staff_id,COALESCE(s.display_name,u.display_name) AS display_name,
              COALESCE(s.email,u.email) AS email,u.phone_e164,m.role,m.status AS membership_status
       FROM business_memberships m
       JOIN app_users u ON u.id=m.user_id
       LEFT JOIN staff s ON s.id=m.staff_id AND s.business_id=m.business_id
       WHERE m.business_id=$1 AND m.role IN ('OWNER','ADMIN')
       ORDER BY CASE m.role WHEN 'OWNER' THEN 0 ELSE 1 END,display_name,m.user_id`,
      [businessId],
    ),
    pool.query<{
      id: string;
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
      `SELECT d.id,d.branch_id,br.name AS branch_name,d.device_key,d.platform,d.app_version,
              d.release_channel,d.status,d.last_seen_at,d.last_sync_at
       FROM registered_devices d
       LEFT JOIN branches br ON br.id=d.branch_id
       WHERE d.business_id=$1
       ORDER BY d.last_seen_at DESC NULLS LAST,d.created_at DESC`,
      [businessId],
    ),
    pool.query<{
      id: string;
      platform_user_id: string | null;
      platform_user_display_name: string | null;
      event_type: string;
      entity_type: string;
      entity_id: string | null;
      reason: string | null;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT e.id,e.platform_user_id,u.display_name AS platform_user_display_name,
              e.event_type,e.entity_type,e.entity_id,e.reason,e.payload,e.occurred_at
       FROM platform_audit_events e
       LEFT JOIN platform_users u ON u.id=e.platform_user_id
       WHERE e.business_id=$1
       ORDER BY e.occurred_at DESC,e.id DESC LIMIT 25`,
      [businessId],
    ),
  ]);

  const roleMap = new Map<string, AdminTenantAccessRoleSummary>();
  for (const row of staffRoles.rows) {
    roleMap.set(row.role, {
      role: row.role,
      staffCount: Number(row.total),
      activeStaffCount: Number(row.active),
      membershipCount: 0,
      activeMembershipCount: 0,
    });
  }
  for (const row of membershipRoles.rows) {
    const role = roleMap.get(row.role) ?? {
      role: row.role,
      staffCount: 0,
      activeStaffCount: 0,
      membershipCount: 0,
      activeMembershipCount: 0,
    };
    role.membershipCount = Number(row.total);
    role.activeMembershipCount = Number(row.active);
    roleMap.set(row.role, role);
  }

  const mappedDevices: AdminDeviceSummary[] = devices.rows.map((row) => ({
    id: row.id,
    businessId,
    businessName: base.name,
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

  const mappedActivity: AdminAuditEvent[] = recentActivity.rows.map((row) => ({
    id: row.id,
    platformUserId: row.platform_user_id,
    platformUserDisplayName: row.platform_user_display_name,
    businessId,
    businessName: base.name,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    payload: row.payload ?? {},
    occurredAt: row.occurred_at.toISOString(),
  }));

  return {
    ...base,
    access: {
      staffTotal: Array.from(roleMap.values()).reduce((sum, role) => sum + role.staffCount, 0),
      activeStaff: Array.from(roleMap.values()).reduce((sum, role) => sum + role.activeStaffCount, 0),
      membershipTotal: Array.from(roleMap.values()).reduce((sum, role) => sum + role.membershipCount, 0),
      activeMemberships: Array.from(roleMap.values()).reduce((sum, role) => sum + role.activeMembershipCount, 0),
      roles: Array.from(roleMap.values()).sort((a, b) => a.role.localeCompare(b.role)),
      membershipStatuses: membershipStatuses.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    },
    contacts: contacts.rows.map((row) => ({
      userId: row.user_id,
      staffId: row.staff_id,
      displayName: row.display_name,
      email: row.email,
      phoneE164: row.phone_e164,
      role: row.role,
      membershipStatus: row.membership_status,
    })),
    devices: mappedDevices,
    billing: {
      available: false,
      openInvoiceCount: null,
      overdueInvoiceCount: null,
      openBalanceMinor: null,
      overdueBalanceMinor: null,
    },
    recentActivity: mappedActivity,
  };
}

export async function changeTenantStatus(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  businessId: string,
  input: { status?: unknown; reason?: unknown; expectedUpdatedAt?: unknown },
): Promise<AdminTenant360> {
  requireBusinessId(businessId);
  if (!TENANT_LIFECYCLE_ROLES.has(actor.role)) {
    throw new PlatformAdminError("Your platform role cannot change tenant status", 403, "ADMIN_TENANT_STATUS_FORBIDDEN");
  }
  const status = parseTenantStatus(input.status);
  const reason = parseReason(input.reason);
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);

  await withTransaction(pool, async (client) => {
    const found = await client.query<{ status: string; updated_at: Date }>(
      `SELECT status,updated_at FROM businesses WHERE id=$1 FOR UPDATE`,
      [businessId],
    );
    const current = found.rows[0];
    if (!current) throw new PlatformAdminError("Tenant was not found", 404, "ADMIN_TENANT_NOT_FOUND");
    if (current.status === "CLOSED") {
      throw new PlatformAdminError("Closed tenants cannot be reactivated from this workflow", 409, "ADMIN_TENANT_CLOSED");
    }
    if (current.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
      throw new PlatformAdminError("Tenant changed since it was loaded. Refresh and try again.", 409, "ADMIN_TENANT_STALE");
    }
    if (current.status === status) return;

    await client.query(
      `UPDATE businesses
       SET status=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [businessId, status],
    );
    await client.query(
      `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
       VALUES($1::uuid,$2::uuid,'TENANT_STATUS_CHANGED','BUSINESS',($2::uuid)::text,$3,$4::jsonb)`,
      [actor.id, businessId, reason, JSON.stringify({ previous: { status: current.status }, next: { status } })],
    );
  });

  return getTenant360(pool, actor, businessId);
}

function requireBusinessId(value: string): void {
  if (!UUID.test(value)) throw new PlatformAdminError("Tenant was not found", 404, "ADMIN_TENANT_NOT_FOUND");
}

function parseTenantStatus(value: unknown): "ACTIVE" | "SUSPENDED" {
  if (typeof value !== "string" || !TENANT_STATUSES.has(value)) {
    throw new PlatformAdminError("Tenant status must be ACTIVE or SUSPENDED", 400, "ADMIN_TENANT_STATUS_INVALID");
  }
  return value as "ACTIVE" | "SUSPENDED";
}

function parseReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlatformAdminError("A reason is required", 400, "ADMIN_TENANT_REASON_REQUIRED");
  }
  const reason = value.trim();
  if (reason.length > 500) throw new PlatformAdminError("Reason is too long", 400, "ADMIN_TENANT_REASON_INVALID");
  return reason;
}

function parseExpectedUpdatedAt(value: unknown): Date {
  if (typeof value !== "string") throw new PlatformAdminError("Expected tenant version is required", 400, "ADMIN_TENANT_VERSION_REQUIRED");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new PlatformAdminError("Expected tenant version is invalid", 400, "ADMIN_TENANT_VERSION_INVALID");
  return parsed;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
