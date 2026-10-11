import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");

describe("system-admin no-fake-data contract", () => {
  const pages = ["console/page.tsx", "console/tenants/page.tsx", "console/devices/page.tsx", "console/audit/page.tsx", "console/releases/page.tsx", "console/flags/page.tsx"];

  for (const page of pages) {
    it(`${page} does not present fake management actions as successful`, () => {
      const src = fs.readFileSync(path.join(appRoot, page), "utf8");
      // Must NOT contain simulated success states
      expect(src).not.toContain("onSuccess");
      expect(src).not.toContain("mutation succeeded");
      // Must contain honest pending/empty state language
      expect(src.toLowerCase()).toMatch(/pending|backend|coming|not yet|unavailable|empty/);
    });
  }

  it("admin pages do not fabricate tenant/device/audit data", () => {
    for (const page of pages) {
      const src = fs.readFileSync(path.join(appRoot, page), "utf8");
      // Should not have hardcoded data arrays that look like real tenant records
      expect(src).not.toMatch(/\{[^}]*tenantId[^}]*name:\s*"[A-Z]/);
      expect(src).not.toMatch(/\{[^}]*deviceId[^}]*name:\s*"[A-Z]/);
    }
  });
});
