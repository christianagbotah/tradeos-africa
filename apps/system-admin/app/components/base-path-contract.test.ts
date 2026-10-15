import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ADMIN_BASE_PATH, withSystemAdminBasePath } from "../lib/system-admin-base-path";

const appRoot = path.resolve(__dirname, "../..");

describe("system-admin public base-path contract", () => {
  it("pins the console to the existing HTTPS origin under /system-admin", () => {
    expect(SYSTEM_ADMIN_BASE_PATH).toBe("/system-admin");
    expect(withSystemAdminBasePath("/api/admin/session/me")).toBe("/system-admin/api/admin/session/me");
    expect(withSystemAdminBasePath("/api/admin/tenants?limit=20")).toBe("/system-admin/api/admin/tenants?limit=20");
    expect(() => withSystemAdminBasePath("api/admin/session/me")).toThrow(/absolute/i);
  });

  it("keeps Next and browser API requests aligned to the same base path", () => {
    const nextConfig = fs.readFileSync(path.join(appRoot, "next.config.ts"), "utf8");
    const session = fs.readFileSync(path.join(appRoot, "app/components/platform-admin-session.tsx"), "utf8");
    expect(nextConfig).toContain('basePath: "/system-admin"');
    expect(nextConfig).not.toContain("async rewrites");
    expect(session).toContain("withSystemAdminBasePath");
    expect(session).not.toMatch(/fetch\("\/api\/admin/);

    const route = fs.readFileSync(path.join(appRoot, "app/api/admin/[...path]/route.ts"), "utf8");
    expect(route).toContain("process.env.API_BASE_URL");
    expect(route).toContain("/api/admin/");
  });
});
