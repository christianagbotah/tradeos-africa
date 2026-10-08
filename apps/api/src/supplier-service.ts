import type { SupplierCreateInput, SupplierUpdateInput } from "@tradeos/contracts";
import { AuthError } from "./auth/security.js";
import type { BusinessAccess, BusinessRole } from "./auth/authorization.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

export const SUPPLIER_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"];
export const SUPPLIER_TERMS_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms_days: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  balance_minor?: string | number;
};

export class SupplierServiceError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "SUPPLIER_INVALID") {
    super(message);
  }
}

export async function createSupplier(
  pool: DatabasePool,
  access: BusinessAccess,
  input: SupplierCreateInput,
) {
  assertTermsControl(access, input.paymentTermsDays !== undefined, "set");
  const normalized = validateSupplierInput(input);

  const supplierId = await withTransaction(pool, async (client) => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO suppliers (business_id,name,phone,email,address,payment_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [access.businessId, normalized.name, normalized.phone, normalized.email, normalized.address, normalized.paymentTermsDays],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new SupplierServiceError("Supplier could not be created", 500, "SUPPLIER_CREATE_FAILED");
    await writeAudit(client, access, "SUPPLIER_CREATED", id, {
      changes: {
        name: { before: null, after: normalized.name },
        phone: { before: null, after: normalized.phone },
        email: { before: null, after: normalized.email },
        address: { before: null, after: normalized.address },
        paymentTermsDays: { before: null, after: normalized.paymentTermsDays },
        active: { before: null, after: true },
      },
    });
    return id;
  });

  return loadSupplier(pool, access.businessId, supplierId);
}

export async function updateSupplier(
  pool: DatabasePool,
  access: BusinessAccess,
  supplierId: string,
  input: SupplierUpdateInput,
) {
  const expectedUpdatedAt = revision(input.expectedUpdatedAt);
  assertTermsControl(access, input.paymentTermsDays !== undefined, "change");

  return withTransaction(pool, async (client) => {
    const current = await loadSupplier(client, access.businessId, supplierId, true);
    if (Date.parse(current.updatedAt) !== Date.parse(expectedUpdatedAt)) {
      throw new SupplierServiceError("Supplier changed on another device. Reload before saving again.", 409, "STALE_VERSION");
    }

    const next = validateSupplierInput({
      name: input.name ?? current.name,
      phone: input.phone === undefined ? current.phone : input.phone,
      email: input.email === undefined ? current.email : input.email,
      address: input.address === undefined ? current.address : input.address,
      paymentTermsDays: input.paymentTermsDays === undefined ? current.paymentTermsDays : input.paymentTermsDays,
    });
    const active = input.active ?? current.active;
    const changes = changedFields(current, { ...next, active });

    const updated = await client.query(
      `UPDATE suppliers
       SET name=$3,phone=$4,email=$5,address=$6,payment_terms_days=$7,is_active=$8,updated_at=clock_timestamp()
       WHERE id=$1 AND business_id=$2`,
      [supplierId, access.businessId, next.name, next.phone, next.email, next.address, next.paymentTermsDays, active],
    );
    if (updated.rowCount !== 1) throw new SupplierServiceError("Supplier was not found", 404, "SUPPLIER_NOT_FOUND");

    const eventType = current.active !== active
      ? (active ? "SUPPLIER_REACTIVATED" : "SUPPLIER_DEACTIVATED")
      : "SUPPLIER_UPDATED";
    await writeAudit(client, access, eventType, supplierId, { changes });
    return loadSupplier(client, access.businessId, supplierId);
  });
}

export async function loadSupplier(
  db: DatabasePool | DatabaseClient,
  businessId: string,
  supplierId: string,
  lock = false,
) {
  const result = await db.query<SupplierRow>(
    `SELECT s.id,s.name,s.phone,s.email,s.address,s.payment_terms_days,s.is_active,s.created_at,s.updated_at,
            COALESCE((SELECT SUM(spl.balance_delta_minor) FROM supplier_payable_ledger spl
              WHERE spl.business_id=s.business_id AND spl.supplier_id=s.id),0) AS balance_minor
     FROM suppliers s WHERE s.id=$1 AND s.business_id=$2${lock ? " FOR UPDATE OF s" : ""}`,
    [supplierId, businessId],
  );
  const row = result.rows[0];
  if (!row) throw new SupplierServiceError("Supplier was not found", 404, "SUPPLIER_NOT_FOUND");
  return toSupplier(row);
}

function toSupplier(row: SupplierRow) {
  return {
    balanceMinor: Number(row.balance_minor ?? 0),
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentTermsDays: row.payment_terms_days,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function validateSupplierInput(input: SupplierCreateInput) {
  const name = input.name?.trim();
  if (!name || name.length > 180) throw new SupplierServiceError("Supplier name is required and must be at most 180 characters");
  const phone = nullable(input.phone, 40);
  const email = nullable(input.email, 254)?.toLowerCase() ?? null;
  if (email && !email.includes("@")) throw new SupplierServiceError("Supplier email is invalid");
  const paymentTermsDays = input.paymentTermsDays ?? 0;
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) {
    throw new SupplierServiceError("Payment terms must be a whole number of days from 0 to 3650", 400, "INVALID_PAYMENT_TERMS");
  }
  return { name, phone, email, address: nullable(input.address, 500), paymentTermsDays };
}

function assertTermsControl(access: BusinessAccess, requested: boolean, verb: "set" | "change"): void {
  if (requested && !SUPPLIER_TERMS_ROLES.includes(access.role)) {
    throw new AuthError(`Your role cannot ${verb} supplier payment terms`, 403, "SUPPLIER_TERMS_FORBIDDEN");
  }
}

function revision(value: string): string {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new SupplierServiceError("expectedUpdatedAt is required and must be an ISO date-time", 400, "REVISION_REQUIRED");
  }
  return new Date(value).toISOString();
}

function nullable(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > max) throw new SupplierServiceError(`Value must be at most ${max} characters`);
  return normalized;
}

function changedFields(
  before: { name: string; phone: string | null; email: string | null; address: string | null; paymentTermsDays: number; active: boolean },
  after: { name: string; phone: string | null; email: string | null; address: string | null; paymentTermsDays: number; active: boolean },
) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of ["name", "phone", "email", "address", "paymentTermsDays", "active"] as const) {
    if (before[key] !== after[key]) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}

async function writeAudit(
  db: DatabaseClient,
  access: BusinessAccess,
  eventType: string,
  supplierId: string,
  payload: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,'SUPPLIER',$4,$5::jsonb)`,
    [access.businessId, access.staffId, eventType, supplierId, JSON.stringify(payload)],
  );
}
