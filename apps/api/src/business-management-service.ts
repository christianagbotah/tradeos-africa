import { randomUUID } from "node:crypto";
import {
  getCountry,
  getCurrencyMeta,
  isSupportedTimezone,
} from "@tradeos/contracts";
import { requireBusinessRole, type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { AuthError, normalizeEmail, normalizePhone, type AuthContext } from "./auth/security.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

export const BUSINESS_TYPES = [
  "RETAIL_HARDWARE",
  "FOOD",
  "SALON_BARBER",
  "DRINKING_SPOT",
  "WASHING_BAY",
  "CAR_PARK",
  "DISTRIBUTION",
  "SERVICES",
  "OTHER",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

const MANAGEMENT_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN"];

export interface CreateOwnedBusinessRequest {
  name: string;
  legalName?: string | null;
  businessType: BusinessType;
  email?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
  logoUrl?: string | null;
  branchName?: string;
}

export interface BusinessProfileUpdateRequest {
  name?: string;
  legalName?: string | null;
  businessType?: BusinessType;
  email?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
  logoUrl?: string | null;
}

export interface BranchCreateRequest {
  name: string;
  code?: string;
  timezone?: string;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

export interface BranchUpdateRequest {
  name?: string;
  timezone?: string;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

export interface BusinessView {
  id: string;
  name: string;
  legalName: string | null;
  businessType: string;
  email: string | null;
  phone: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  logoUrl: string | null;
  status: string;
}

export interface BranchView {
  id: string;
  name: string;
  code: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  active: boolean;
  updatedAt: string;
}

export interface OwnedBusinessResult {
  business: BusinessView;
  branch: BranchView;
  owner: { staffId: string; membershipId: string; role: "OWNER" };
}

export async function createOwnedBusiness(
  pool: DatabasePool,
  auth: AuthContext,
  request: CreateOwnedBusinessRequest,
  auditEventType: "BUSINESS_CREATED" | "BUSINESS_ONBOARDED" = "BUSINESS_CREATED",
): Promise<OwnedBusinessResult> {
  const input = validateCreateBusiness(request);
  return withTransaction(pool, async (client) => {
    const businessId = randomUUID();
    const branchId = randomUUID();
    const staffId = randomUUID();
    const membershipId = randomUUID();

    await client.query(
      `INSERT INTO businesses (
         id,name,legal_name,business_type,email,phone,registration_number,tax_id,
         address_line1,address_line2,city,region,postal_code,country_code,currency_code,timezone,logo_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        businessId, input.name, input.legalName, input.businessType, input.email, input.phone,
        input.registrationNumber, input.taxId, input.addressLine1, input.addressLine2, input.city,
        input.region, input.postalCode, input.countryCode, input.currencyCode, input.timezone, input.logoUrl,
      ],
    );
    await client.query(
      `INSERT INTO branches (id,business_id,name,code,timezone)
       VALUES ($1,$2,$3,'MAIN',$4)`,
      [branchId, businessId, input.branchName, input.timezone],
    );
    await client.query(
      `INSERT INTO staff (id,business_id,display_name,phone,email,role)
       VALUES ($1,$2,$3,$4,$5,'OWNER')`,
      [staffId, businessId, auth.displayName, auth.phoneE164, auth.email],
    );
    await client.query(
      `INSERT INTO business_memberships (
         id,business_id,user_id,staff_id,role,status,created_by_user_id
       ) VALUES ($1,$2,$3,$4,'OWNER','ACTIVE',$3)`,
      [membershipId, businessId, auth.userId, staffId],
    );
    await client.query(
      `INSERT INTO registered_devices (
         business_id,branch_id,device_key,platform,app_version,status,last_seen_at,last_sync_at
       ) VALUES ($1,$2,$3,$4,$5,'ACTIVE',now(),now())
       ON CONFLICT (business_id,device_key) DO UPDATE SET
         branch_id=EXCLUDED.branch_id,
         platform=EXCLUDED.platform,
         app_version=EXCLUDED.app_version,
         status='ACTIVE',
         last_seen_at=now(),
         updated_at=now()`,
      [businessId, branchId, auth.deviceKey, auth.platform, auth.appVersion],
    );
    await client.query(
      `INSERT INTO audit_events (
         business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,payload
       ) VALUES ($1,$2,$3,$4,'BUSINESS',$1,$5::jsonb)`,
      [
        businessId,
        branchId,
        staffId,
        auditEventType,
        JSON.stringify({ businessType: input.businessType, platform: auth.platform, appVersion: auth.appVersion }),
      ],
    );

    const business = await loadBusinessRow(client, businessId);
    const branch = await loadBranchRow(client, businessId, branchId);
    return {
      business: mapBusiness(business),
      branch: mapBranch(branch),
      owner: { staffId, membershipId, role: "OWNER" },
    };
  });
}

export async function updateBusinessProfile(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
  request: BusinessProfileUpdateRequest,
): Promise<BusinessView> {
  const access = await requireBusinessRole(pool, auth, businessId, MANAGEMENT_ROLES);
  requireStaffActor(access);

  return withTransaction(pool, async (client) => {
    const current = await loadBusinessRow(client, businessId, true);
    const next = {
      name: request.name === undefined ? current.name : validateBusinessName(request.name),
      legalName: request.legalName === undefined ? current.legal_name : nullableText(request.legalName, 160, "INVALID_LEGAL_NAME"),
      businessType: request.businessType === undefined ? current.business_type : validateBusinessType(request.businessType),
      email: request.email === undefined ? current.email : normalizeNullableEmail(request.email),
      phone: request.phone === undefined ? current.phone : normalizeNullablePhone(request.phone),
      registrationNumber: request.registrationNumber === undefined ? current.registration_number : nullableText(request.registrationNumber, 120, "INVALID_REGISTRATION_NUMBER"),
      taxId: request.taxId === undefined ? current.tax_id : nullableText(request.taxId, 120, "INVALID_TAX_ID"),
      addressLine1: request.addressLine1 === undefined ? current.address_line1 : nullableText(request.addressLine1, 200, "INVALID_ADDRESS"),
      addressLine2: request.addressLine2 === undefined ? current.address_line2 : nullableText(request.addressLine2, 200, "INVALID_ADDRESS"),
      city: request.city === undefined ? current.city : nullableText(request.city, 120, "INVALID_CITY"),
      region: request.region === undefined ? current.region : nullableText(request.region, 120, "INVALID_REGION"),
      postalCode: request.postalCode === undefined ? current.postal_code : nullableText(request.postalCode, 40, "INVALID_POSTAL_CODE"),
      countryCode: request.countryCode === undefined ? current.country_code : validateCountryCode(request.countryCode),
      currencyCode: request.currencyCode === undefined ? current.currency_code : validateCurrencyCode(request.currencyCode),
      timezone: request.timezone === undefined ? current.timezone : validateTimezone(request.timezone),
      logoUrl: request.logoUrl === undefined ? current.logo_url : validateUrl(request.logoUrl, "INVALID_LOGO_URL"),
    };

    if (next.currencyCode !== current.currency_code && await hasBusinessActivity(client, businessId)) {
      throw new AuthError("Base currency cannot change after business activity has been recorded", 409, "BASE_CURRENCY_LOCKED");
    }

    const updated = await client.query<BusinessRow>(
      `UPDATE businesses SET
         name=$2,legal_name=$3,business_type=$4,email=$5,phone=$6,registration_number=$7,tax_id=$8,
         address_line1=$9,address_line2=$10,city=$11,region=$12,postal_code=$13,country_code=$14,
         currency_code=$15,timezone=$16,logo_url=$17,updated_at=now()
       WHERE id=$1
       RETURNING ${BUSINESS_COLUMNS}`,
      [
        businessId,
        next.name,
        next.legalName,
        next.businessType,
        next.email,
        next.phone,
        next.registrationNumber,
        next.taxId,
        next.addressLine1,
        next.addressLine2,
        next.city,
        next.region,
        next.postalCode,
        next.countryCode,
        next.currencyCode,
        next.timezone,
        next.logoUrl,
      ],
    );
    await writeBusinessAudit(client, access, "BUSINESS_UPDATED", "BUSINESS", businessId, {
      changedFields: changedBusinessFields(current, next),
    });
    return mapBusiness(updated.rows[0]!);
  });
}

export async function createBranch(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
  request: BranchCreateRequest,
): Promise<BranchView> {
  const access = await requireBusinessRole(pool, auth, businessId, MANAGEMENT_ROLES);
  requireStaffActor(access);

  try {
    return await withTransaction(pool, async (client) => {
      const business = await loadBusinessRow(client, businessId);
      const name = validateBranchName(request.name);
      const timezone = request.timezone === undefined ? business.timezone : validateTimezone(request.timezone);
      const code = request.code ? validateBranchCode(request.code) : await generateBranchCode(client, businessId, name);
      if (await branchCodeExists(client, businessId, code)) {
        throw new AuthError("Branch code already exists", 409, "BRANCH_CODE_EXISTS");
      }
      const branchId = randomUUID();
      const inserted = await client.query<BranchRow>(
        `INSERT INTO branches (
           id,business_id,name,code,timezone,email,phone,address_line1,address_line2,city,region,postal_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${BRANCH_COLUMNS}`,
        [
          branchId,
          businessId,
          name,
          code,
          timezone,
          normalizeNullableEmail(request.email),
          normalizeNullablePhone(request.phone),
          nullableText(request.addressLine1, 200, "INVALID_ADDRESS"),
          nullableText(request.addressLine2, 200, "INVALID_ADDRESS"),
          nullableText(request.city, 120, "INVALID_CITY"),
          nullableText(request.region, 120, "INVALID_REGION"),
          nullableText(request.postalCode, 40, "INVALID_POSTAL_CODE"),
        ],
      );
      await writeBusinessAudit(client, access, "BRANCH_CREATED", "BRANCH", branchId, { code });
      return mapBranch(inserted.rows[0]!);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AuthError("Branch code already exists", 409, "BRANCH_CODE_EXISTS");
    throw error;
  }
}

export async function updateBranch(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
  branchId: string,
  request: BranchUpdateRequest,
): Promise<BranchView> {
  const access = await requireBusinessRole(pool, auth, businessId, MANAGEMENT_ROLES);
  requireStaffActor(access);

  return withTransaction(pool, async (client) => {
    const current = await loadBranchRow(client, businessId, branchId, true);
    const next = {
      name: request.name === undefined ? current.name : validateBranchName(request.name),
      timezone: request.timezone === undefined ? current.timezone : validateTimezone(request.timezone),
      email: request.email === undefined ? current.email : normalizeNullableEmail(request.email),
      phone: request.phone === undefined ? current.phone : normalizeNullablePhone(request.phone),
      addressLine1: request.addressLine1 === undefined ? current.address_line1 : nullableText(request.addressLine1, 200, "INVALID_ADDRESS"),
      addressLine2: request.addressLine2 === undefined ? current.address_line2 : nullableText(request.addressLine2, 200, "INVALID_ADDRESS"),
      city: request.city === undefined ? current.city : nullableText(request.city, 120, "INVALID_CITY"),
      region: request.region === undefined ? current.region : nullableText(request.region, 120, "INVALID_REGION"),
      postalCode: request.postalCode === undefined ? current.postal_code : nullableText(request.postalCode, 40, "INVALID_POSTAL_CODE"),
    };
    const updated = await client.query<BranchRow>(
      `UPDATE branches SET
         name=$3,timezone=$4,email=$5,phone=$6,address_line1=$7,address_line2=$8,city=$9,region=$10,postal_code=$11,updated_at=now()
       WHERE business_id=$1 AND id=$2
       RETURNING ${BRANCH_COLUMNS}`,
      [
        businessId,
        branchId,
        next.name,
        next.timezone,
        next.email,
        next.phone,
        next.addressLine1,
        next.addressLine2,
        next.city,
        next.region,
        next.postalCode,
      ],
    );
    await writeBusinessAudit(client, access, "BRANCH_UPDATED", "BRANCH", branchId, { code: current.code });
    return mapBranch(updated.rows[0]!);
  });
}

export async function setBranchActive(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
  branchId: string,
  active: boolean,
): Promise<BranchView> {
  const access = await requireBusinessRole(pool, auth, businessId, MANAGEMENT_ROLES);
  requireStaffActor(access);

  return withTransaction(pool, async (client) => {
    const current = await loadBranchRow(client, businessId, branchId, true);
    if (current.is_active === active) return mapBranch(current);
    if (!active) {
      const activeRows = await client.query<{ id: string }>(
        "SELECT id FROM branches WHERE business_id=$1 AND is_active=true FOR UPDATE",
        [businessId],
      );
      if (activeRows.rows.length <= 1) {
        throw new AuthError("A business must keep at least one active branch", 409, "LAST_ACTIVE_BRANCH");
      }
    }
    const updated = await client.query<BranchRow>(
      `UPDATE branches SET is_active=$3,updated_at=now()
       WHERE business_id=$1 AND id=$2
       RETURNING ${BRANCH_COLUMNS}`,
      [businessId, branchId, active],
    );
    await writeBusinessAudit(
      client,
      access,
      active ? "BRANCH_REACTIVATED" : "BRANCH_DEACTIVATED",
      "BRANCH",
      branchId,
      { code: current.code },
    );
    return mapBranch(updated.rows[0]!);
  });
}

export async function loadBusinessContext(pool: DatabasePool, businessId: string): Promise<{ business: BusinessView; branches: BranchView[] }> {
  const business = await loadBusinessRow(pool, businessId);
  const branches = await pool.query<BranchRow>(
    `SELECT ${BRANCH_COLUMNS} FROM branches
     WHERE business_id=$1
     ORDER BY CASE WHEN code='MAIN' THEN 0 ELSE 1 END, created_at`,
    [businessId],
  );
  return { business: mapBusiness(business), branches: branches.rows.map(mapBranch) };
}

export function validateCreateBusiness(body: CreateOwnedBusinessRequest) {
  const name = validateBusinessName(body.name);
  const businessType = validateBusinessType(body.businessType);
  const branchName = validateBranchName(body.branchName?.trim() || "Main");

  const countryCodeRaw = body.countryCode?.trim().toUpperCase();
  const country = getCountry(countryCodeRaw || "GH");
  if (!country) {
    throw new AuthError(`Unsupported country code: ${countryCodeRaw}. See the supported countries list.`, 400, "UNSUPPORTED_COUNTRY");
  }
  const countryCode = country.countryCode;
  const currencyCode = validateCurrencyCode(body.currencyCode?.trim() || country.defaultCurrencyCode);
  const timezone = validateTimezone(body.timezone?.trim() || country.timezones[0]!);
  return {
    name,
    legalName: nullableText(body.legalName, 160, "INVALID_LEGAL_NAME"),
    businessType,
    email: normalizeNullableEmail(body.email),
    phone: normalizeNullablePhone(body.phone),
    registrationNumber: nullableText(body.registrationNumber, 120, "INVALID_REGISTRATION_NUMBER"),
    taxId: nullableText(body.taxId, 120, "INVALID_TAX_ID"),
    addressLine1: nullableText(body.addressLine1, 200, "INVALID_ADDRESS"),
    addressLine2: nullableText(body.addressLine2, 200, "INVALID_ADDRESS"),
    city: nullableText(body.city, 120, "INVALID_CITY"),
    region: nullableText(body.region, 120, "INVALID_REGION"),
    postalCode: nullableText(body.postalCode, 40, "INVALID_POSTAL_CODE"),
    countryCode,
    currencyCode,
    timezone,
    logoUrl: validateUrl(body.logoUrl ?? null, "INVALID_LOGO_URL"),
    branchName,
  };
}

type Queryable = Pick<DatabaseClient, "query"> | Pick<DatabasePool, "query">;

type BusinessRow = {
  id: string;
  name: string;
  legal_name: string | null;
  business_type: string;
  email: string | null;
  phone: string | null;
  registration_number: string | null;
  tax_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  currency_code: string;
  timezone: string;
  logo_url: string | null;
  status: string;
};

type BranchRow = {
  id: string;
  name: string;
  code: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  is_active: boolean;
  updated_at: Date;
};

const BUSINESS_COLUMNS = "id,name,legal_name,business_type,email,phone,registration_number,tax_id,address_line1,address_line2,city,region,postal_code,country_code,currency_code,timezone,logo_url,status";
const BRANCH_COLUMNS = "id,name,code,timezone,email,phone,address_line1,address_line2,city,region,postal_code,is_active,updated_at";

async function loadBusinessRow(queryable: Queryable, businessId: string, forUpdate = false): Promise<BusinessRow> {
  const result = await queryable.query<BusinessRow>(
    `SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE id=$1${forUpdate ? " FOR UPDATE" : ""}`,
    [businessId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError("Business was not found", 404, "BUSINESS_NOT_FOUND");
  return row;
}

async function loadBranchRow(queryable: Queryable, businessId: string, branchId: string, forUpdate = false): Promise<BranchRow> {
  const result = await queryable.query<BranchRow>(
    `SELECT ${BRANCH_COLUMNS} FROM branches WHERE business_id=$1 AND id=$2${forUpdate ? " FOR UPDATE" : ""}`,
    [businessId, branchId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError("Branch was not found", 404, "BRANCH_NOT_FOUND");
  return row;
}

function mapBusiness(row: BusinessRow): BusinessView {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    businessType: row.business_type,
    email: row.email,
    phone: row.phone,
    registrationNumber: row.registration_number,
    taxId: row.tax_id,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    currencyCode: row.currency_code,
    timezone: row.timezone,
    logoUrl: row.logo_url,
    status: row.status,
  };
}

function mapBranch(row: BranchRow): BranchView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    timezone: row.timezone,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    active: row.is_active,
    updatedAt: row.updated_at.toISOString(),
  };
}

function validateBusinessName(value: string): string {
  const name = value?.trim();
  if (!name || name.length < 2 || name.length > 120) {
    throw new AuthError("Business name must contain 2 to 120 characters", 400, "INVALID_BUSINESS_NAME");
  }
  return name;
}

function validateBusinessType(value: BusinessType): BusinessType {
  if (!BUSINESS_TYPES.includes(value)) {
    throw new AuthError("A supported business type is required", 400, "INVALID_BUSINESS_TYPE");
  }
  return value;
}

function validateBranchName(value: string): string {
  const name = value?.trim();
  if (!name || name.length < 2 || name.length > 120) {
    throw new AuthError("Branch name must contain 2 to 120 characters", 400, "INVALID_BRANCH_NAME");
  }
  return name;
}

function validateBranchCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code)) {
    throw new AuthError("Branch code must use 2 to 24 letters, numbers, hyphens or underscores", 400, "INVALID_BRANCH_CODE");
  }
  return code;
}

function validateCountryCode(value: string): string {
  const code = value.trim().toUpperCase();
  const country = getCountry(code);
  if (!country) throw new AuthError(`Unsupported country code: ${code}`, 400, "UNSUPPORTED_COUNTRY");
  return country.countryCode;
}

function validateCurrencyCode(value: string): string {
  const code = value.trim().toUpperCase();
  const meta = getCurrencyMeta(code);
  if (!meta) throw new AuthError(`Unsupported currency code: ${code}`, 400, "UNSUPPORTED_CURRENCY");
  return meta.currencyCode;
}

function validateTimezone(value: string): string {
  const timezone = value.trim();
  if (!isSupportedTimezone(timezone)) {
    throw new AuthError(`Unsupported timezone: ${timezone}. Use a supported IANA timezone identifier.`, 400, "UNSUPPORTED_TIMEZONE");
  }
  return timezone;
}

function normalizeNullableEmail(value: string | null | undefined): string | null {
  return value === null || value === undefined || !value.trim() ? null : normalizeEmail(value);
}

function normalizeNullablePhone(value: string | null | undefined): string | null {
  return value === null || value === undefined || !value.trim() ? null : normalizePhone(value);
}

function nullableText(value: string | null | undefined, maxLength: number, code: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new AuthError("Value is too long", 400, code);
  return trimmed;
}

function validateUrl(value: string | null, code: string): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > 2048) throw new AuthError("URL is too long", 400, code);
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
  } catch {
    throw new AuthError("URL must be valid HTTP or HTTPS", 400, code);
  }
  return trimmed;
}

async function hasBusinessActivity(client: DatabaseClient, businessId: string): Promise<boolean> {
  const result = await client.query<{ has_activity: boolean }>(
    `SELECT (
       EXISTS(SELECT 1 FROM sales WHERE business_id=$1)
       OR EXISTS(SELECT 1 FROM purchases WHERE business_id=$1)
       OR EXISTS(SELECT 1 FROM cashbook_entries WHERE business_id=$1)
       OR EXISTS(SELECT 1 FROM inventory_movements WHERE business_id=$1)
     ) AS has_activity`,
    [businessId],
  );
  return result.rows[0]?.has_activity ?? false;
}

async function generateBranchCode(client: DatabaseClient, businessId: string, name: string): Promise<string> {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = (normalized || "BRANCH").slice(0, 24).replace(/-+$/g, "") || "BRANCH";
  if (!(await branchCodeExists(client, businessId, base))) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 24 - suffixText.length).replace(/-+$/g, "")}${suffixText}`;
    if (!(await branchCodeExists(client, businessId, candidate))) return candidate;
  }
  throw new AuthError("A unique branch code could not be generated", 409, "BRANCH_CODE_EXHAUSTED");
}

async function branchCodeExists(client: DatabaseClient, businessId: string, code: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM branches WHERE business_id=$1 AND code=$2 LIMIT 1", [businessId, code]);
  return Boolean(result.rowCount);
}

function changedBusinessFields(current: BusinessRow, next: Record<string, string | null>): string[] {
  const mapping: Array<[string, keyof BusinessRow, string]> = [
    ["name", "name", "name"],
    ["legalName", "legal_name", "legalName"],
    ["businessType", "business_type", "businessType"],
    ["email", "email", "email"],
    ["phone", "phone", "phone"],
    ["registrationNumber", "registration_number", "registrationNumber"],
    ["taxId", "tax_id", "taxId"],
    ["addressLine1", "address_line1", "addressLine1"],
    ["addressLine2", "address_line2", "addressLine2"],
    ["city", "city", "city"],
    ["region", "region", "region"],
    ["postalCode", "postal_code", "postalCode"],
    ["countryCode", "country_code", "countryCode"],
    ["currencyCode", "currency_code", "currencyCode"],
    ["timezone", "timezone", "timezone"],
    ["logoUrl", "logo_url", "logoUrl"],
  ];
  return mapping.filter(([, rowKey, nextKey]) => current[rowKey] !== next[nextKey]).map(([label]) => label);
}

function requireStaffActor(access: BusinessAccess): asserts access is BusinessAccess & { staffId: string } {
  if (!access.staffId) {
    throw new AuthError("Your business membership is not linked to an active staff actor", 403, "STAFF_ACTOR_REQUIRED");
  }
}

async function writeBusinessAudit(
  client: DatabaseClient,
  access: BusinessAccess & { staffId: string },
  eventType: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [access.businessId, access.staffId, eventType, entityType, entityId, JSON.stringify(payload)],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}
