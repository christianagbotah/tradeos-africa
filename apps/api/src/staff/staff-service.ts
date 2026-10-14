import { randomBytes } from "node:crypto";
import {
  BUSINESS_ROLES,
  type AcceptStaffInvitationRequest,
  type BusinessRole,
  type CreateStaffInvitationRequest,
  type CreateStaffRequest,
  type RegisterStaffInvitationRequest,
  type RegisterStaffInvitationResponse,
  type StaffDirectoryItem,
  type StaffInvitationAcceptance,
  type StaffInvitationResponse,
  type StaffInvitationSummary,
  type StaffAccessMutationRequest,
  type UpdateStaffRequest,
} from "@tradeos/contracts";
import { requireBusinessRole, type BusinessAccess } from "../auth/authorization.js";
import {
  assertPlatform,
  AuthError,
  hashPassword,
  issueSession,
  normalizeEmail,
  normalizePhone,
  tokenHash,
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

type InvitationRow = {
  id: string;
  business_id: string;
  staff_id: string;
  invited_email: string | null;
  invited_phone_e164: string | null;
  role: BusinessRole;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expires_at: Date;
  created_by_user_id: string;
  created_by_staff_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: Date | null;
  created_at: Date;
  staff_email: string | null;
  staff_phone: string | null;
  staff_role: BusinessRole;
  staff_active: boolean;
};

export async function setStaffActive(
  pool: DatabasePool,
  auth: AuthContext,
  staffId: string,
  input: StaffAccessMutationRequest,
  active: boolean,
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
    const staff = found.rows[0];
    if (!staff) throw new AuthError("Staff member was not found", 404, "STAFF_NOT_FOUND");
    assertActorCanManageRole(access, staff.role, staff.role);

    if (!active && staff.is_active && staff.role === "OWNER") {
      await ensureOwnerCanLoseAccess(client, businessId, staffId);
    }
    if (staff.is_active === active) return;

    await client.query(
      `UPDATE staff SET is_active=$3,updated_at=now() WHERE id=$1 AND business_id=$2`,
      [staffId, businessId, active],
    );

    if (active) {
      await client.query(
        `UPDATE business_memberships
         SET status='ACTIVE',updated_at=now()
         WHERE business_id=$1 AND staff_id=$2 AND status='SUSPENDED'`,
        [businessId, staffId],
      );
      await writeAudit(client, businessId, access.staffId, "STAFF_REACTIVATED", "STAFF", staffId, {
        role: staff.role,
      });
      return;
    }

    await client.query(
      `UPDATE business_memberships
       SET status='SUSPENDED',updated_at=now()
       WHERE business_id=$1 AND staff_id=$2 AND status='ACTIVE'`,
      [businessId, staffId],
    );
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
        { targetStaffId: staffId, reason: "STAFF_SUSPENDED" },
      );
    }
    await writeAudit(client, businessId, access.staffId, "STAFF_SUSPENDED", "STAFF", staffId, {
      role: staff.role,
    });
  });

  return loadStaffItem(pool, businessId, staffId);
}

