import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const demoMigrationUrl = new URL("../../../packages/db/migrations/0013_demo_accounts.sql", import.meta.url);

const demoAccounts = [
  ["demo.owner@tradeos.africa", "OWNER"],
  ["demo.admin@tradeos.africa", "ADMIN"],
  ["demo.manager@tradeos.africa", "MANAGER"],
  ["demo.cashier@tradeos.africa", "CASHIER"],
  ["demo.sales@tradeos.africa", "SALES"],
  ["demo.inventory@tradeos.africa", "INVENTORY"],
  ["demo.accountant@tradeos.africa", "ACCOUNTANT"],
  ["demo.staff@tradeos.africa", "STAFF"],
  ["demo.viewer@tradeos.africa", "VIEWER"],
] as const;

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE app_users, businesses CASCADE");
  const migration = await readFile(demoMigrationUrl, "utf8");
  await pool.query(migration);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("seeded demo accounts", () => {
  for (const [email, role] of demoAccounts) {
    it(`logs in ${role} through normal authentication`, async () => {
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          identifier: email,
          password: "TradeOSDemo2026!",
          platform: "WEB",
          deviceKey: `demo-test-${role.toLowerCase()}`,
          appVersion: "test-demo",
        },
      });

      expect(login.statusCode).toBe(200);
      const accessToken = login.json<{ session: { accessToken: string } }>().session.accessToken;
      const me = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(me.statusCode).toBe(200);
      expect(me.json<{ memberships: Array<{ businessName: string; role: string; staffId: string | null }> }>().memberships)
        .toContainEqual(expect.objectContaining({
          businessName: "TradeOS Demo Company",
          role,
          staffId: expect.any(String),
        }));
    });
  }
});
