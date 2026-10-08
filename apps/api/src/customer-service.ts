import type { CustomerCreateInput, CustomerUpdateInput } from "@tradeos/contracts";
import { AuthError } from "./auth/security.js";
import type { BusinessAccess, BusinessRole } from "./auth/authorization.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

export const CUSTOMER_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"];
export const CUSTOMER_CREDIT_CONTROL_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  credit_limit_minor: string | number | null;
  credit_terms_days: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  balance_minor: string | number;
};

export class CustomerServiceError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "CUSTOMER_INVALID") {
    super(message);
  }
}

export async function createCustomer(
  pool: DatabasePool,
  access: BusinessAccess,
  input: CustomerCreateInput,
) {
  assertBusinessAccess(access);
  assertCreditControl(access, input.creditLimitMinor !== undefined || input.creditTermsDays !== undefined);
  const normalized = validateCustomerInput(input);

  const customerId = await withTransaction(pool, async (client) => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO customers (business_id,name,phone,email,credit_limit_minor,credit_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [access.businessId, normalized.name, normalized.phone, normalized.email, normalized.creditLimitMinor, normalized.creditTermsDays],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new CustomerServiceError("Customer could not be created", 500, "CUSTOMER_CREATE_FAILED");
    await writeAudit(client, access, "CUSTOMER_CREATED", id, {
      changes: {
        name: { before: null, after: normalized.name },
        phone: { before: null, after: normalized.phone },
        email: { before: null, after: normalized.email },
        creditLimitMinor: { before: null, after: normalized.creditLimitMinor },
        creditTermsDays: { before: null, after: normalized.creditTermsDays },
        active: { before: null, after: true },
      },
    });
    return id;
  });

  return loadCustomer(pool, access.businessId, customerId);
}

export async function updateCustomer(
  pool: DatabasePool,
  access: BusinessAccess,
  customerId: string,
  input: CustomerUpdateInput,
) {
  assertBusinessAccess(access);
  const expectedUpdatedAt = revision(input.expectedUpdatedAt);
  const touchesCreditControl = input.creditLimitMinor !== undefined || input.creditTermsDays !== undefined || input.active !== undefined;
  assertCreditControl(access, touchesCreditControl);

  return withTransaction(pool, async (client) => {
    const current = await loadCustomer(client, access.businessId, customerId, true);
    if (Date.parse(current.updatedAt) !== Date.parse(expectedUpdatedAt)) {
      throw new CustomerServiceError("Customer changed on another device. Reload before saving again.", 409, "STALE_VERSION");
    }

    const next = validateCustomerInput({
      name: input.name ?? current.name,
      phone: input.phone === undefined ? current.phone : input.phone,
      email: input.email === undefined ? current.email : input.email,
      creditLimitMinor: input.creditLimitMinor === undefined ? current.creditLimitMinor : input.creditLimitMinor,
      creditTermsDays: input.creditTermsDays === undefined ? current.creditTermsDays : input.creditTermsDays,
    });
    const active = input.active ?? current.active;
    const changes = changedFields(current, { ...next, active });

    const updated = await client.query(
      `UPDATE customers
       SET name=$3,phone=$4,email=$5,credit_limit_minor=$6,credit_terms_days=$7,is_active=$8,updated_at=clock_timestamp()
       WHERE id=$1 AND business_id=$2`,
      [customerId, access.businessId, next.name, next.phone, next.email, next.creditLimitMinor, next.creditTermsDays, active],
    );
    if (updated.rowCount !== 1) {
      throw new CustomerServiceError("Customer changed on another device. Reload before saving again.", 409, "STALE_VERSION");
    }

    const eventType = current.active !== active
      ? (active ? "CUSTOMER_REACTIVATED" : "CUSTOMER_DEACTIVATED")
      : "CUSTOMER_UPDATED";
    await writeAudit(client, access, eventType, customerId, { changes });
    return loadCustomer(client, access.businessId, customerId);
  });
}

