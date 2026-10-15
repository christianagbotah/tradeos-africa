import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const security = readFileSync(new URL("../src/platform-admin/security.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../src/platform-admin/routes.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../packages/db/migrations/0020_platform_admin_auth.sql", import.meta.url), "utf8");
const contracts = readFileSync(new URL("../../../packages/contracts/src/platform-admin.ts", import.meta.url), "utf8");
const provision = readFileSync(new URL("../src/platform-admin/provision.ts", import.meta.url), "utf8");

describe("platform admin privileged session contract", () => {
  it("persists one hashed opaque cookie session, never browser bearer/refresh material", () => {
    expect(migration).toContain("failed_login_count integer NOT NULL DEFAULT 0");
    expect(migration).toContain("locked_until timestamptz");
    expect(migration).toContain("password_changed_at timestamptz");
    expect(migration).toContain("session_token_hash char(64) NOT NULL UNIQUE");
    expect(migration).toContain("expires_at timestamptz NOT NULL");
    expect(migration).toContain("last_used_at timestamptz NOT NULL DEFAULT now()");
    expect(migration).not.toContain("access_token_hash");
    expect(migration).not.toContain("refresh_token_hash");

    expect(security).toContain("tos_admin_session_");
    expect(security).toContain("FOR UPDATE");
    expect(security).toContain("failed_login_count");
    expect(security).toContain("interval '15 minutes'");
    expect(security).toContain('"ADMIN_LOGIN_LOCKED"');
    expect(security).toContain('"ADMIN_LOGIN_SUCCEEDED"');
    expect(security).toContain('"ADMIN_LOGOUT"');
    expect(security).not.toContain("tos_admin_access_");
    expect(security).not.toContain("tos_admin_refresh_");
    expect(routes).toContain("__Host-tradeos_admin_session");
    expect(routes).toContain("HttpOnly");
    expect(routes).toContain("Secure");
    expect(routes).toContain("SameSite=Strict");
    expect(routes).not.toContain("/api/admin/session/refresh");

    expect(contracts).not.toContain("accessToken");
    expect(contracts).not.toContain("refreshToken");
    expect(provision).toContain("input.password.length < 12");
    expect(provision).toContain("password_changed_at=now()");
  });
});
