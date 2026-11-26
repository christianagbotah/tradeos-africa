import type {
  BusinessNotificationItem, BusinessNotificationKind, BusinessNotificationsResponse,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";

type Row = {
  id: string;
  kind: BusinessNotificationKind;
  severity: BusinessNotificationItem["severity"];
  title: string; summary: string; occurred_at: Date; read_at: Date | null;
  href: BusinessNotificationItem["href"];
  total_count: string | number;
};

export class BusinessNotificationError extends Error {
  constructor(message: string, readonly statusCode = 400,
    readonly code = "BUSINESS_NOTIFICATION_INVALID") { super(message); }
}

/**
 * A single bounded branch inbox made from existing advisory sources.
 * Explicit read receipts are user-specific. Financial alerts are permission-
 * gated upstream and approval proposals are visible only to real owners.
 */
export async function listBusinessNotifications(
  pool: DatabasePool, scope: {
    businessId: string; branchId: string; userId: string; isOwner: boolean;
  },
): Promise<BusinessNotificationsResponse> {
  const { businessId, branchId, userId, isOwner } = scope;
  const result = await pool.query<Row>(
    [
      "WITH sources AS (",
      " SELECT a.id, 'ATTENTION'::text AS kind, a.severity,a.title,a.summary,",
      " a.last_seen_at AS occurred_at,",
      " CASE WHEN a.rule_code IN ('STOCKOUT_RISK','REORDER_REVIEW','SLOW_STOCK','OVERSTOCK_REVIEW')",
      " THEN '/inventory' ELSE '/reports' END AS href",
      " FROM business_attention_items a",
      " WHERE a.business_id=$1 AND a.branch_id=$2 AND a.state='OPEN'",
      " UNION ALL",
      " SELECT r.id,'APPROVAL'::text AS kind,'HIGH'::text AS severity,",
      " COALESCE(r.structured_input->>'title','Review proposed follow-up') AS title,",
      " COALESCE(r.structured_input->>'summary','Owner approval is required.') AS summary,",
      " r.created_at AS occurred_at,'/dashboard'::text AS href",
      " FROM business_automation_runs r",
      " JOIN business_automation_policies p ON p.id=r.policy_id AND p.business_id=r.business_id",
      " WHERE r.business_id=$1 AND r.branch_id=$2 AND r.state='WAITING_APPROVAL'",
      " AND p.enabled=true AND p.policy_version=r.policy_version AND p.approval_role='OWNER'",
      " AND $4::boolean=true",
      ")",
      " SELECT src.*,r.read_at, COUNT(*) OVER()::text AS total_count",
      " FROM sources src LEFT JOIN business_notification_reads r",
      " ON r.business_id=$1 AND r.branch_id=$2 AND r.user_id=$3",
      " AND r.source_type=src.kind AND r.source_id=src.id",
      " ORDER BY CASE src.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2",
      " WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,",
      " src.occurred_at DESC,src.id LIMIT 101",
    ].join(" "),
    [businessId, branchId, userId, isOwner],
  );
  const truncated = result.rows.length > 100;
  const notifications: BusinessNotificationItem[] = result.rows.slice(0,100).map((row) => ({
    id: row.id, kind: row.kind, severity: row.severity,
    title: row.title, summary: row.summary, occurredAt: row.occurred_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null, href: row.href,
  }));
  return {
    businessId, branchId, generatedAt: new Date().toISOString(),
    unreadCount: notifications.filter((notification) => notification.readAt === null).length,
    notifications, truncated,
  };
}

export async function acknowledgeBusinessNotification(
  pool: DatabasePool,
  input: {
    businessId: string; branchId: string; userId: string;
    isOwner: boolean; kind: BusinessNotificationKind; sourceId: string;
  },
): Promise<{ readAt: string }> {
  if (input.kind !== "ATTENTION" && input.kind !== "APPROVAL") {
    throw new BusinessNotificationError("Notification kind must be ATTENTION or APPROVAL");
  }
  if (input.kind === "APPROVAL" && !input.isOwner) {
    throw new BusinessNotificationError("Only the business owner can acknowledge approvals.",
      403,"BUSINESS_NOTIFICATION_FORBIDDEN");
  }
  const { businessId, branchId, userId, sourceId, kind } = input;
  const exists = kind === "ATTENTION"
    ? await pool.query(
      "SELECT 1 FROM business_attention_items " +
      "WHERE id=$1 AND business_id=$2 AND branch_id=$3 AND state='OPEN'",
      [sourceId, businessId, branchId],
    )
    : await pool.query(
      "SELECT 1 FROM business_automation_runs r " +
      "JOIN business_automation_policies p ON p.id=r.policy_id AND p.business_id=r.business_id " +
      "WHERE r.id=$1 AND r.business_id=$2 AND r.branch_id=$3 " +
      "AND r.state='WAITING_APPROVAL' AND p.enabled AND p.policy_version=r.policy_version " +
      "AND p.approval_role='OWNER'",
      [sourceId, businessId, branchId],
    );
  if (!exists.rows[0]) {
    throw new BusinessNotificationError("Notification not found.",404,"BUSINESS_NOTIFICATION_NOT_FOUND");
  }
  const write = await pool.query<{ read_at: Date }>(
    "INSERT INTO business_notification_reads (business_id,branch_id,user_id,source_type,source_id) " +
    "VALUES($1,$2,$3,$4,$5) ON CONFLICT (business_id,branch_id,user_id,source_type,source_id) " +
    "DO UPDATE SET read_at=business_notification_reads.read_at RETURNING read_at",
    [businessId, branchId, userId, kind, sourceId],
  );
  return { readAt: write.rows[0]!.read_at.toISOString() };
}
