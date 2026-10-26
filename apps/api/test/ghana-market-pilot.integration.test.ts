import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations/migration-runner.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `ghana_market_pilot_${randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const app = buildApp(pool);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const OWNER_PHONE_INPUT = "+233 (24) 012-3456";
const OWNER_PHONE_E164 = "+233240123456";
const OWNER_PASSWORD = "Pilot-Test-Password-1234";
const OWNER_DEVICE = "ghana-market-owner-device";

let ownerToken = "";
let ownerUserId = "";
let businessId = "";
let branchId = "";
let supplierId = "";
let customerId = "";
let nailsItemId = "";

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("Ghana market pilot readiness", () => {
  it("onboards a phone-first Ghana hardware business and creates realistic bulk-unit master data", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Kwame Mensah",
        phone: OWNER_PHONE_INPUT,
        password: OWNER_PASSWORD,
        platform: "WEB",
        deviceKey: OWNER_DEVICE,
        appVersion: "pilot-1.0.0",
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);
    const registrationBody = registration.json<{
      user: { id: string; email: string | null; phoneE164: string | null };
      session: { accessToken: string };
    }>();
    expect(registrationBody.user).toMatchObject({ email: null, phoneE164: OWNER_PHONE_E164 });
    ownerToken = registrationBody.session.accessToken;
    ownerUserId = registrationBody.user.id;

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        identifier: OWNER_PHONE_INPUT,
        password: OWNER_PASSWORD,
        platform: "WEB",
        deviceKey: `${OWNER_DEVICE}-login`,
        appVersion: "pilot-1.0.0",
      },
    });
    expect(login.statusCode, login.body).toBe(200);

    const onboarding = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers: bearer(ownerToken),
      payload: {
        name: "Akwaaba Hardware & Building Supplies",
        businessType: "RETAIL_HARDWARE",
        branchName: "Kaneshie Main",
        countryCode: "GH",
        currencyCode: "GHS",
        timezone: "Africa/Accra",
        city: "Accra",
        region: "Greater Accra",
      },
    });
    expect(onboarding.statusCode, onboarding.body).toBe(201);
    const onboarded = onboarding.json<{
      business: { id: string; name: string; businessType: string; countryCode: string; currencyCode: string; timezone: string };
      branch: { id: string; name: string; timezone: string };
    }>();
    businessId = onboarded.business.id;
    branchId = onboarded.branch.id;
    expect(onboarded.business).toMatchObject({
      name: "Akwaaba Hardware & Building Supplies",
      businessType: "RETAIL_HARDWARE",
      countryCode: "GH",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
    });
    expect(onboarded.branch).toMatchObject({ name: "Kaneshie Main", timezone: "Africa/Accra" });

    const supplier = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers: bearer(ownerToken),
      payload: { businessId, name: "Accra Fasteners Ltd", phone: "+233302555010", paymentTermsDays: 30 },
    });
    expect(supplier.statusCode, supplier.body).toBe(201);
    supplierId = supplier.json<{ supplier: { id: string } }>().supplier.id;

    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: bearer(ownerToken),
      payload: {
        businessId,
        name: "Ama Boateng",
        phone: "+233244555011",
        creditLimitMinor: 50000,
        creditTermsDays: 14,
      },
    });
    expect(customer.statusCode, customer.body).toBe(201);
    customerId = customer.json<{ customer: { id: string } }>().customer.id;

    const catalog = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers: bearer(ownerToken),
      payload: {
        businessId,
        sku: "NAILS-ROOF-BOX",
        name: "Roofing Nails",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "lb",
        units: [
          { code: "lb", label: "Pound", canStock: true, canSell: true, defaultSalePriceMinor: 3000 },
          { code: "box", label: "Box", canPurchase: true },
        ],
        conversions: [{ fromUnitCode: "box", toUnitCode: "lb", factor: 50 }],
      },
    });
    expect(catalog.statusCode, catalog.body).toBe(201);
    const item = catalog.json<{ item: { id: string; stockUnitCode: string; units: Array<{ code: string; defaultSalePriceMinor: number | null }>; conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }> } }>().item;
    nailsItemId = item.id;
    expect(item.stockUnitCode).toBe("lb");
    expect(item.units).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "lb", defaultSalePriceMinor: 3000 }),
      expect.objectContaining({ code: "box" }),
    ]));
    expect(item.conversions).toContainEqual(expect.objectContaining({ fromUnitCode: "box", toUnitCode: "lb", factor: 50 }));

    const membership = await pool.query<{ role: string; staff_id: string | null }>(
      `SELECT role,staff_id FROM business_memberships WHERE business_id=$1 AND user_id=$2`,
      [businessId, ownerUserId],
    );
    expect(membership.rows[0]).toMatchObject({ role: "OWNER" });
    expect(membership.rows[0]?.staff_id).toBeTruthy();

    expect(supplierId).toBeTruthy();
    expect(customerId).toBeTruthy();
    expect(nailsItemId).toBeTruthy();
  });
});

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
