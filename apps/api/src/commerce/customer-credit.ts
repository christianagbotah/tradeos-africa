import { recordCashbookEntry } from "./cashbook.js";
import { allocateCustomerPayment } from "./credit-obligations.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

export type CustomerPaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";
export type CustomerAccountEntryType = "CREDIT_SALE" | "PAYMENT" | "CREDIT_REFUND" | "ADJUSTMENT";

export interface CustomerPaymentMutationPayload {
 moneyAccountId?:string;
  customerId: string;
  amountMinor: number;
  method: CustomerPaymentMethod;
  providerReference?: string;
  receivedByStaffId?: string;
}

export interface CustomerPaymentMutationContext {
  businessId: string;
  branchId: string;
  clientMutationId: string;
  occurredAt: string;
}

export interface CustomerPaymentMutationResult {
  paymentId: string;
  customerId: string;
  amountMinor: number;
  balanceMinor: number;
  status: "SUCCEEDED";
  idempotentReplay: boolean;
}

type CustomerRow = {
  id: string;
  currency_code: string;
  credit_limit_minor: string | number | null;
  credit_terms_days: number;
  is_active: boolean;
};

export class CustomerCreditError extends Error {
  constructor(message: string, readonly code = "CUSTOMER_CREDIT_INVALID") {
    super(message);
  }
}

