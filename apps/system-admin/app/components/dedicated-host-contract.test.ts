import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(appRoot, "../..");

describe("system-admin dedicated-host contract", () => {
  it("keeps the Next app root-mounted for tradeosadmin.lightworldtech.com", () => {
    const nextConfig = fs.readFileSync(path.join(appRoot, "next.config.ts"), "utf8");
    const session = fs.readFileSync(path.join(appRoot, "app/components/platform-admin-session.tsx"), "utf8");
    expect(nextConfig).not.toContain("basePath:");
    expect(nextConfig).not.toContain("async rewrites");
    expect(session).not.toContain("withSystemAdminBasePath");
    expect(session).toContain('fetch("/api/admin/session/me"');
    expect(session).toContain('fetch("/api/admin/session/login"');
    expect(session).toContain('fetch("/api/admin/session/logout"');
    const route = fs.readFileSync(path.join(appRoot, "app/api/admin/[...path]/route.ts"), "utf8");
    expect(route).toContain("process.env.API_BASE_URL");
  });

  it("tracks a Webuzo include that proxies the dedicated host root only to localhost:3038", () => {
    const nginx = fs.readFileSync(path.join(repoRoot, "ops/lightworld-vps/nginx/tradeos-system-admin.location.conf"), "utf8");
    expect(nginx).toMatch(/location \^~ \/\s*\{/);
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3038;");
    expect(nginx).toContain('X-Robots-Tag "noindex, nofollow, nosnippet" always');
    expect(nginx).toContain("proxy_hide_header Cache-Control;");
    expect(nginx).toContain('Cache-Control "no-store, no-cache, must-revalidate" always');
    expect(nginx).not.toMatch(/system-admin/);
    expect(nginx).not.toMatch(/\blisten\b|ssl_certificate|server_name/);
  });
});
