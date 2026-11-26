import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("system-admin live read-plane contract", () => {
  it("uses HttpOnly admin-cookie sessions and keeps privileged tokens out of browser JavaScript", () => {
    const session = read("components/platform-admin-session.tsx");
    expect(session).toContain('/api/admin/session/login');
    expect(session).toContain('/api/admin/session/me');
    expect(session).toContain('/api/admin/session/logout');
    expect(session).toContain('credentials: "include"');
    expect(session).not.toContain('/api/admin/session/refresh');
    expect(session).not.toContain('sessionStorage');
    expect(session).not.toContain('accessToken');
    expect(session).not.toContain('refreshToken');
    expect(session).not.toContain('withBearer');
    expect(session).not.toContain('tradeos.web.session');
    expect(session).not.toContain('/v1/auth/login');
  });

  it("guards the console and renders a real administrator login page", () => {
    expect(read("page.tsx")).toContain("Administrator sign in");
    expect(read("page.tsx")).toContain("Merchant and business-user credentials do not grant access here");
    expect(read("console/layout.tsx")).toContain("PlatformAdminConsoleGate");
    expect(read("components/admin-shell.tsx")).not.toContain("admin session API pending");
  });

  it("connects each implemented console page to its live read endpoint", () => {
    const endpoints: Array<[string, string]> = [
      ["console/tenants/page.tsx", "/api/admin/tenants"],
      ["console/devices/page.tsx", "/api/admin/devices"],
      ["console/audit/page.tsx", "/api/admin/audit-events"],
      ["console/releases/page.tsx", "/api/admin/releases"],
      ["console/flags/page.tsx", "/api/admin/feature-flags"],
    ];
    for (const [file, endpoint] of endpoints) {
      const source = read(file);
      expect(source).toContain("useAdminResource");
      expect(source).toContain(endpoint);
      expect(source.toLowerCase()).not.toContain("api pending");
    }
  });

  it("uses one authoritative metrics endpoint for the command center without disconnected placeholder values", () => {
    const overview = read("console/page.tsx");
    expect(overview).toContain("useAdminResource");
    expect(overview).toContain('/api/admin/metrics');
    expect(overview).not.toContain('/api/admin/tenants');
    expect(overview).not.toContain('/api/admin/devices');
    expect(overview).not.toContain('/api/admin/releases');
    expect(overview).not.toContain('"—"');
    expect(overview).toContain("recurringRevenue");
    expect(overview).toContain("overdueBalanceByCurrency");
    expect(overview).toContain("syncRiskTenantCount");
  });

  it("keeps release and feature-flag mutation controls unavailable in the read plane", () => {
    const releases = read("console/releases/page.tsx");
    const flags = read("console/flags/page.tsx");
    expect(releases).not.toContain("New release");
    expect(flags).not.toContain("New flag");
    expect(releases.toLowerCase()).toContain("read-only");
    expect(flags.toLowerCase()).toContain("read-only");
  });
});