export async function applyCustomerPaymentMutation(
  pool: DatabasePool,
  context: CustomerPaymentMutationContext,
  payload: CustomerPaymentMutationPayload,
): Promise<CustomerPaymentMutationResult> {
  validateCustomerPayment(context, payload);

  return withTransaction(pool, async (client) => {
    const prior = await client.query<{ id: string; customer_id: string; amount_minor: string | number; status: string }>(
      `SELECT id,customer_id,amount_minor,status FROM customer_payments
       WHERE business_id=$1 AND client_mutation_id=$2`,
      [context.businessId, context.clientMutationId],
    );
    const replay = prior.rows[0];
    if (replay) {
      return {
        paymentId: replay.id,
        customerId: replay.customer_id,
        amountMinor: Number(replay.amount_minor),
        balanceMinor: await getCustomerBalance(client, context.businessId, replay.customer_id),
        status: "SUCCEEDED",
        idempotentReplay: true,
      };
    }

    await requireActiveBranch(client, context.businessId, context.branchId);
    const customer = await loadCustomerAccount(client, context.businessId, payload.customerId, true);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO customer_payments (
         business_id,branch_id,customer_id,amount_minor,currency_code,method,provider_reference,
         status,actor_staff_id,client_mutation_id,received_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'SUCCEEDED',$8,$9,$10) RETURNING id`,
      [
        context.businessId, context.branchId, customer.id, payload.amountMinor, customer.currency_code,
        payload.method, payload.providerReference?.trim() || null, payload.receivedByStaffId ?? null,
        context.clientMutationId, context.occurredAt,
      ],
    );
    const paymentId = inserted.rows[0]?.id;
    if (!paymentId) throw new CustomerCreditError("Customer payment could not be created", "CUSTOMER_PAYMENT_CREATE_FAILED");

    await recordCustomerAccountEntry(client, {
      businessId: context.businessId,
      branchId: context.branchId,
      customerId: customer.id,
      currencyCode: customer.currency_code,
      entryType: "PAYMENT",
      balanceDeltaMinor: -payload.amountMinor,
      sourceType: "CUSTOMER_PAYMENT",
      sourceId: paymentId,
      actorStaffId: payload.receivedByStaffId ?? null,
      idempotencyKey: `${context.clientMutationId}:ledger`,
      occurredAt: context.occurredAt,
    });

    await allocateCustomerPayment(client,{businessId:context.businessId,customerId:customer.id,paymentId,amountMinor:payload.amountMinor,occurredAt:context.occurredAt});
    await recordCashbookEntry(client,{...context,moneyAccountId:payload.moneyAccountId,currencyCode:customer.currency_code,method:payload.method,amountDeltaMinor:payload.amountMinor,entryType:"CUSTOMER_PAYMENT",sourceType:"CUSTOMER_PAYMENT",sourceId:paymentId,actorStaffId:payload.receivedByStaffId,idempotencyKey:`customer-payment:${paymentId}`});
    const balanceMinor = await getCustomerBalance(client, context.businessId, customer.id);
    await writeCustomerPaymentEvents(client, context, payload, paymentId, balanceMinor);

    return {
      paymentId,
      customerId: customer.id,
      amountMinor: payload.amountMinor,
      balanceMinor,
      status: "SUCCEEDED",
      idempotentReplay: false,
    };
  });
}

export async function assertCustomerCreditAvailable(
  client: DatabaseClient,
  businessId: string,
  customerId: string,
  currencyCode: string,
  requestedCreditMinor: number,
): Promise<{ currentBalanceMinor: number; creditLimitMinor: number; creditTermsDays: number }> {
  if (!Number.isSafeInteger(requestedCreditMinor) || requestedCreditMinor <= 0) {
    throw new CustomerCreditError("Credit amount must be a positive minor-unit integer", "INVALID_CREDIT_AMOUNT");
  }

  const customer = await loadCustomerAccount(client, businessId, customerId, true);
  if (!customer.is_active) throw new CustomerCreditError("Customer account is inactive", "CUSTOMER_INACTIVE");
  if (customer.currency_code !== currencyCode) {
    throw new CustomerCreditError("Customer account currency does not match the sale", "CUSTOMER_CURRENCY_MISMATCH");
  }
  if (customer.credit_limit_minor === null) {
    throw new CustomerCreditError("Pay later is not enabled for this customer", "CUSTOMER_CREDIT_NOT_ENABLED");
  }

  const creditLimitMinor = Number(customer.credit_limit_minor);
  const currentBalanceMinor = await getCustomerBalance(client, businessId, customerId);
  const projectedBalanceMinor = currentBalanceMinor + requestedCreditMinor;
  if (projectedBalanceMinor > creditLimitMinor) {
    const availableMinor = Math.max(0, creditLimitMinor - currentBalanceMinor);
    throw new CustomerCreditError(
      `Customer has only ${availableMinor} minor units of credit available`,
      "CREDIT_LIMIT_EXCEEDED",
    );
  }

  return { currentBalanceMinor, creditLimitMinor, creditTermsDays: customer.credit_terms_days };
}

export async function recordCustomerAccountEntry(
  client: DatabaseClient,
  input: {
    businessId: string;
    branchId: string;
    customerId: string;
    currencyCode: string;
    entryType: CustomerAccountEntryType;
    balanceDeltaMinor: number;
    sourceType: string;
    sourceId: string;
    actorStaffId: string | null;
    idempotencyKey: string;
    occurredAt: string;
  },
): Promise<void> {
  if (!Number.isSafeInteger(input.balanceDeltaMinor) || input.balanceDeltaMinor === 0) {
    throw new CustomerCreditError("Customer account entry must use a non-zero minor-unit integer");
  }
  await client.query(
    `INSERT INTO customer_account_entries (
       business_id,branch_id,customer_id,currency_code,entry_type,balance_delta_minor,
       source_type,source_id,actor_staff_id,idempotency_key,occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (business_id,idempotency_key) DO NOTHING`,
    [
      input.businessId,input.branchId,input.customerId,input.currencyCode,input.entryType,input.balanceDeltaMinor,
      input.sourceType,input.sourceId,input.actorStaffId,input.idempotencyKey,input.occurredAt,
    ],
  );
}

export async function getCustomerBalance(client: DatabaseClient, businessId: string, customerId: string): Promise<number> {
  const result = await client.query<{ balance: string | number }>(
    `SELECT COALESCE(SUM(balance_delta_minor),0) AS balance
     FROM customer_account_entries WHERE business_id=$1 AND customer_id=$2`,
    [businessId, customerId],
  );
  return Number(result.rows[0]?.balance ?? 0);
}

export async function loadCustomerAccount(
  client: DatabaseClient,
  businessId: string,
  customerId: string,
  lock = false,
): Promise<CustomerRow> {
  const result = await client.query<CustomerRow>(
    `SELECT c.id,b.currency_code,c.credit_limit_minor,c.credit_terms_days,c.is_active
     FROM customers c JOIN businesses b ON b.id=c.business_id
     WHERE c.id=$1 AND c.business_id=$2${lock ? " FOR UPDATE OF c" : ""}`,
    [customerId, businessId],
  );
  const customer = result.rows[0];
  if (!customer) throw new CustomerCreditError("Customer was not found for this business", "CUSTOMER_NOT_FOUND");
  return customer;
}

async function requireActiveBranch(client: DatabaseClient, businessId: string, branchId: string): Promise<void> {
  const result = await client.query(
    `SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true FOR SHARE`,
    [branchId, businessId],
  );
  if (result.rowCount !== 1) throw new CustomerCreditError("Branch was not found for this business", "BRANCH_NOT_FOUND");
}

function validateCustomerPayment(context: CustomerPaymentMutationContext, payload: CustomerPaymentMutationPayload): void {
  if (!context.branchId || !context.clientMutationId) throw new CustomerCreditError("branchId and clientMutationId are required");
  if (Number.isNaN(Date.parse(context.occurredAt))) throw new CustomerCreditError("occurredAt must be an ISO date-time");
  if (!payload.customerId) throw new CustomerCreditError("customerId is required", "CUSTOMER_REQUIRED");
  if (!Number.isSafeInteger(payload.amountMinor) || payload.amountMinor <= 0) {
    throw new CustomerCreditError("Payment amount must be a positive minor-unit integer", "INVALID_PAYMENT_AMOUNT");
  }
  if (!["CASH", "MOMO", "CARD", "BANK", "OTHER"].includes(payload.method)) {
    throw new CustomerCreditError("Unsupported customer payment method", "INVALID_PAYMENT_METHOD");
  }
}

async function writeCustomerPaymentEvents(
  client: DatabaseClient,
  context: CustomerPaymentMutationContext,
  payload: CustomerPaymentMutationPayload,
  paymentId: string,
  balanceMinor: number,
): Promise<void> {
  const eventPayload = JSON.stringify({ customerId: payload.customerId, amountMinor: payload.amountMinor, balanceMinor, method: payload.method });
  await client.query(
    `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at)
     VALUES ($1,$2,$3,'CUSTOMER_PAYMENT_RECEIVED','CUSTOMER_PAYMENT',$4,$5,$6::jsonb,$7)`,
    [context.businessId,context.branchId,payload.receivedByStaffId ?? null,paymentId,context.clientMutationId,eventPayload,context.occurredAt],
  );
  await client.query(
    `INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
     VALUES ($1,$2,'CUSTOMER_PAYMENT',$3,'CUSTOMER_PAYMENT_RECEIVED',$4::jsonb,$5)`,
    [context.businessId,context.branchId,paymentId,eventPayload,context.occurredAt],
  );
}
