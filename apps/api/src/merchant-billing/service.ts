import type {
  MerchantBillingInvoice, MerchantBillingOverview,
  MerchantBillingPayment, MerchantBillingSubscription,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";

type SubscriptionRow = {
  id: string; status: MerchantBillingSubscription["status"];
  plan_name: string; plan_code: string; billing_interval: MerchantBillingSubscription["billingInterval"];
  plan_amount_minor: string; currency_code: string;
  current_period_starts_at: Date | null; current_period_ends_at: Date | null;
  trial_ends_at: Date | null; cancel_at_period_end: boolean;
};
type InvoiceRow = {
  id: string; invoice_number: string; status: MerchantBillingInvoice["status"];
  total_minor: string; amount_paid_minor: string; currency_code: string;
  issued_at: Date; due_at: Date; period_start: Date; period_end: Date;
};
type PaymentRow = {
  id: string; invoice_number: string; status: MerchantBillingPayment["status"];
  provider: string; method: string; amount_minor: string; currency_code: string;
  received_at: Date; reconciled_at: Date | null;
};

function safeMinor(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Billing amount exceeds safe integer range");
  return n;
}
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }

/** Read-only invoice and subscription history for one authorized tenant. */
export async function loadMerchantBillingOverview(
  pool: DatabasePool, businessId: string,
): Promise<MerchantBillingOverview> {
  const [subscriptions, invoices, payments] = await Promise.all([
    pool.query<SubscriptionRow>(
      "SELECT s.id,s.status,p.name AS plan_name,p.code AS plan_code, " +
      "p.billing_interval,p.amount_minor::text AS plan_amount_minor, " +
      "p.currency_code,s.current_period_starts_at,s.current_period_ends_at, " +
      "s.trial_ends_at,s.cancel_at_period_end FROM business_subscriptions s " +
      "JOIN subscription_plans p ON p.id=s.plan_id WHERE s.business_id=$1 " +
      "ORDER BY CASE WHEN s.status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED') " +
      "THEN 0 ELSE 1 END,s.created_at DESC,s.id DESC LIMIT 1",
      [businessId],
    ),
    pool.query<InvoiceRow>(
      "SELECT i.id,i.invoice_number,i.status,i.total_minor::text, " +
      "i.amount_paid_minor::text,i.currency_code,i.issued_at,i.due_at, " +
      "i.period_start,i.period_end FROM subscription_invoices i " +
      "WHERE i.business_id=$1 ORDER BY i.issued_at DESC,i.id DESC LIMIT 21",
      [businessId],
    ),
    pool.query<PaymentRow>(
      "SELECT pay.id,inv.invoice_number,pay.status,pay.provider,pay.method, " +
      "pay.amount_minor::text,pay.currency_code,pay.received_at,pay.reconciled_at " +
      "FROM subscription_payments pay JOIN subscription_invoices inv " +
      "ON inv.id=pay.invoice_id AND inv.business_id=pay.business_id " +
      "WHERE pay.business_id=$1 ORDER BY pay.received_at DESC,pay.id DESC LIMIT 21",
      [businessId],
    ),
  ]);
  const s = subscriptions.rows[0];
  const subscription: MerchantBillingSubscription | null = s ? {
    id:s.id,planName:s.plan_name,planCode:s.plan_code,billingInterval:s.billing_interval,
    planAmountMinor:safeMinor(s.plan_amount_minor),currencyCode:s.currency_code,
    status:s.status,currentPeriodStartsAt:iso(s.current_period_starts_at),
    currentPeriodEndsAt:iso(s.current_period_ends_at),trialEndsAt:iso(s.trial_ends_at),
    cancelAtPeriodEnd:s.cancel_at_period_end,
  } : null;
  return {
    businessId, generatedAt:new Date().toISOString(),subscription,
    invoiceHistoryLimited:invoices.rows.length>20,
    paymentHistoryLimited:payments.rows.length>20,
    invoices:invoices.rows.slice(0,20).map((i)=>({
      id:i.id,invoiceNumber:i.invoice_number,status:i.status,
      totalMinor:safeMinor(i.total_minor),amountPaidMinor:safeMinor(i.amount_paid_minor),
      outstandingMinor:Math.max(0,safeMinor(i.total_minor)-safeMinor(i.amount_paid_minor)),
      currencyCode:i.currency_code,issuedAt:i.issued_at.toISOString(),dueAt:i.due_at.toISOString(),
      periodStart:i.period_start.toISOString(),periodEnd:i.period_end.toISOString(),
    })),
    payments:payments.rows.slice(0,20).map((p)=>({
      id:p.id,invoiceNumber:p.invoice_number,status:p.status,
      provider:p.provider,method:p.method,amountMinor:safeMinor(p.amount_minor),
      currencyCode:p.currency_code,receivedAt:p.received_at.toISOString(),
      reconciledAt:iso(p.reconciled_at),
    })),
    paymentCollectionEnabled:false,
    notice:"Online subscription checkout is not enabled yet. Invoice and payment history reflect recorded TradeOS billing data only.",
  };
}