export async function loadCustomer(
  db: DatabasePool | DatabaseClient,
  businessId: string,
  customerId: string,
  lock = false,
) {
  const result = await db.query<CustomerRow>(
    `SELECT c.id,c.name,c.phone,c.email,c.credit_limit_minor,c.credit_terms_days,c.is_active,c.created_at,c.updated_at,
            COALESCE((SELECT SUM(cae.balance_delta_minor) FROM customer_account_entries cae
              WHERE cae.business_id=c.business_id AND cae.customer_id=c.id),0) AS balance_minor
     FROM customers c WHERE c.id=$1 AND c.business_id=$2${lock ? " FOR UPDATE OF c" : ""}`,
    [customerId, businessId],
  );
  const row = result.rows[0];
  if (!row) throw new CustomerServiceError("Customer was not found", 404, "CUSTOMER_NOT_FOUND");
  return toCustomer(row);
}

function toCustomer(row: CustomerRow) {
  const balanceMinor = Number(row.balance_minor);
  const creditLimitMinor = row.credit_limit_minor === null ? null : Number(row.credit_limit_minor);
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    creditLimitMinor,
    creditTermsDays: row.credit_terms_days,
    balanceMinor,
    availableCreditMinor: creditLimitMinor === null ? null : Math.max(0, creditLimitMinor - balanceMinor),
    creditEnabled: creditLimitMinor !== null,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function validateCustomerInput(input: CustomerCreateInput) {
  const name = input.name?.trim();
  if (!name || name.length > 160) throw new CustomerServiceError("Customer name is required and must be at most 160 characters");
  const phone = nullable(input.phone, 40);
  const email = nullable(input.email, 254)?.toLowerCase() ?? null;
  if (email && !email.includes("@")) throw new CustomerServiceError("Customer email is invalid");
  const creditLimitMinor = input.creditLimitMinor ?? null;
  if (creditLimitMinor !== null && (!Number.isSafeInteger(creditLimitMinor) || creditLimitMinor < 0)) {
    throw new CustomerServiceError("Credit limit must be a non-negative minor-unit integer", 400, "INVALID_CREDIT_LIMIT");
  }
  const creditTermsDays = input.creditTermsDays ?? 0;
  if (!Number.isInteger(creditTermsDays) || creditTermsDays < 0 || creditTermsDays > 3650) {
    throw new CustomerServiceError("Credit terms must be a whole number of days from 0 to 3650", 400, "INVALID_CREDIT_TERMS");
  }
  return { name, phone, email, creditLimitMinor, creditTermsDays };
}

function assertBusinessAccess(access: BusinessAccess): void {
  if (!access.businessId) throw new CustomerServiceError("businessId is required");
}

function assertCreditControl(access: BusinessAccess, requested: boolean): void {
  if (requested && !CUSTOMER_CREDIT_CONTROL_ROLES.includes(access.role)) {
    throw new AuthError("Your role cannot change customer credit limits, terms or account status", 403, "CREDIT_CONTROL_FORBIDDEN");
  }
}

function revision(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new CustomerServiceError("expectedUpdatedAt is required and must be an ISO date-time", 400, "REVISION_REQUIRED");
  }
  return new Date(value).toISOString();
}

function nullable(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > max) throw new CustomerServiceError(`Value must be at most ${max} characters`);
  return normalized;
}

function changedFields(
  before: { name: string; phone: string | null; email: string | null; creditLimitMinor: number | null; creditTermsDays: number; active: boolean },
  after: { name: string; phone: string | null; email: string | null; creditLimitMinor: number | null; creditTermsDays: number; active: boolean },
) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of ["name", "phone", "email", "creditLimitMinor", "creditTermsDays", "active"] as const) {
    if (before[key] !== after[key]) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}

async function writeAudit(
  db: DatabaseClient,
  access: BusinessAccess,
  eventType: string,
  customerId: string,
  payload: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,'CUSTOMER',$4,$5::jsonb)`,
    [access.businessId, access.staffId, eventType, customerId, JSON.stringify(payload)],
  );
}
