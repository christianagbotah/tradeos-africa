import type {
  AdminSubscriptionInvoice,
  AdminSubscriptionInvoiceStatus,
  AdminSubscriptionPayment,
  AdminSubscriptionPaymentRefund,
  AdminSubscriptionPaymentStatus,
  AdminSubscriptionRefundStatus,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

const WRITE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "BILLING"]);
const PAYMENT_STATUSES = new Set<AdminSubscriptionPaymentStatus>([
  "PENDING", "SUCCEEDED", "FAILED", "REVERSED", "REFUNDED", "PARTIALLY_REFUNDED",
]);
const RECONCILE_STATUSES = new Set<AdminSubscriptionPaymentStatus>(["PENDING", "SUCCEEDED", "FAILED", "REVERSED"]);
const REFUND_STATUSES = new Set<AdminSubscriptionRefundStatus>(["REQUESTED", "SUCCEEDED", "FAILED"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = Pick<DatabasePool, "query"> | Pick<DatabaseClient, "query">;

type InvoiceRow = {
  id: string; business_id: string; business_name: string; subscription_id: string; invoice_number: string;
  currency_code: string; subtotal_minor: string | number; tax_minor: string | number; total_minor: string | number;
  amount_paid_minor: string | number; status: AdminSubscriptionInvoiceStatus; period_start: Date; period_end: Date;
  issued_at: Date; due_at: Date; paid_at: Date | null; provider: string | null; provider_invoice_reference: string | null;
  created_at: Date; updated_at: Date;
};
type PaymentRow = {
  id: string; business_id: string; business_name: string; invoice_id: string; invoice_number: string;
  amount_minor: string | number; currency_code: string; method: string; provider: string;
  provider_event_reference: string; provider_transaction_reference: string; status: AdminSubscriptionPaymentStatus;
  failure_code: string | null; failure_message: string | null; received_at: Date; reconciled_at: Date | null;
  created_at: Date; updated_at: Date;
};
type RefundRow = {
  id: string; business_id: string; payment_id: string; amount_minor: string | number; currency_code: string;
  provider: string; provider_event_reference: string; provider_refund_reference: string; status: AdminSubscriptionRefundStatus;
  failure_code: string | null; failure_message: string | null; requested_at: Date; completed_at: Date | null;
  created_at: Date; updated_at: Date;
};
type LockedInvoice = { id: string; business_id: string; currency_code: string; total_minor: string | number; status: AdminSubscriptionInvoiceStatus };
type LockedPayment = { id: string; business_id: string; invoice_id: string; amount_minor: string | number; currency_code: string; status: AdminSubscriptionPaymentStatus };

export interface ProviderPaymentInput {
  businessId: string;
  invoiceId: string;
  amountMinor: number;
  currencyCode: string;
  method: string;
  provider: string;
  providerEventReference: string;
  providerTransactionReference: string;
  status: AdminSubscriptionPaymentStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  receivedAt: string;
}

export interface ProviderRefundInput {
  businessId: string;
  paymentId: string;
  amountMinor: number;
  currencyCode: string;
  provider: string;
  providerEventReference: string;
  providerRefundReference: string;
  status: AdminSubscriptionRefundStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
  requestedAt?: string;
  completedAt?: string | null;
}

export type NormalizedBillingEvent =
  | { type: "PAYMENT"; payment: ProviderPaymentInput }
  | { type: "REFUND"; refund: ProviderRefundInput };

export interface SubscriptionPaymentProviderAdapter {
  verifyAndNormalize(request: unknown): Promise<NormalizedBillingEvent>;
}

export async function listInvoices(pool: DatabasePool): Promise<AdminSubscriptionInvoice[]> {
  const result = await pool.query<InvoiceRow>(invoiceSelect("ORDER BY i.issued_at DESC,i.id DESC"));
  return result.rows.map(mapInvoice);
}

export async function getInvoice(pool: DatabasePool, invoiceId: string): Promise<AdminSubscriptionInvoice> {
  requireUuid(invoiceId, "ADMIN_INVOICE_NOT_FOUND", "Invoice was not found");
  const result = await pool.query<InvoiceRow>(invoiceSelect("WHERE i.id=$1"), [invoiceId]);
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Invoice was not found", 404, "ADMIN_INVOICE_NOT_FOUND");
  return mapInvoice(row);
}

export async function listSubscriptionPayments(pool: DatabasePool): Promise<AdminSubscriptionPayment[]> {
  const result = await pool.query<PaymentRow>(paymentSelect("ORDER BY p.received_at DESC,p.id DESC"));
  return result.rows.map(mapPayment);
}

export async function recordProviderPayment(pool: DatabasePool, input: ProviderPaymentInput): Promise<AdminSubscriptionPayment> {
  const next = parsePaymentInput(input);
  const paymentId = await withTransaction(pool, async (client) => {
    const invoice = await lockInvoice(client, next.invoiceId);
    assertInvoiceMatchesPayment(invoice, next);
    const existing = await findExistingPayment(client, next.provider, next.providerEventReference, next.providerTransactionReference);
    if (existing.length) {
      if (existing.length !== 1 || !samePaymentIdentity(existing[0]!, next)) {
        throw new PlatformAdminError("Provider payment replay conflicts with the recorded event", 409, "ADMIN_BILLING_IDEMPOTENCY_CONFLICT");
      }
      return existing[0]!.id;
    }
    assertCollectible(invoice);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subscription_payments(
         business_id,invoice_id,amount_minor,currency_code,method,provider,provider_event_reference,
         provider_transaction_reference,status,failure_code,failure_message,received_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [next.businessId,next.invoiceId,next.amountMinor,next.currencyCode,next.method,next.provider,next.providerEventReference,
       next.providerTransactionReference,next.status,next.failureCode,next.failureMessage,next.receivedAt],
    );
    const id = inserted.rows[0]!.id;
    await recomputeInvoice(client, invoice.id);
    await writeAudit(client, null, next.businessId, "SUBSCRIPTION_PAYMENT_RECORDED", "SUBSCRIPTION_PAYMENT", id,
      "Verified provider payment event recorded", {
        provider: next.provider, providerEventReference: next.providerEventReference,
        providerTransactionReference: next.providerTransactionReference, status: next.status, amountMinor: next.amountMinor,
      });
    return id;
  });
  return getPayment(pool, paymentId);
}

export async function recordProviderRefund(pool: DatabasePool, input: ProviderRefundInput): Promise<AdminSubscriptionPaymentRefund> {
  const next = parseRefundInput(input);
  const refundId = await withTransaction(pool, async (client) => {
    const paymentResult = await client.query<LockedPayment>(
      `SELECT id,business_id,invoice_id,amount_minor,currency_code,status FROM subscription_payments WHERE id=$1 FOR UPDATE`,
      [next.paymentId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new PlatformAdminError("Subscription payment was not found", 404, "ADMIN_PAYMENT_NOT_FOUND");
    if (payment.business_id !== next.businessId || payment.currency_code.trim() !== next.currencyCode) {
      throw new PlatformAdminError("Refund does not match the original payment", 409, "ADMIN_BILLING_REFERENCE_MISMATCH");
    }
    const existing = await findExistingRefund(client, next.provider, next.providerEventReference, next.providerRefundReference);
    if (existing.length) {
      if (existing.length !== 1 || !sameRefundIdentity(existing[0]!, next)) {
        throw new PlatformAdminError("Provider refund replay conflicts with the recorded event", 409, "ADMIN_BILLING_IDEMPOTENCY_CONFLICT");
      }
      return existing[0]!.id;
    }
    if (!["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) {
      throw new PlatformAdminError("Only a successful payment can be refunded", 409, "ADMIN_PAYMENT_NOT_REFUNDABLE");
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subscription_payment_refunds(
         business_id,payment_id,amount_minor,currency_code,provider,provider_event_reference,provider_refund_reference,
         status,failure_code,failure_message,requested_at,completed_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [next.businessId,next.paymentId,next.amountMinor,next.currencyCode,next.provider,next.providerEventReference,
       next.providerRefundReference,next.status,next.failureCode,next.failureMessage,next.requestedAt,next.completedAt],
    );
    const id = inserted.rows[0]!.id;
    if (next.status === "SUCCEEDED") {
      await refreshPaymentRefundStatus(client, payment.id);
      await recomputeInvoice(client, payment.invoice_id);
    }
    await writeAudit(client, null, next.businessId, "SUBSCRIPTION_REFUND_RECORDED", "SUBSCRIPTION_PAYMENT_REFUND", id,
      "Verified provider refund event recorded", {
        provider: next.provider, providerEventReference: next.providerEventReference,
        providerRefundReference: next.providerRefundReference, status: next.status, amountMinor: next.amountMinor,
      });
    return id;
  });
  return getRefund(pool, refundId);
}

export async function reconcilePayment(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  paymentId: string,
  input: { status?: unknown; reason?: unknown },
): Promise<AdminSubscriptionPayment> {
  requireWriteRole(actor);
  requireUuid(paymentId, "ADMIN_PAYMENT_NOT_FOUND", "Subscription payment was not found");
  const status = parseReconcileStatus(input.status);
  const reason = parseReason(input.reason);
  await withTransaction(pool, async (client) => {
    const found = await client.query<LockedPayment>(
      `SELECT id,business_id,invoice_id,amount_minor,currency_code,status FROM subscription_payments WHERE id=$1 FOR UPDATE`,
      [paymentId],
    );
    const current = found.rows[0];
    if (!current) throw new PlatformAdminError("Subscription payment was not found", 404, "ADMIN_PAYMENT_NOT_FOUND");
    if (current.status === "PARTIALLY_REFUNDED" || current.status === "REFUNDED") {
      throw new PlatformAdminError("A refunded payment cannot be reconciled to another status", 409, "ADMIN_PAYMENT_RECONCILE_INVALID");
    }
    if (status === "SUCCEEDED") {
      const invoice = await lockInvoice(client, current.invoice_id);
      assertCollectible(invoice);
    }
    await client.query(
      `UPDATE subscription_payments
       SET status=$2,reconciled_at=now(),updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`, [paymentId,status],
    );
    await recomputeInvoice(client, current.invoice_id);
    await writeAudit(client, actor.id, current.business_id, "SUBSCRIPTION_PAYMENT_RECONCILED", "SUBSCRIPTION_PAYMENT", paymentId, reason, {
      previous: { status: current.status }, next: { status },
    });
  });
  return getPayment(pool, paymentId);
}

async function getPayment(queryable: Queryable, paymentId: string): Promise<AdminSubscriptionPayment> {
  const result = await queryable.query<PaymentRow>(paymentSelect("WHERE p.id=$1"), [paymentId]);
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Subscription payment was not found", 404, "ADMIN_PAYMENT_NOT_FOUND");
  return mapPayment(row);
}

async function getRefund(queryable: Queryable, refundId: string): Promise<AdminSubscriptionPaymentRefund> {
  const result = await queryable.query<RefundRow>(
    `SELECT id,business_id,payment_id,amount_minor,currency_code,provider,provider_event_reference,provider_refund_reference,
            status,failure_code,failure_message,requested_at,completed_at,created_at,updated_at
     FROM subscription_payment_refunds WHERE id=$1`, [refundId],
  );
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Subscription refund was not found", 404, "ADMIN_REFUND_NOT_FOUND");
  return mapRefund(row);
}

async function lockInvoice(client: DatabaseClient, invoiceId: string): Promise<LockedInvoice> {
  const result = await client.query<LockedInvoice>(
    `SELECT id,business_id,currency_code,total_minor,status FROM subscription_invoices WHERE id=$1 FOR UPDATE`, [invoiceId],
  );
  const invoice = result.rows[0];
  if (!invoice) throw new PlatformAdminError("Invoice was not found", 404, "ADMIN_INVOICE_NOT_FOUND");
  return invoice;
}

async function findExistingPayment(client: DatabaseClient, provider: string, eventRef: string, transactionRef: string): Promise<PaymentRow[]> {
  const result = await client.query<PaymentRow>(
    paymentSelect("WHERE p.provider=$1 AND (p.provider_event_reference=$2 OR p.provider_transaction_reference=$3) FOR UPDATE OF p"),
    [provider,eventRef,transactionRef],
  );
  return result.rows;
}

async function findExistingRefund(client: DatabaseClient, provider: string, eventRef: string, refundRef: string): Promise<RefundRow[]> {
  const result = await client.query<RefundRow>(
    `SELECT id,business_id,payment_id,amount_minor,currency_code,provider,provider_event_reference,provider_refund_reference,
            status,failure_code,failure_message,requested_at,completed_at,created_at,updated_at
     FROM subscription_payment_refunds
     WHERE provider=$1 AND (provider_event_reference=$2 OR provider_refund_reference=$3)
     FOR UPDATE`, [provider,eventRef,refundRef],
  );
  return result.rows;
}

async function refreshPaymentRefundStatus(client: DatabaseClient, paymentId: string): Promise<void> {
  const payment = await client.query<{ amount_minor: string | number }>(
    "SELECT amount_minor FROM subscription_payments WHERE id=$1 FOR UPDATE", [paymentId],
  );
  const amount = safeMinor(payment.rows[0]!.amount_minor);
  const refunds = await client.query<{ refunded_minor: string }>(
    `SELECT COALESCE(SUM(amount_minor),0)::text AS refunded_minor
     FROM subscription_payment_refunds WHERE payment_id=$1 AND status='SUCCEEDED'`, [paymentId],
  );
  const refunded = safeMinor(refunds.rows[0]!.refunded_minor);
  if (refunded > amount) throw new PlatformAdminError("Refund total exceeds the original payment", 409, "ADMIN_REFUND_EXCEEDS_PAYMENT");
  const status: AdminSubscriptionPaymentStatus = refunded === amount ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : "SUCCEEDED";
  await client.query(
    `UPDATE subscription_payments SET status=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1`,
    [paymentId,status],
  );
}

async function recomputeInvoice(client: DatabaseClient, invoiceId: string): Promise<void> {
  const invoiceResult = await client.query<{ total_minor: string | number; status: AdminSubscriptionInvoiceStatus }>(
    "SELECT total_minor,status FROM subscription_invoices WHERE id=$1 FOR UPDATE", [invoiceId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) throw new PlatformAdminError("Invoice was not found", 404, "ADMIN_INVOICE_NOT_FOUND");
  const payments = await client.query<{ gross_minor: string }>(
    `SELECT COALESCE(SUM(amount_minor),0)::text AS gross_minor
     FROM subscription_payments
     WHERE invoice_id=$1 AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')`, [invoiceId],
  );
  const refunds = await client.query<{ refunded_minor: string }>(
    `SELECT COALESCE(SUM(r.amount_minor),0)::text AS refunded_minor
     FROM subscription_payment_refunds r
     JOIN subscription_payments p ON p.id=r.payment_id
     WHERE p.invoice_id=$1 AND r.status='SUCCEEDED'`, [invoiceId],
  );
  const gross = safeMinor(payments.rows[0]!.gross_minor);
  const refunded = safeMinor(refunds.rows[0]!.refunded_minor);
  if (refunded > gross) throw new PlatformAdminError("Refund total exceeds collected payments", 409, "ADMIN_REFUND_EXCEEDS_PAYMENT");
  const net = gross - refunded;
  const total = safeMinor(invoice.total_minor);
  if (net > total) throw new PlatformAdminError("Collected amount exceeds invoice total", 409, "ADMIN_BILLING_OVERPAYMENT");
  let status: AdminSubscriptionInvoiceStatus;
  if (gross > 0 && refunded === gross) status = "REFUNDED";
  else if (net === 0) status = "OPEN";
  else if (net < total) status = "PARTIALLY_PAID";
  else status = "PAID";
  await client.query(
    `UPDATE subscription_invoices
     SET amount_paid_minor=$2,status=$3,
         paid_at=CASE WHEN $3='PAID' THEN COALESCE(paid_at,now()) ELSE paid_at END,
         updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
     WHERE id=$1`, [invoiceId,net,status],
  );
}

function assertInvoiceMatchesPayment(invoice: LockedInvoice, input: ReturnType<typeof parsePaymentInput>): void {
  if (invoice.business_id !== input.businessId || invoice.currency_code.trim() !== input.currencyCode) {
    throw new PlatformAdminError("Payment does not match the invoice", 409, "ADMIN_BILLING_REFERENCE_MISMATCH");
  }
}
function assertCollectible(invoice: LockedInvoice): void {
  if (["DRAFT","VOID","UNCOLLECTIBLE","REFUNDED"].includes(invoice.status)) {
    throw new PlatformAdminError("Invoice is not collectible", 409, "ADMIN_INVOICE_NOT_COLLECTIBLE");
  }
}
function samePaymentIdentity(row: PaymentRow, input: ReturnType<typeof parsePaymentInput>): boolean {
  return row.business_id === input.businessId && row.invoice_id === input.invoiceId && safeMinor(row.amount_minor) === input.amountMinor &&
    row.currency_code.trim() === input.currencyCode && row.method === input.method && row.provider === input.provider &&
    row.provider_event_reference === input.providerEventReference && row.provider_transaction_reference === input.providerTransactionReference;
}
function sameRefundIdentity(row: RefundRow, input: ReturnType<typeof parseRefundInput>): boolean {
  return row.business_id === input.businessId && row.payment_id === input.paymentId && safeMinor(row.amount_minor) === input.amountMinor &&
    row.currency_code.trim() === input.currencyCode && row.provider === input.provider &&
    row.provider_event_reference === input.providerEventReference && row.provider_refund_reference === input.providerRefundReference;
}

function invoiceSelect(suffix: string): string {
  return `SELECT i.id,i.business_id,b.name AS business_name,i.subscription_id,i.invoice_number,i.currency_code,
                 i.subtotal_minor,i.tax_minor,i.total_minor,i.amount_paid_minor,i.status,i.period_start,i.period_end,
                 i.issued_at,i.due_at,i.paid_at,i.provider,i.provider_invoice_reference,i.created_at,i.updated_at
          FROM subscription_invoices i JOIN businesses b ON b.id=i.business_id ${suffix}`;
}
function paymentSelect(suffix: string): string {
  return `SELECT p.id,p.business_id,b.name AS business_name,p.invoice_id,i.invoice_number,p.amount_minor,p.currency_code,
                 p.method,p.provider,p.provider_event_reference,p.provider_transaction_reference,p.status,p.failure_code,
                 p.failure_message,p.received_at,p.reconciled_at,p.created_at,p.updated_at
          FROM subscription_payments p
          JOIN businesses b ON b.id=p.business_id
          JOIN subscription_invoices i ON i.id=p.invoice_id ${suffix}`;
}
function mapInvoice(row: InvoiceRow): AdminSubscriptionInvoice {
  return {
    id:row.id,businessId:row.business_id,businessName:row.business_name,subscriptionId:row.subscription_id,
    invoiceNumber:row.invoice_number,currencyCode:row.currency_code.trim(),subtotalMinor:safeMinor(row.subtotal_minor),
    taxMinor:safeMinor(row.tax_minor),totalMinor:safeMinor(row.total_minor),amountPaidMinor:safeMinor(row.amount_paid_minor),
    status:row.status,periodStart:row.period_start.toISOString(),periodEnd:row.period_end.toISOString(),issuedAt:row.issued_at.toISOString(),
    dueAt:row.due_at.toISOString(),paidAt:iso(row.paid_at),provider:row.provider,providerInvoiceReference:row.provider_invoice_reference,
    createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),
  };
}
function mapPayment(row: PaymentRow): AdminSubscriptionPayment {
  return {
    id:row.id,businessId:row.business_id,businessName:row.business_name,invoiceId:row.invoice_id,invoiceNumber:row.invoice_number,
    amountMinor:safeMinor(row.amount_minor),currencyCode:row.currency_code.trim(),method:row.method,provider:row.provider,
    providerEventReference:row.provider_event_reference,providerTransactionReference:row.provider_transaction_reference,status:row.status,
    failureCode:row.failure_code,failureMessage:row.failure_message,receivedAt:row.received_at.toISOString(),reconciledAt:iso(row.reconciled_at),
    createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),
  };
}
function mapRefund(row: RefundRow): AdminSubscriptionPaymentRefund {
  return {
    id:row.id,businessId:row.business_id,paymentId:row.payment_id,amountMinor:safeMinor(row.amount_minor),currencyCode:row.currency_code.trim(),
    provider:row.provider,providerEventReference:row.provider_event_reference,providerRefundReference:row.provider_refund_reference,status:row.status,
    failureCode:row.failure_code,failureMessage:row.failure_message,requestedAt:row.requested_at.toISOString(),completedAt:iso(row.completed_at),
    createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),
  };
}

function parsePaymentInput(input: ProviderPaymentInput) {
  return {
    businessId: requireUuid(input.businessId,"ADMIN_TENANT_NOT_FOUND","Tenant was not found"),
    invoiceId: requireUuid(input.invoiceId,"ADMIN_INVOICE_NOT_FOUND","Invoice was not found"),
    amountMinor: parsePositiveMinor(input.amountMinor), currencyCode:parseCurrency(input.currencyCode), method:parseText(input.method,"Payment method",80),
    provider:parseText(input.provider,"Provider",80), providerEventReference:parseText(input.providerEventReference,"Provider event reference",200),
    providerTransactionReference:parseText(input.providerTransactionReference,"Provider transaction reference",200), status:parsePaymentStatus(input.status),
    failureCode:optionalText(input.failureCode,100), failureMessage:optionalText(input.failureMessage,500), receivedAt:parseInstant(input.receivedAt,"receivedAt"),
  };
}
function parseRefundInput(input: ProviderRefundInput) {
  return {
    businessId: requireUuid(input.businessId,"ADMIN_TENANT_NOT_FOUND","Tenant was not found"),
    paymentId: requireUuid(input.paymentId,"ADMIN_PAYMENT_NOT_FOUND","Subscription payment was not found"),
    amountMinor:parsePositiveMinor(input.amountMinor),currencyCode:parseCurrency(input.currencyCode),provider:parseText(input.provider,"Provider",80),
    providerEventReference:parseText(input.providerEventReference,"Provider event reference",200),providerRefundReference:parseText(input.providerRefundReference,"Provider refund reference",200),
    status:parseRefundStatus(input.status),failureCode:optionalText(input.failureCode,100),failureMessage:optionalText(input.failureMessage,500),
    requestedAt:input.requestedAt ? parseInstant(input.requestedAt,"requestedAt") : new Date(),
    completedAt:input.completedAt ? parseInstant(input.completedAt,"completedAt") : null,
  };
}
function parsePaymentStatus(value: unknown): AdminSubscriptionPaymentStatus {
  if (typeof value !== "string" || !PAYMENT_STATUSES.has(value as AdminSubscriptionPaymentStatus)) throw new PlatformAdminError("Payment status is invalid",400,"ADMIN_PAYMENT_STATUS_INVALID");
  return value as AdminSubscriptionPaymentStatus;
}
function parseReconcileStatus(value: unknown): AdminSubscriptionPaymentStatus {
  if (typeof value !== "string" || !RECONCILE_STATUSES.has(value as AdminSubscriptionPaymentStatus)) throw new PlatformAdminError("Reconciliation status is invalid",400,"ADMIN_PAYMENT_STATUS_INVALID");
  return value as AdminSubscriptionPaymentStatus;
}
function parseRefundStatus(value: unknown): AdminSubscriptionRefundStatus {
  if (typeof value !== "string" || !REFUND_STATUSES.has(value as AdminSubscriptionRefundStatus)) throw new PlatformAdminError("Refund status is invalid",400,"ADMIN_REFUND_STATUS_INVALID");
  return value as AdminSubscriptionRefundStatus;
}
function parsePositiveMinor(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new PlatformAdminError("Amount must be a positive integer in minor units",400,"ADMIN_BILLING_AMOUNT_INVALID");
  return value;
}
function parseCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) throw new PlatformAdminError("Currency code is invalid",400,"ADMIN_BILLING_CURRENCY_INVALID");
  return value.trim().toUpperCase();
}
function parseText(value: unknown,label:string,max:number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length>max) throw new PlatformAdminError(`${label} is invalid`,400,"ADMIN_BILLING_INPUT_INVALID");
  return value.trim();
}
function optionalText(value: unknown,max:number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length>max) throw new PlatformAdminError("Billing metadata is invalid",400,"ADMIN_BILLING_INPUT_INVALID");
  return value.trim();
}
function parseInstant(value: unknown,label:string): Date {
  if (typeof value !== "string") throw new PlatformAdminError(`${label} is invalid`,400,"ADMIN_BILLING_INPUT_INVALID");
  const date=new Date(value); if (Number.isNaN(date.getTime())) throw new PlatformAdminError(`${label} is invalid`,400,"ADMIN_BILLING_INPUT_INVALID"); return date;
}
function parseReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new PlatformAdminError("A reason is required",400,"ADMIN_REASON_REQUIRED");
  const reason=value.trim(); if (reason.length>500) throw new PlatformAdminError("Reason is too long",400,"ADMIN_REASON_INVALID"); return reason;
}
function requireWriteRole(actor: PlatformAdminContext): void {
  if (!WRITE_ROLES.has(actor.role)) throw new PlatformAdminError("Your platform role cannot reconcile subscription billing",403,"ADMIN_BILLING_WRITE_FORBIDDEN");
}
function requireUuid(value: unknown,code:string,message:string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PlatformAdminError(message,404,code); return value;
}
function safeMinor(value: string | number): number {
  const parsed=typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PlatformAdminError("Billing amount exceeds supported range",500,"ADMIN_BILLING_AMOUNT_OVERFLOW");
  return parsed;
}
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }

async function writeAudit(client: DatabaseClient, actorId: string | null, businessId: string | null, eventType: string, entityType: string, entityId: string, reason: string, payload: Record<string,unknown>): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [actorId,businessId,eventType,entityType,entityId,reason,JSON.stringify(payload)],
  );
}
