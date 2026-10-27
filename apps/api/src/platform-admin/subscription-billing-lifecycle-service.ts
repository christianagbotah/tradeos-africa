import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../db.js";
import { PlatformAdminError } from "./security.js";

export type SubscriptionPeriodInvoiceInput = {
  businessId: string;
  subscriptionId: string;
  currencyCode: string;
  amountMinor: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  dueDays?: number;
};

export async function issueSubscriptionPeriodInvoice(
  client: DatabaseClient,
  input: SubscriptionPeriodInvoiceInput,
): Promise<{ invoiceId: string; created: boolean }> {
  assertInvoiceInput(input);
  const invoiceId = randomUUID();
  const invoiceNumber = `TOS-${dateStamp(input.now)}-${invoiceId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const dueAt = new Date(input.now.getTime() + (input.dueDays ?? 7) * 86_400_000);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subscription_invoices(
       id,business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,
       amount_paid_minor,status,period_start,period_end,issued_at,due_at,provider,provider_invoice_reference
     ) VALUES($1,$2,$3,$4,$5,$6,0,$6,0,'OPEN',$7,$8,$9,$10,NULL,NULL)
     ON CONFLICT (subscription_id,period_start,period_end) WHERE status <> 'VOID'
     DO NOTHING
     RETURNING id`,
    [
      invoiceId,
      input.businessId,
      input.subscriptionId,
      invoiceNumber,
      input.currencyCode.trim().toUpperCase(),
      input.amountMinor,
      input.periodStart,
      input.periodEnd,
      input.now,
      dueAt,
    ],
  );
  const created = inserted.rows[0]?.id === invoiceId;
  const effectiveId = created
    ? invoiceId
    : await findExistingPeriodInvoice(client, input.subscriptionId, input.periodStart, input.periodEnd);

  if (created) {
    await client.query(
      `INSERT INTO platform_audit_events(
         platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload
       ) VALUES(NULL,$1,'SUBSCRIPTION_INVOICE_ISSUED','SUBSCRIPTION_INVOICE',$2,$3,$4::jsonb)`,
      [
        input.businessId,
        invoiceId,
        "Subscription invoice issued by billing lifecycle",
        JSON.stringify({
          subscriptionId: input.subscriptionId,
          periodStart: input.periodStart.toISOString(),
          periodEnd: input.periodEnd.toISOString(),
          currencyCode: input.currencyCode.trim().toUpperCase(),
          totalMinor: input.amountMinor,
        }),
      ],
    );
  }
  return { invoiceId: effectiveId, created };
}

async function findExistingPeriodInvoice(
  client: DatabaseClient,
  subscriptionId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM subscription_invoices
     WHERE subscription_id=$1 AND period_start=$2 AND period_end=$3 AND status <> 'VOID'
     ORDER BY created_at,id LIMIT 1`,
    [subscriptionId, periodStart, periodEnd],
  );
  const id = existing.rows[0]?.id;
  if (!id) {
    throw new PlatformAdminError(
      "Subscription invoice could not be resolved after a concurrent issuance attempt",
      409,
      "ADMIN_INVOICE_PERIOD_CONFLICT",
    );
  }
  return id;
}

function assertInvoiceInput(input: SubscriptionPeriodInvoiceInput): void {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new PlatformAdminError("Subscription invoice amount is invalid", 400, "ADMIN_INVOICE_AMOUNT_INVALID");
  }
  if (!/^[A-Z]{3}$/.test(input.currencyCode.trim().toUpperCase())) {
    throw new PlatformAdminError("Subscription invoice currency is invalid", 400, "ADMIN_INVOICE_CURRENCY_INVALID");
  }
  if (!Number.isFinite(input.periodStart.getTime()) || !Number.isFinite(input.periodEnd.getTime()) || input.periodEnd <= input.periodStart) {
    throw new PlatformAdminError("Subscription invoice period is invalid", 400, "ADMIN_INVOICE_PERIOD_INVALID");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new PlatformAdminError("Subscription invoice issue time is invalid", 400, "ADMIN_INVOICE_TIME_INVALID");
  }
  const dueDays = input.dueDays ?? 7;
  if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
    throw new PlatformAdminError("Subscription invoice due period is invalid", 400, "ADMIN_INVOICE_DUE_INVALID");
  }
}

function dateStamp(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}
