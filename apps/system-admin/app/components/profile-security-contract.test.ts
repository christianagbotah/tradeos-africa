import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");
const readComponentCss = () => ["admin-components-base.css", "admin-components.css"].map(read).join("\n");

describe("System Admin My Account & Security contract", () => {
  it("adds My account to navigation and resolves its page metadata", () => {
    const nav = read("components/nav.ts");
    expect(nav).toContain('href: "/console/profile"');
    expect(nav).toContain('label: "My account"');
  });

  it("exposes a session-context identity refresh after profile changes", () => {
    const session = read("components/platform-admin-session.tsx");
    expect(session).toContain("refreshAdminUser(): Promise<void>");
    expect(session).toContain("const refreshAdminUser = useCallback");
    expect(session).toContain('/api/admin/session/me');
    expect(session).toContain("refreshAdminUser,");
  });

  it("provides profile, password, and own-session workflows without reflecting secrets", () => {
    const relative = "console/profile/page.tsx";
    expect(fs.existsSync(path.join(appRoot, relative))).toBe(true);
    const page = read(relative);

    for (const endpoint of [
      "/api/admin/profile",
      "/api/admin/profile/password",
      "/api/admin/profile/sessions",
    ]) expect(page).toContain(endpoint);
    expect(page).toContain("refreshAdminUser");
    expect(page).toContain('name="currentPassword"');
    expect(page).toContain('name="newPassword"');
    expect(page).toContain('type="password"');
    expect(page).toContain("Revoke session");
    expect(page).toContain("Loading account security");
    expect(page).toContain("setNotice");
    expect(page).toContain("setError");
    expect(page).not.toMatch(/passwordHash|sessionToken|accessToken|refreshToken/);
    expect(page).not.toMatch(/value=\{[^}]*password/i);
  });

  it("uses shared admin primitives and a narrow-screen profile layout", () => {
    const relative = "console/profile/page.tsx";
    const exists = fs.existsSync(path.join(appRoot, relative));
    expect(exists).toBe(true);
    if (!exists) return;
    const page = read(relative);
    const css = readComponentCss();
    expect(page).toContain("<PageHeader");
    expect(page).toContain("<Section");
    expect(page).toContain("admin-profile-grid");
    expect(page).toContain("admin-security-session");
    expect(css).toContain(".admin-profile-grid");
    expect(css).toContain("@media");
    expect(css).toContain(".admin-security-session");
  });
});
