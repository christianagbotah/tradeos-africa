import type { AiGroundingEvidence } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { listPlatformAttention } from "./attention-service.js";
import { getPlatformMetrics } from "./metrics-service.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

export const ADMIN_INTELLIGENCE_TOOLS = [
  "tenant_summary",
  "tenant_detail",
  "platform_metrics",
  "attention_items",
  "invoice_payment_summary",
  "device_sync_health",
  "release_health",
  "recent_audit_summary",
] as const;

export type AdminIntelligenceTool = typeof ADMIN_INTELLIGENCE_TOOLS[number];

const TOOL_SET = new Set<string>(ADMIN_INTELLIGENCE_TOOLS);

export function parseAdminIntelligenceTools(input: unknown): AdminIntelligenceTool[] {
  const raw = input === undefined ? ["platform_metrics", "attention_items"] : input;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ADMIN_INTELLIGENCE_TOOLS.length) {
    throw new PlatformAdminError("Select one or more supported intelligence tools.", 400, "ADMIN_AI_TOOL_NOT_ALLOWED");
  }
  const tools: AdminIntelligenceTool[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !TOOL_SET.has(item)) {
      throw new PlatformAdminError("Requested intelligence tool is not allow-listed.", 400, "ADMIN_AI_TOOL_NOT_ALLOWED");
    }
    const tool = item as AdminIntelligenceTool;
    if (!tools.includes(tool)) tools.push(tool);
  }
  return tools;
}