export async function createStaffInvitation(
  pool: DatabasePool,
  auth: AuthContext,
  staffId: string,
  input: CreateStaffInvitationRequest,
): Promise<StaffInvitationResponse> {
  const businessId = requireBusinessId(input?.businessId);
  const access = await requireBusinessRole(pool, auth, businessId, STAFF_MUTATION_ROLES);
  const acceptanceToken = `tos_invite_${randomBytes(32).toString("base64url")}`;
  const hash = tokenHash(acceptanceToken);

  const invitation = await withTransaction(pool, async (client) => {
    const found = await client.query<StaffRow>(
      `SELECT id,business_id,display_name,email,phone,role,is_active,created_at,updated_at
       FROM staff WHERE id=$1 AND business_id=$2 FOR UPDATE`,
      [staffId, businessId],
    );
    const staff = found.rows[0];
    if (!staff) throw new AuthError("Staff member was not found", 404, "STAFF_NOT_FOUND");
    assertActorCanManageRole(access, staff.role, staff.role);
    if (!staff.is_active) throw new AuthError("Staff member must be active before inviting access", 400, "STAFF_INVALID");

    const email = normalizeNullableEmail(staff.email);
    const phone = normalizeNullablePhone(staff.phone);
    if (!email && !phone) {
      throw new AuthError("Add an email or phone number before inviting access", 400, "INVITATION_IDENTITY_REQUIRED");
    }

    const linked = await client.query(
      `SELECT id FROM business_memberships
       WHERE business_id=$1 AND staff_id=$2 AND status='ACTIVE'
       FOR UPDATE`,
      [businessId, staffId],
    );
    if (linked.rowCount) throw new AuthError("Staff member already has active app access", 409, "STAFF_ALREADY_LINKED");

    await client.query(
      `UPDATE staff_invitations
       SET status='EXPIRED'
       WHERE business_id=$1 AND staff_id=$2 AND status='PENDING' AND expires_at<=now()`,
      [businessId, staffId],
    );
    const revoked = await client.query<{ id: string }>(
      `UPDATE staff_invitations
       SET status='REVOKED',revoked_at=now()
       WHERE business_id=$1 AND staff_id=$2 AND status='PENDING'
       RETURNING id`,
      [businessId, staffId],
    );
    for (const prior of revoked.rows) {
      await writeAudit(
        client,
        businessId,
        access.staffId,
        "STAFF_INVITATION_REVOKED",
        "STAFF_INVITATION",
        prior.id,
        { targetStaffId: staffId, reason: "REPLACED" },
      );
    }

    const inserted = await client.query<InvitationRow>(
      `INSERT INTO staff_invitations(
         business_id,staff_id,invited_email,invited_phone_e164,role,token_hash,status,
         expires_at,created_by_user_id,created_by_staff_id
       ) VALUES($1,$2,$3,$4,$5,$6,'PENDING',now()+interval '72 hours',$7,$8)
       RETURNING id,business_id,staff_id,invited_email,invited_phone_e164,role,status,
         expires_at,created_by_user_id,created_by_staff_id,accepted_by_user_id,accepted_at,created_at,
         NULL::text AS staff_email,NULL::text AS staff_phone,role AS staff_role,true AS staff_active`,
      [businessId, staffId, email, phone, staff.role, hash, auth.userId, access.staffId],
    );
    const row = inserted.rows[0]!;
    await writeAudit(client, businessId, access.staffId, "STAFF_INVITED", "STAFF_INVITATION", row.id, {
      targetStaffId: staffId,
      role: staff.role,
      expiresAt: row.expires_at.toISOString(),
    });
    return mapInvitationSummary(row);
  });

  return { invitation, acceptanceToken };
}

