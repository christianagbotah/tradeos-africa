import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("System Admin Tenant 360 contract", () => {
  it("makes tenant rows keyboard/click navigable to the dedicated detail route", () => {
    const page = read("console/tenants/page.tsx");
    expect(page).toContain('useRouter');
    expect(page).toContain('onRowClick');
    expect(page).toContain('router.push(`/console/tenants/${tenant.id}`)');
    expect(page).not.toContain("Tenant mutation and support impersonation remain unavailable in the read-plane release.");
  });

  it("loads the authoritative tenant overview and renders all seven sections", () => {
    const relative = "console/tenants/[id]/page.tsx";
    expect(fs.existsSync(path.join(appRoot, relative))).toBe(true);
    if (!fs.existsSync(path.join(appRoot, relative))) return;
    const page = read(relative);
    expect(page).toContain('/api/admin/tenants/${encodeURIComponent(tenantId)}/overview');
    for (const label of [
      "Overview",
      "Branches & access",
      "Subscription & entitlements",
      "Billing",
      "Devices & sync",
      "Platform activity",
      "AI insights",
    ]) expect(page).toContain(label);
    expect(page).toContain("tenant.branches");
    expect(page).toContain("tenant.access.roles");
    expect(page).toContain("tenant.contacts");
    expect(page).toContain("tenant.subscription");
    expect(page).toContain("tenant.devices");
    expect(page).toContain("tenant.recentActivity");
    expect(page).toContain("tenant.billing.available");
  });

  it("uses a reasoned, stale-write-protected lifecycle form and authoritative reload", () => {
    const relative = "console/tenants/[id]/page.tsx";
    const exists = fs.existsSync(path.join(appRoot, relative));
    expect(exists).toBe(true);
    if (!exists) return;
    const page = read(relative);
    expect(page).toContain('/api/admin/tenants/${encodeURIComponent(tenantId)}/status');
    expect(page).toContain('name="reason"');
    expect(page).toContain("required");
    expect(page).toContain("expectedUpdatedAt: tenant.updatedAt");
    expect(page).toContain("await reload()");
    expect(page).toContain('new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "OPERATIONS"])');
    expect(page).not.toMatch(/impersonat(e|ion).*fetch|\/api\/admin\/imperson/i);
  });

  it("uses progressive disclosure and responsive Tenant 360 styling", () => {
    const relative = "console/tenants/[id]/page.tsx";
    const exists = fs.existsSync(path.join(appRoot, relative));
    expect(exists).toBe(true);
    if (!exists) return;
    const page = read(relative);
    const css = read("admin-components.css");
    expect(page).toContain("admin-tenant-hero");
    expect(page).toContain("admin-tenant-section-nav");
    expect(page).toContain("admin-tenant-grid");
    expect(page).toContain("admin-tenant-lifecycle");
    expect(css).toContain(".admin-tenant-hero");
    expect(css).toContain(".admin-tenant-grid");
    expect(css).toContain(".admin-tenant-lifecycle");
    expect(css).toContain("@media");
  });
});
