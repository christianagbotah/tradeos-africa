import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(appRoot, relative));

describe("System Admin administrator management contract", () => {
  it("adds platform administrators to Security navigation", () => {
    const nav = read("components/nav.ts");
    expect(nav).toContain('href: "/console/admins"');
    expect(nav).toContain('label: "Administrators"');
  });

  it("loads live administrators and never asks for or renders plaintext credentials", () => {
    expect(exists("console/admins/page.tsx")).toBe(true);
    if (!exists("console/admins/page.tsx")) return;
    const page = read("console/admins/page.tsx");
    expect(page).toContain("/api/admin/admins");
    expect(page).toContain("credentialProvisioned");
    expect(page).toContain("Provisioning required");
    expect(page).toContain("secure provisioning");
    expect(page).not.toMatch(/type="password"|passwordHash|password_hash|generatedPassword|temporaryPassword/);
  });

  it("shows mutation controls only to SUPER_ADMIN and requires reasons for create/role/status changes", () => {
    if (!exists("console/admins/page.tsx")) return;
    const page = read("console/admins/page.tsx");
    expect(page).toContain('adminUser.role === "SUPER_ADMIN"');
    expect(page).toContain('method: "POST"');
    expect(page).toContain('/role`');
    expect(page).toContain('/status`');
    expect(page).toContain("reason");
    expect(page).toContain("window.confirm");
    expect(page).toContain("Reactivate");
    expect(page).toContain("Deactivate");
  });

  it("uses responsive admin cards with loading, error and empty states", () => {
    if (!exists("console/admins/page.tsx")) return;
    const page = read("console/admins/page.tsx");
    const css = ["admin-components-base.css", "admin-components.css"].map(read).join("\n");
    expect(page).toContain("loading");
    expect(page).toContain("error");
    expect(page).toContain("admin-admin-grid");
    expect(page).toContain("admin-admin-card");
    expect(css).toContain(".admin-admin-grid");
    expect(css).toContain(".admin-admin-card");
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*admin-admin-grid/);
  });
});