export async function acceptStaffInvitation(
  pool: DatabasePool,
  auth: AuthContext,
  input: AcceptStaffInvitationRequest,
): Promise<StaffInvitationAcceptance> {
  const acceptanceToken = requireAcceptanceToken(input?.acceptanceToken);
  const hash = tokenHash(acceptanceToken);

  return withTransaction(pool, async (client) => {
    const found = await client.query<InvitationRow>(
      `SELECT
         i.id,i.business_id,i.staff_id,i.invited_email,i.invited_phone_e164,i.role,i.status,
         i.expires_at,i.created_by_user_id,i.created_by_staff_id,i.accepted_by_user_id,i.accepted_at,i.created_at,
         s.email AS staff_email,s.phone AS staff_phone,s.role AS staff_role,s.is_active AS staff_active
       FROM staff_invitations i
       JOIN staff s ON s.id=i.staff_id AND s.business_id=i.business_id
       WHERE i.token_hash=$1
       FOR UPDATE OF i,s`,
      [hash],
    );
    const invitation = found.rows[0];
    if (!invitation) throw new AuthError("Invitation link is invalid", 404, "INVITATION_INVALID");

    if (invitation.status === "ACCEPTED") {
      if (invitation.accepted_by_user_id !== auth.userId) {
        throw new AuthError("Invitation has already been used", 409, "INVITATION_ALREADY_USED");
      }
      const existing = await client.query<{ staff_id: string | null; role: BusinessRole; status: string }>(
        `SELECT staff_id,role,status FROM business_memberships
         WHERE business_id=$1 AND user_id=$2 FOR UPDATE`,
        [invitation.business_id, auth.userId],
      );
      const membership = existing.rows[0];
      if (!membership || membership.staff_id !== invitation.staff_id || membership.status !== "ACTIVE") {
        throw new AuthError("Invitation has already been used", 409, "INVITATION_ALREADY_USED");
      }
      return acceptanceFromInvitation(invitation);
    }

    if (invitation.status !== "PENDING") {
      throw new AuthError("Invitation link is invalid", 404, "INVITATION_INVALID");
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      throw new AuthError("Invitation has expired", 410, "INVITATION_EXPIRED");
    }
    if (!invitation.staff_active || !invitationSnapshotMatches(invitation)) {
      throw new AuthError("Invitation no longer matches the current staff record", 409, "INVITATION_INVALID");
    }
    if (!invitationMatchesAccount(invitation, auth)) {
      throw new AuthError("Sign in with the email or phone number that was invited", 403, "INVITATION_IDENTITY_MISMATCH");
    }

    const existingMembership = await client.query<{
      id: string;
      staff_id: string | null;
      role: BusinessRole;
      status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
    }>(
      `SELECT id,staff_id,role,status
       FROM business_memberships
       WHERE business_id=$1 AND user_id=$2
       FOR UPDATE`,
      [invitation.business_id, auth.userId],
    );
    const membership = existingMembership.rows[0];
    if (membership) {
      if (membership.staff_id !== invitation.staff_id) {
        throw new AuthError("This account is already linked to another staff record", 409, "USER_ALREADY_MEMBER");
      }
      if (membership.status === "SUSPENDED" || membership.status === "REMOVED") {
        throw new AuthError("This account already has restricted business access", 409, "USER_ALREADY_MEMBER");
      }
      await client.query(
        `UPDATE business_memberships
         SET role=$3,status='ACTIVE',updated_at=now()
         WHERE id=$1 AND business_id=$2`,
        [membership.id, invitation.business_id, invitation.role],
      );
    } else {
      await client.query(
        `INSERT INTO business_memberships(
           business_id,user_id,staff_id,role,status,created_by_user_id
         ) VALUES($1,$2,$3,$4,'ACTIVE',$5)`,
        [
          invitation.business_id,
          auth.userId,
          invitation.staff_id,
          invitation.role,
          invitation.created_by_user_id,
        ],
      );
    }

    await client.query(
      `UPDATE staff_invitations
       SET status='ACCEPTED',accepted_by_user_id=$2,accepted_at=now()
       WHERE id=$1`,
      [invitation.id, auth.userId],
    );
    await writeAudit(
      client,
      invitation.business_id,
      invitation.staff_id,
      "STAFF_INVITATION_ACCEPTED",
      "STAFF_INVITATION",
      invitation.id,
      { targetStaffId: invitation.staff_id, role: invitation.role },
    );
    return acceptanceFromInvitation(invitation);
  });
}

