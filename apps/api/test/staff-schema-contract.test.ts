import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../packages/db/migrations/0017_staff_management.sql", import.meta.url);
const contractUrl = new URL("../../../packages/contracts/src/staff.ts", import.meta.url);
const indexUrl = new URL("../../../packages/contracts/src/index.ts", import.meta.url);

describe("staff access schema and contracts", () => {
  it("adds constrained staff invitations without persisting raw invitation secrets", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("ALTER TABLE staff");
    expect(sql).toContain("updated_at timestamptz NOT NULL DEFAULT now()");
    expect(sql).toContain("CREATE TABLE staff_invitations");
    expect(sql).toContain("token_hash char(64) NOT NULL UNIQUE");
    expect(sql).toContain("CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'))");
    expect(sql).toContain("CREATE UNIQUE INDEX uq_staff_invitations_live_pending");
    expect(sql).toContain("WHERE status='PENDING'");
    expect(sql).toMatch(/CHECK\s*\(invited_email IS NOT NULL OR invited_phone_e164 IS NOT NULL\)/);
    expect(sql).not.toMatch(/\b(?:raw_)?token\s+text\b/i);
    expect(sql).not.toMatch(/acceptance_token\s+text/i);
  });

  it("publishes canonical staff roles, invitation statuses and DTOs", async () => {
    const contract = await readFile(contractUrl, "utf8");
    const index = await readFile(indexUrl, "utf8");
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"]) {
      expect(contract).toContain(`\"${role}\"`);
    }
    for (const status of ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]) {
      expect(contract).toContain(`\"${status}\"`);
    }
    expect(contract).toContain("export interface StaffDirectoryItem");
    expect(contract).toContain("export interface CreateStaffRequest");
    expect(contract).toContain("export interface UpdateStaffRequest");
    expect(contract).toContain("export interface StaffInvitationResponse");
    expect(contract).not.toContain("tokenHash:");
    expect(index).toContain('export * from "./staff.js"');
  });
});