export async function collectAdminIntelligenceEvidence(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  tools: AdminIntelligenceTool[],
  options: { businessId?: string } = {},
): Promise<AiGroundingEvidence[]> {
  const evidence: AiGroundingEvidence[] = [];
  for (const tool of tools) {
    switch (tool) {
      case "platform_metrics": {
        const metrics = await getPlatformMetrics(pool, actor);
        evidence.push({
          sourceType: "PLATFORM_METRICS",
          sourceId: "platform",
          label: "Authoritative platform metrics",
          value: metrics,
          observedAt: metrics.generatedAt,
        });
        break;
      }
      case "attention_items": {
        const items = await listPlatformAttention(pool, actor);
        for (const item of items) {
          evidence.push({
            sourceType: "ATTENTION_ITEM",
            sourceId: item.id,
            label: `${item.ruleCode}: ${item.title}`,
            value: {
              businessId: item.businessId,
              entityType: item.entityType,
              entityId: item.entityId,
              severity: item.severity,
              summary: item.summary,
              evidence: item.evidence,
            },
            observedAt: item.lastSeenAt,
          });
        }
        break;
      }
      case "tenant_summary": {
        const result = await pool.query<{
          id: string; name: string; business_type: string; country_code: string; currency_code: string;
          timezone: string; status: string; updated_at: Date;
        }>(
          `SELECT id,name,business_type,country_code,currency_code,timezone,status,updated_at
           FROM businesses ORDER BY updated_at DESC,id LIMIT 100`,
        );
        for (const row of result.rows) {
          evidence.push({
            sourceType: "TENANT_SUMMARY",
            sourceId: row.id,
            label: row.name,
            value: {
              businessType: row.business_type,
              countryCode: row.country_code,
              currencyCode: row.currency_code,
              timezone: row.timezone,
              status: row.status,
            },
            observedAt: row.updated_at.toISOString(),
          });
        }
        break;
      }
      case "tenant_detail": {
        if (!options.businessId) {
          throw new PlatformAdminError("Tenant detail intelligence requires a businessId.", 400, "ADMIN_AI_BUSINESS_REQUIRED");
        }
        const result = await pool.query<{
          id: string; name: string; business_type: string; country_code: string; currency_code: string;
          timezone: string; status: string; created_at: Date; updated_at: Date;
        }>(
          `SELECT id,name,business_type,country_code,currency_code,timezone,status,created_at,updated_at
           FROM businesses WHERE id=$1 LIMIT 1`,
          [options.businessId],
        );
        const row = result.rows[0];
        if (!row) throw new PlatformAdminError("Tenant was not found.", 404, "ADMIN_TENANT_NOT_FOUND");
        evidence.push({
          sourceType: "TENANT_DETAIL",
          sourceId: row.id,
          label: row.name,
          value: {
            businessType: row.business_type,
            countryCode: row.country_code,
            currencyCode: row.currency_code,
            timezone: row.timezone,
            status: row.status,
            createdAt: row.created_at.toISOString(),
          },
          observedAt: row.updated_at.toISOString(),
        });
        break;
      }
      case "invoice_payment_summary": {
        const invoices = await pool.query<{
          currency_code: string; open_count: string; overdue_count: string; outstanding_minor: string;
        }>(
          `SELECT currency_code,
                  count(*) FILTER (WHERE status IN ('OPEN','PARTIALLY_PAID'))::text AS open_count,
                  count(*) FILTER (WHERE status IN ('OPEN','PARTIALLY_PAID') AND due_at<now())::text AS overdue_count,
                  coalesce(sum(greatest(total_minor-amount_paid_minor,0)) FILTER (WHERE status IN ('OPEN','PARTIALLY_PAID')),0)::text AS outstanding_minor
           FROM subscription_invoices
           ${options.businessId ? "WHERE business_id=$1" : ""}
           GROUP BY currency_code ORDER BY currency_code`,
          options.businessId ? [options.businessId] : [],
        );
        const payments = await pool.query<{
          status: string; payment_count: string; amount_minor: string;
        }>(
          `SELECT status,count(*)::text AS payment_count,coalesce(sum(amount_minor),0)::text AS amount_minor
           FROM subscription_payments
           ${options.businessId ? "WHERE business_id=$1" : ""}
           GROUP BY status ORDER BY status`,
          options.businessId ? [options.businessId] : [],
        );
        evidence.push({
          sourceType: "BILLING_SUMMARY",
          sourceId: options.businessId ?? "platform",
          label: "SaaS invoice and payment summary",
          value: { invoices: invoices.rows, payments: payments.rows },
          observedAt: new Date().toISOString(),
        });
        break;
      }
      case "device_sync_health": {
        const result = await pool.query<{
          total: string; online: string; stale: string; unknown: string; sync_risk: string;
        }>(
          `SELECT count(*)::text AS total,
                  count(*) FILTER (WHERE last_seen_at>=now()-interval '15 minutes')::text AS online,
                  count(*) FILTER (WHERE last_seen_at<now()-interval '15 minutes')::text AS stale,
                  count(*) FILTER (WHERE last_seen_at IS NULL)::text AS unknown,
                  count(*) FILTER (WHERE last_sync_at IS NULL OR last_sync_at<now()-interval '1 hour')::text AS sync_risk
           FROM registered_devices
           WHERE status='ACTIVE' ${options.businessId ? "AND business_id=$1" : ""}`,
          options.businessId ? [options.businessId] : [],
        );
        evidence.push({
          sourceType: "DEVICE_SYNC_HEALTH",
          sourceId: options.businessId ?? "platform",
          label: "Device and sync health",
          value: result.rows[0] ?? { total: "0", online: "0", stale: "0", unknown: "0", sync_risk: "0" },
          observedAt: new Date().toISOString(),
        });
        break;
      }
      case "release_health": {
        const result = await pool.query<{
          id: string; platform: string; version: string; release_channel: string; status: string;
          minimum_supported_version: string | null; rollout_percent: number; released_at: Date | null; created_at: Date;
        }>(
          `SELECT id,platform,version,release_channel,status,minimum_supported_version,rollout_percent,released_at,created_at
           FROM client_releases ORDER BY created_at DESC,id DESC LIMIT 30`,
        );
        for (const row of result.rows) {
          evidence.push({
            sourceType: "RELEASE_HEALTH",
            sourceId: row.id,
            label: `${row.platform} ${row.release_channel} ${row.version}`,
            value: {
              status: row.status,
              minimumSupportedVersion: row.minimum_supported_version,
              rolloutPercent: row.rollout_percent,
              releasedAt: row.released_at?.toISOString() ?? null,
            },
            observedAt: row.created_at.toISOString(),
          });
        }
        break;
      }
      case "recent_audit_summary": {
        const result = await pool.query<{
          id: string; business_id: string | null; event_type: string; entity_type: string;
          entity_id: string | null; reason: string | null; occurred_at: Date;
        }>(
          `SELECT id,business_id,event_type,entity_type,entity_id,reason,occurred_at
           FROM platform_audit_events
           ${options.businessId ? "WHERE business_id=$1" : ""}
           ORDER BY occurred_at DESC,id DESC LIMIT 50`,
          options.businessId ? [options.businessId] : [],
        );
        for (const row of result.rows) {
          evidence.push({
            sourceType: "AUDIT_EVENT",
            sourceId: row.id,
            label: `${row.event_type} · ${row.entity_type}`,
            value: {
              businessId: row.business_id,
              entityId: row.entity_id,
              reason: row.reason,
            },
            observedAt: row.occurred_at.toISOString(),
          });
        }
        break;
      }
    }
  }
  return evidence;
}
