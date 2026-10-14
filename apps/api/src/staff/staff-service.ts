import {
  BUSINESS_ROLES,
  type BusinessRole,
  type CreateStaffRequest,
  type StaffDirectoryItem,
  type UpdateStaffRequest,
} from "@tradeos/contracts";
import { requireBusinessRole, type BusinessAccess } from "../auth/authorization.js";
import {
  AuthError,
  normalizeEmail,
  normalizePhone,
  type AuthContext,
} from "../auth/security.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const STAFF_READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER"];
const STAFF_MUTATION_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN"];
const ADMIN_ASSIGNABLE_ROLES: readonly BusinessRole[] = [
  "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

type StaffRow = {
  id: string;
  business_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: BusinessRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type StaffDirectoryRow = StaffRow & {
  membership_id: string | null;
  membership_user_id: string | null;
  membership_status: "ACTIVE" | "SUSPENDED" | "INVITED" | "REMOVED" | null;
  invitation_id: string | null;
  invitation_expires_at: Date | null;
};

export async function listStaff(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string | undefined,
): Promise<StaffDirectoryItem[]> {
  const normalizedBusinessId = requireBusinessId(businessId);
  await requireBusinessRole(pool, auth, normalizedBusinessId, STAFF_READ_ROLES);
  const rows = await queryStaffDirectory(pool, normalizedBusinessId);
  return rows.map(mapStaffDirectoryItem);
}

export async function createStaff(
  pool: DatabasePool,
  auth: AuthContext,
  input: CreateStaffRequest,
): Promise<StaffDirectoryItem> {
  const businessId = requireBusinessId(input?.businessId);
  const access = await requireBusinessRole(pool, auth, businessId, STAFF_MUTATION_ROLES);
  const displayName = normalizeDisplayName(input?.displayName);
  const email = normalizeNullableEmail(input?.email);
  const phone = normalizeNullablePhone(input?.phone);
  const role = normalizeRole(input?.role);
  assertActorCanManageRole(access, null, role);

  const staffId = await withTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO staff(business_id,display_name,email,phone,role)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id`,
      [businessId, displayName, email, phone, role],
    );
    const id = inserted.rows[0]!.id;
    await writeAudit(client, businessId, access.staffId, "STAFF_CREATED", "STAFF", id, {
      role,
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
    });
    return id;
  });

  return loadStaffItem(pool, businessId, staffId);
}

export async function updateStaff(
  pool: DatabasePool,
  auth: AuthContext,
  staffId: string,
  input: UpdateStaffRequest,
): Promise<StaffDirectoryItem> {
  const businessId = requireBusinessId(input?.businessId);
  const access = await requireBusinessRole(pool, auth, businessId, STAFF_MUTATION_ROLES);

  await withTransaction(pool, async (client) => {
    const found = await client.query<StaffRow>(
      `SELECT id,business_id,display_name,email,phone,role,is_active,created_at,updated_at
       FROM staff
       WHERE id=$1 AND business_id=$2
       FOR UPDATE`,
      [staffId, businessId],
    );
    const current = found.rows[0];
    if (!current) throw new AuthError("Staff member was not found", 404, "STAFF_NOT_FOUND");

    const nextRole = input.role === undefined ? current.role : normalizeRole(input.role);
    assertActorCanManageRole(access, current.role, nextRole);

    const nextDisplayName = input.displayName === undefined ? current.display_name : normalizeDisplayName(input.displayName);
    const nextEmail = input.email === undefined ? current.email : normalizeNullableEmail(input.email);
    const nextPhone = input.phone === undefined ? current.phone : normalizeNullablePhone(input.phone);

    const changedFields: string[] = [];
    if (nextDisplayName !== current.display_name) changedFields.push("displayName");
    if (nextEmail !== current.email) changedFields.push("email");
    if (nextPhone !== current.phone) changedFields.push("phone");
    if (nextRole !== current.role) changedFields.push("role");

    if (nextRole !== current.role && current.role === "OWNER" && current.is_active) {
      await ensureOwnerCanLoseAccess(client, businessId, staffId);
    }

    if (changedFields.length > 0) {
      await client.query(
        `UPDATE staff
         SET display_name=$3,email=$4,phone=$5,role=$6,updated_at=now()
         WHERE id=$1 AND business_id=$2`,
        [staffId, businessId, nextDisplayName, nextEmail, nextPhone, nextRole],
      );
    }

    if (nextRole !== current.role) {
      await client.query(
        `UPDATE business_memberships
         SET role=$3,updated_at=now()
         WHERE business_id=$1 AND staff_id=$2`,
        [businessId, staffId, nextRole],
      );
    }

    const invitationSensitiveChange =
      nextEmail !== current.email || nextPhone !== current.phone || nextRole !== current.role;
    if (invitationSensitiveChange) {
      const revoked = await client.query<{ id: string }>(
        `UPDATE staff_invitations
         SET status='REVOKED',revoked_at=now()
         WHERE business_id=$1 AND staff_id=$2 AND status='PENDING'
         RETURNING id`,
        [businessId, staffId],
      );
      for (const invitation of revoked.rows) {
        await writeAudit(
          client,
          businessId,
          access.staffId,
          "STAFF_INVITATION_REVOKED",
          "STAFF_INVITATION",
          invitation.id,
          { targetStaffId: staffId, reason: "STAFF_IDENTITY_OR_ROLE_CHANGED" },
        );
      }
    }

    if (changedFields.length > 0) {
      await writeAudit(
        client,
        businessId,
        access.staffId,
        nextRole !== current.role ? "STAFF_ROLE_CHANGED" : "STAFF_UPDATED",
        "STAFF",
        staffId,
        {
          changedFields,
          ...(nextRole !== current.role ? { beforeRole: current.role, afterRole: nextRole } : {}),
        },
      );
    }
  });

  return loadStaffItem(pool, businessId, staffId);
}

async function queryStaffDirectory(
  queryable: Pick<DatabasePool, "query">,
  businessId: string,
  staffId?: string,
): Promise<StaffDirectoryRow[]> {
  const result = await queryable.query<StaffDirectoryRow>(
    `SELECT
       s.id,s.business_id,s.display_name,s.email,s.phone,s.role,s.is_active,s.created_at,s.updated_at,
       membership.id AS membership_id,membership.user_id AS membership_user_id,membership.status AS membership_status,
       invitation.id AS invitation_id,invitation.expires_at AS invitation_expires_at
     FROM staff s
     LEFT JOIN LATERAL (
       SELECT m.id,m.user_id,m.status
       FROM business_memberships m
       WHERE m.business_id=s.business_id AND m.staff_id=s.id AND m.status <> 'REMOVED'
       ORDER BY m.updated_at DESC,m.created_at DESC
       LIMIT 1
     ) membership ON true
     LEFT JOIN LATERAL (
       SELECT i.id,i.expires_at
       FROM staff_invitations i
       WHERE i.business_id=s.business_id AND i.staff_id=s.id AND i.status='PENDING'
       ORDER BY i.created_at DESC
       LIMIT 1
     ) invitation ON true
     WHERE s.business_id=$1
       AND ($2::uuid IS NULL OR s.id=$2::uuid)
     ORDER BY s.is_active DESC,s.display_name ASC,s.created_at ASC`,
    [businessId, staffId ?? null],
  );
  return result.rows;
}

async function loadStaffItem(pool: DatabasePool, businessId: string, staffId: string): Promise<StaffDirectoryItem> {
  const rows = await queryStaffDirectory(pool, businessId, staffId);
  const row = rows[0];
  if (!row) throw new AuthError("Staff member was not found", 404, "STAFF_NOT_FOUND");
  return mapStaffDirectoryItem(row);
}

function mapStaffDirectoryItem(row: StaffDirectoryRow): StaffDirectoryItem {
  const invitationStatus = row.invitation_id
    ? (row.invitation_expires_at && row.invitation_expires_at.getTime() <= Date.now() ? "EXPIRED" : "PENDING")
    : null;
  const membershipStatus = row.membership_status === "ACTIVE" || row.membership_status === "SUSPENDED"
    ? row.membership_status
    : null;
  return {
    id: row.id,
    businessId: row.business_id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    access: {
      membershipId: row.membership_id,
      userId: row.membership_user_id,
      membershipStatus,
      invitationId: row.invitation_id,
      invitationStatus,
      invitationExpiresAt: row.invitation_expires_at?.toISOString() ?? null,
    },
  };
}

function requireBusinessId(value: string | undefined): string {
  const businessId = value?.trim();
  if (!businessId) throw new AuthError("businessId is required", 400, "BUSINESS_REQUIRED");
  return businessId;
}

function normalizeDisplayName(value: string | undefined): string {
  const displayName = value?.trim() ?? "";
  if (displayName.length < 2 || displayName.length > 120) {
    throw new AuthError("Staff name must contain 2 to 120 characters", 400, "STAFF_INVALID");
  }
  return displayName;
}

function normalizeNullableEmail(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.trim()) return null;
  return normalizeEmail(value);
}

function normalizeNullablePhone(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.trim()) return null;
  return normalizePhone(value);
}

function normalizeRole(value: unknown): BusinessRole {
  if (typeof value !== "string" || !(BUSINESS_ROLES as readonly string[]).includes(value)) {
    throw new AuthError("A supported staff role is required", 400, "STAFF_INVALID");
  }
  return value as BusinessRole;
}

function assertActorCanManageRole(
  access: BusinessAccess,
  currentRole: BusinessRole | null,
  nextRole: BusinessRole,
): void {
  if (access.role === "OWNER") return;
  if (access.role !== "ADMIN") {
    throw new AuthError("Your role cannot manage staff", 403, "STAFF_ROLE_FORBIDDEN");
  }
  if ((currentRole && !ADMIN_ASSIGNABLE_ROLES.includes(currentRole)) || !ADMIN_ASSIGNABLE_ROLES.includes(nextRole)) {
    throw new AuthError("Administrators cannot manage OWNER or ADMIN access", 403, "STAFF_ROLE_FORBIDDEN");
  }
}

async function ensureOwnerCanLoseAccess(client: DatabaseClient, businessId: string, staffId: string): Promise<void> {
  const owners = await client.query<{ staff_id: string | null }>(
    `SELECT staff_id
     FROM business_memberships
     WHERE business_id=$1 AND role='OWNER' AND status='ACTIVE'
     ORDER BY id
     FOR UPDATE`,
    [businessId],
  );
  const targetIsActiveOwner = owners.rows.some((row) => row.staff_id === staffId);
  if (targetIsActiveOwner && owners.rows.length <= 1) {
    throw new AuthError("The business must keep at least one active owner", 409, "LAST_OWNER_REQUIRED");
  }
}

async function writeAudit(
  client: DatabaseClient,
  businessId: string,
  actorStaffId: string | null,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(
       business_id,actor_staff_id,event_type,entity_type,entity_id,payload
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [businessId, actorStaffId, eventType, entityType, entityId, JSON.stringify(payload)],
  );
}
