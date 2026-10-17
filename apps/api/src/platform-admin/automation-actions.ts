import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { changeTenantStatus } from "./tenant-service.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

export interface PlatformAutomationActionResult {
  actionType: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
}

export async function executeApprovedPlatformAction(
  pool: DatabasePool,
  actor: PlatformAdminContext | null,
  actionType: string,
  configuration: Record<string, unknown>,
): Promise<PlatformAutomationActionResult> {
  if (actionType === "RECORD_ONLY") {
    return { actionType, summary: "Information recorded; no platform state was changed.", entityType: null, entityId: null };
  }

  if (actionType === "RESOLVE_ATTENTION") {
    const attentionItemId = requireUuid(configuration.attentionItemId, "ADMIN_AUTOMATION_ACTION_INVALID");
    const reason = requireReason(configuration.reason);
    await withTransaction(pool, async (client) => {
      const found = await client.query<{ id: string; business_id: string | null; state: string }>(
        "SELECT id,business_id,state FROM platform_attention_items WHERE id=$1 FOR UPDATE",
        [attentionItemId],
      );
      const item = found.rows[0];
      if (!item) throw new PlatformAdminError("Attention item was not found", 404, "ADMIN_AUTOMATION_TARGET_NOT_FOUND");
      if (item.state !== "OPEN") {
        throw new PlatformAdminError("Attention item is no longer open", 409, "ADMIN_AUTOMATION_TARGET_STALE");
      }
      await client.query(
        "UPDATE platform_attention_items SET state='RESOLVED',resolved_at=now(),updated_at=now() WHERE id=$1",
        [attentionItemId],
      );
      await client.query(
        `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
         VALUES($1,$2,'ATTENTION_RESOLVED','PLATFORM_ATTENTION_ITEM',$3,$4,$5::jsonb)`,
        [actor?.id ?? null, item.business_id, attentionItemId, reason, JSON.stringify({ source: actor ? "AUTOMATION" : "SYSTEM_AUTOMATION" })],
      );
    });
    return { actionType, summary: "Attention item resolved.", entityType: "PLATFORM_ATTENTION_ITEM", entityId: attentionItemId };
  }

  if (actionType === "TENANT_STATUS_CHANGE") {
    if (!actor) {
      throw new PlatformAdminError(
        "Tenant status changes require an authorized human administrator",
        403,
        "ADMIN_AUTOMATION_HUMAN_REQUIRED",
      );
    }
    const businessId = requireUuid(configuration.businessId, "ADMIN_AUTOMATION_ACTION_INVALID");
    const status = configuration.status === "ACTIVE" || configuration.status === "SUSPENDED" ? configuration.status : null;
    if (!status) throw new PlatformAdminError("Tenant status action is invalid", 400, "ADMIN_AUTOMATION_ACTION_INVALID");
    const expectedUpdatedAt = requireString(configuration.expectedUpdatedAt, "ADMIN_AUTOMATION_ACTION_INVALID");
    const reason = requireReason(configuration.reason);
    try {
      await changeTenantStatus(pool, actor, businessId, { status, expectedUpdatedAt, reason });
    } catch (error) {
      if (error instanceof PlatformAdminError && error.code === "ADMIN_TENANT_STALE") {
        throw new PlatformAdminError(
          "The target changed after this automation was proposed. Refresh the evidence before trying again.",
          409,
          "ADMIN_AUTOMATION_TARGET_STALE",
        );
      }
      throw error;
    }
    return { actionType, summary: `Tenant status changed to ${status}.`, entityType: "BUSINESS", entityId: businessId };
  }

  throw new PlatformAdminError("Automation action is not allow-listed", 400, "ADMIN_AUTOMATION_ACTION_NOT_ALLOWED");
}

function requireReason(value: unknown): string {
  const reason = requireString(value, "ADMIN_AUTOMATION_REASON_REQUIRED").trim();
  if (reason.length > 500) throw new PlatformAdminError("Automation reason is too long", 400, "ADMIN_AUTOMATION_REASON_INVALID");
  return reason;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlatformAdminError("Required automation action value is missing", 400, code);
  }
  return value.trim();
}

function requireUuid(value: unknown, code: string): string {
  const text = requireString(value, code);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw new PlatformAdminError("Automation action target is invalid", 400, code);
  }
  return text;
}
