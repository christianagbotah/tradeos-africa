import type { DatabasePool } from "../db.js";

export interface HubtelPosMonitorItem {
  attemptId: string;
  saleId: string;
  branchId: string;
  state: "PREPARED" | "READY" | "PENDING_VERIFICATION" |
    "RECONCILED" | "REVIEW_REQUIRED";
  saleStatus: string;
  paymentStatus: string;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  statusCheckAttempts: number;
  lastStatusResult: string | null;
  lastErrorCode: string | null;
  reviewRequestedAt: string | null;
  notificationCount:number;
  lastNotificationHint:string|null;
  lastNotificationAt:string|null;
  notificationTrust:"UNTRUSTED";
  postSettlementCheckedAt:string|null;
  settlementExceptionCount:number;
  settlementExceptionKind:string|null;
  settlementExceptionAt:string|null;
}
type Row = {
  id: string; sale_id: string; branch_id: string;
  state: HubtelPosMonitorItem["state"];
  sale_status: string; payment_status: string;
  expected_amount_minor: string;
  currency_code: string;
  created_at: Date;
  last_status_checked_at: Date | null;
  next_status_check_at: Date | null;
  status_check_attempts: number;
  last_status_check_result: string | null;
  last_status_error_code: string | null;
  review_requested_at: Date | null;
  notification_count:number;
  last_notification_hint:string|null;
  last_notification_at:Date|null;
  last_post_settlement_checked_at:Date|null;
  settlement_exception_count:number;
  settlement_exception_kind:string|null;
  settlement_exception_at:Date|null;
};

/**
 * Read-only and strictly tenant-scoped. No merchant collection-account,
 * authorization token, checkout secret or provider callback payload is
 * exposed to the browser. Useful even with the live POS flag disabled.
 */
export async function getBusinessHubtelPosMonitor(
  pool: DatabasePool,
  input: { businessId: string; branchId?: string; limit?: number },
): Promise<{ attempts: HubtelPosMonitorItem[]; summary: {
  awaiting: number; reviewRequired: number; reconciled: number;
  settlementAlerts:number;
} }> {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50) || 50));
  const values = [input.businessId, input.branchId ?? null, limit];
  const results = await pool.query<Row>(
    "SELECT a.id,a.sale_id,a.branch_id,a.state,s.status AS sale_status," +
    "p.status AS payment_status,a.expected_amount_minor::text,a.currency_code," +
    "a.created_at,a.last_status_checked_at,a.next_status_check_at," +
    "a.status_check_attempts,a.last_status_check_result," +
    "a.last_status_error_code,a.review_requested_at," +
    "COALESCE(n.notification_count,0) AS notification_count," +
    "n.last_notification_hint,n.last_notification_at," +
    "a.last_post_settlement_checked_at," +
    "COALESCE(e.exception_count,0) AS settlement_exception_count," +
    "e.latest_kind AS settlement_exception_kind," +
    "e.latest_at AS settlement_exception_at " +
    "FROM hubtel_sale_checkout_attempts a " +
    "LEFT JOIN LATERAL (" +
    "SELECT count(*)::integer AS notification_count," +
    "max(received_at) AS last_notification_at," +
    "(array_agg(status_hint ORDER BY received_at DESC,id DESC))[1] " +
    "AS last_notification_hint " +
    "FROM hubtel_pos_notification_inbox WHERE attempt_id=a.id" +
    ") n ON true " +
    "LEFT JOIN LATERAL (" +
    "SELECT count(*)::integer AS exception_count," +
    "max(detected_at) AS latest_at," +
    "(array_agg(exception_kind ORDER BY detected_at DESC,id DESC))[1] AS latest_kind " +
    "FROM hubtel_pos_settlement_exceptions WHERE attempt_id=a.id" +
    ") e ON true " +
    "JOIN sales s ON s.id=a.sale_id AND s.business_id=a.business_id " +
    "JOIN payments p ON p.id=a.payment_id AND p.business_id=a.business_id " +
    "WHERE a.business_id=$1 AND ($2::uuid IS NULL OR a.branch_id=$2::uuid) " +
    "ORDER BY (a.state='REVIEW_REQUIRED') DESC,a.created_at DESC,a.id DESC " +
    "LIMIT $3::integer",
    values,
  );
  const attempts = results.rows.map((row) => ({
    attemptId: row.id,
    saleId: row.sale_id,
    branchId: row.branch_id,
    state: row.state,
    saleStatus: row.sale_status,
    paymentStatus: row.payment_status,
    amountMinor: Number(row.expected_amount_minor),
    currencyCode: row.currency_code,
    createdAt: row.created_at.toISOString(),
    lastCheckedAt: row.last_status_checked_at?.toISOString() ?? null,
    nextCheckAt: row.next_status_check_at?.toISOString() ?? null,
    statusCheckAttempts: row.status_check_attempts,
    lastStatusResult: row.last_status_check_result,
    lastErrorCode: row.last_status_error_code,
    reviewRequestedAt: row.review_requested_at?.toISOString() ?? null,
    notificationCount:row.notification_count,
    lastNotificationHint:row.last_notification_hint,
    lastNotificationAt:row.last_notification_at?.toISOString() ?? null,
    notificationTrust:"UNTRUSTED" as const,
    postSettlementCheckedAt:row.last_post_settlement_checked_at?.toISOString()??null,
    settlementExceptionCount:row.settlement_exception_count,
    settlementExceptionKind:row.settlement_exception_kind,
    settlementExceptionAt:row.settlement_exception_at?.toISOString()??null,
  }));
  const summary = await pool.query<{
    awaiting: string; review_required: string; reconciled: string;
    settlement_alerts:string;
  }>(
    "SELECT COUNT(*) FILTER(WHERE state IN ('PREPARED','READY','PENDING_VERIFICATION'))::text AS awaiting," +
    "COUNT(*) FILTER(WHERE state='REVIEW_REQUIRED')::text AS review_required," +
    "COUNT(*) FILTER(WHERE state='RECONCILED')::text AS reconciled," +
    "(SELECT count(DISTINCT e.attempt_id)::text " +
    "FROM hubtel_pos_settlement_exceptions e " +
    "WHERE e.business_id=$1 AND " +
    "($2::uuid IS NULL OR e.branch_id=$2::uuid)) AS settlement_alerts " +
    "FROM hubtel_sale_checkout_attempts " +
    "WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2::uuid)",
    [input.businessId, input.branchId ?? null],
  );
  return {
    attempts,
    summary: {
      awaiting: Number(summary.rows[0]?.awaiting ?? 0),
      reviewRequired: Number(summary.rows[0]?.review_required ?? 0),
      reconciled: Number(summary.rows[0]?.reconciled ?? 0),
      settlementAlerts:Number(summary.rows[0]?.settlement_alerts??0),
    },
  };
}
