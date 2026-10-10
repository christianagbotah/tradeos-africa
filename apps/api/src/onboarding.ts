import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import {
  getCountry,
  getCurrencyMeta,
  isSupportedTimezone,
} from "@tradeos/contracts";

const BUSINESS_TYPES = [
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

type BusinessType = (typeof BUSINESS_TYPES)[number];

interface CreateBusinessBody {
  name: string;
  businessType: BusinessType;
  branchName?: string;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
}

export function registerOnboardingRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: CreateBusinessBody }>("/v1/onboarding/business", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const input = validateCreateBusiness(request.body);

      const result = await withTransaction(pool, async (client) => {
        const businessId = randomUUID();
        const branchId = randomUUID();
        const staffId = randomUUID();
        const membershipId = randomUUID();

        await client.query(
          `INSERT INTO businesses (id,name,country_code,currency_code,business_type,timezone)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [businessId, input.name, input.countryCode, input.currencyCode, input.businessType, input.timezone],
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
           ) VALUES ($1,$2,$3,'BUSINESS_ONBOARDED','BUSINESS',$1,$4::jsonb)`,
          [
            businessId,
            branchId,
            staffId,
            JSON.stringify({ businessType: input.businessType, platform: auth.platform, appVersion: auth.appVersion }),
          ],
        );

        return { businessId, branchId, staffId, membershipId };
      });

      return reply.code(201).send({
        business: {
          id: result.businessId,
          name: input.name,
          businessType: input.businessType,
          countryCode: input.countryCode,
          currencyCode: input.currencyCode,
          timezone: input.timezone,
        },
        branch: { id: result.branchId, name: input.branchName, code: "MAIN" },
        owner: { staffId: result.staffId, membershipId: result.membershipId, role: "OWNER" },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "ONBOARDING_FAILED", message: "The business could not be created." });
    }
  });
}

function validateCreateBusiness(body: CreateBusinessBody) {
  const name = body.name?.trim();
  if (!name || name.length < 2 || name.length > 120) {
    throw new AuthError("Business name must contain 2 to 120 characters", 400, "INVALID_BUSINESS_NAME");
  }
  if (!BUSINESS_TYPES.includes(body.businessType)) {
    throw new AuthError("A supported business type is required", 400, "INVALID_BUSINESS_TYPE");
  }

  const branchName = body.branchName?.trim() || "Main";
  if (branchName.length > 120) throw new AuthError("Branch name is too long", 400, "INVALID_BRANCH_NAME");

  // --- Country: explicit unsupported values are rejected with no silent fallback. ---
  // For compatibility with existing clients that predate country-aware onboarding,
  // an omitted country retains the historical Ghana default. The current web UI
  // always sends an explicit supported country.
  const countryCodeRaw = body.countryCode?.trim().toUpperCase();
  const country = getCountry(countryCodeRaw || "GH");
  if (!country) {
    throw new AuthError(
      `Unsupported country code: ${countryCodeRaw}. See the supported countries list.`,
      400,
      "UNSUPPORTED_COUNTRY",
    );
  }
  const countryCode = country.countryCode;

  // --- Currency: must be a supported TradeOS currency. ---
  // Country provides a recommended default, but the user may explicitly choose
  // another supported currency for cross-border scenarios.
  const currencyCodeRaw = (body.currencyCode?.trim() || country.defaultCurrencyCode).toUpperCase();
  const currencyMeta = getCurrencyMeta(currencyCodeRaw);
  if (!currencyMeta) {
    throw new AuthError(
      `Unsupported currency code: ${currencyCodeRaw}. See the supported currencies list.`,
      400,
      "UNSUPPORTED_CURRENCY",
    );
  }
  const currencyCode = currencyMeta.currencyCode;

  // --- Timezone: must be a supported IANA timezone. ---
  // Country supplies suggested timezone(s); user may choose another supported value.
  const timezoneRaw = body.timezone?.trim() || country.timezones[0];
  if (!isSupportedTimezone(timezoneRaw)) {
    throw new AuthError(
      `Unsupported timezone: ${timezoneRaw}. Use a supported IANA timezone identifier.`,
      400,
      "UNSUPPORTED_TIMEZONE",
    );
  }
  const timezone = timezoneRaw;

  return { name, businessType: body.businessType, branchName, countryCode, currencyCode, timezone };
}