export async function registerStaffInvitationAccount(
  pool: DatabasePool,
  input: RegisterStaffInvitationRequest,
): Promise<RegisterStaffInvitationResponse> {
  const acceptanceToken = requireAcceptanceToken(input?.acceptanceToken);
  const displayName = normalizeDisplayName(input?.displayName);
  assertPlatform(input?.platform);
  if (!input?.deviceKey?.trim()) throw new AuthError("deviceKey is required", 400, "DEVICE_REQUIRED");
  if (!input?.appVersion?.trim()) throw new AuthError("appVersion is required", 400, "APP_VERSION_REQUIRED");
  const passwordHash = await hashPassword(input?.password ?? "");
  const hash = tokenHash(acceptanceToken);

  return withTransaction(pool, async (client) => {
    const found = await client.query<InvitationRow>(
      `SELECT
         i.id,i.business_id,i.staff_id,i.invited_email,i.invited_phone_e164,i.role,i.status,
         i.expires_at,i.created_by_user_id,i.created_by_staff_id,i.accepted_by_user_id,i.accepted_at,i.created_at,
         s.email AS staff_email,s.phone AS staff_phone,s.role AS staff_role,s.is_active AS staff_active
       FROM staff_invitations i
       JOIN staff s ON s.id=i.staff_id AND s.business_id=i.business_id
       WHERE i.token_hash=$1
       FOR UPDATE OF i,s`,
      [hash],
    );
    const invitation = found.rows[0];
    if (!invitation) throw new AuthError("Invitation link is invalid", 404, "INVITATION_INVALID");
    if (invitation.status !== "PENDING") {
      throw new AuthError("Invitation has already been used", 409, "INVITATION_ALREADY_USED");
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      throw new AuthError("Invitation has expired", 410, "INVITATION_EXPIRED");
    }
    if (!invitation.staff_active || !invitationSnapshotMatches(invitation)) {
      throw new AuthError("Invitation no longer matches the current staff record", 409, "INVITATION_INVALID");
    }

    const duplicate = await client.query<{ id: string }>(
      `SELECT id FROM app_users
       WHERE ($1::text IS NOT NULL AND lower(email)=lower($1))
          OR ($2::text IS NOT NULL AND phone_e164=$2)
       LIMIT 1`,
      [invitation.invited_email, invitation.invited_phone_e164],
    );
    if (duplicate.rowCount) {
      throw new AuthError("An account already uses the invited email or phone number", 409, "ACCOUNT_EXISTS");
    }

    let userId: string;
    try {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app_users(display_name,email,phone_e164,password_hash)
         VALUES($1,$2,$3,$4)
         RETURNING id`,
        [displayName, invitation.invited_email, invitation.invited_phone_e164, passwordHash],
      );
      userId = inserted.rows[0]!.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthError("An account already uses the invited email or phone number", 409, "ACCOUNT_EXISTS");
      }
      throw error;
    }

    await client.query(
      `INSERT INTO business_memberships(
         business_id,user_id,staff_id,role,status,created_by_user_id
       ) VALUES($1,$2,$3,$4,'ACTIVE',$5)`,
      [invitation.business_id, userId, invitation.staff_id, invitation.role, invitation.created_by_user_id],
    );
    await client.query(
      `UPDATE staff_invitations
       SET status='ACCEPTED',accepted_by_user_id=$2,accepted_at=now()
       WHERE id=$1`,
      [invitation.id, userId],
    );
    const session = await issueSession(client, {
      userId,
      platform: input.platform,
      deviceKey: input.deviceKey.trim(),
      appVersion: input.appVersion.trim(),
    });
    await writeAudit(
      client,
      invitation.business_id,
      invitation.staff_id,
      "STAFF_INVITATION_ACCEPTED",
      "STAFF_INVITATION",
      invitation.id,
      { targetStaffId: invitation.staff_id, role: invitation.role, accountCreated: true },
    );

    return {
      user: {
        id: userId,
        displayName,
        email: invitation.invited_email,
        phoneE164: invitation.invited_phone_e164,
        avatarUrl: null,
      },
      session,
      acceptance: acceptanceFromInvitation(invitation),
    };
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function mapInvitationSummary(row: InvitationRow): StaffInvitationSummary {
  return {
    id: row.id,
    businessId: row.business_id,
    staffId: row.staff_id,
    invitedEmail: row.invited_email,
    invitedPhoneE164: row.invited_phone_e164,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function requireAcceptanceToken(value: string | undefined): string {
  const token = value?.trim() ?? "";
  if (token.length < 32) {
    throw new AuthError("Invitation link is invalid", 404, "INVITATION_INVALID");
  }
  return token;
}

function invitationSnapshotMatches(invitation: InvitationRow): boolean {
  const email = normalizeNullableEmail(invitation.staff_email);
  const phone = normalizeNullablePhone(invitation.staff_phone);
  return invitation.staff_role === invitation.role
    && email === invitation.invited_email
    && phone === invitation.invited_phone_e164;
}

function invitationMatchesAccount(invitation: InvitationRow, auth: AuthContext): boolean {
  return Boolean(
    (invitation.invited_email && auth.email === invitation.invited_email)
    || (invitation.invited_phone_e164 && auth.phoneE164 === invitation.invited_phone_e164),
  );
}

function acceptanceFromInvitation(invitation: InvitationRow): StaffInvitationAcceptance {
  return {
    businessId: invitation.business_id,
    staffId: invitation.staff_id,
    role: invitation.role,
  };
}
