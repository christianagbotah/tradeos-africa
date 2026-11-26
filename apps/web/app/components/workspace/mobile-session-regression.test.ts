import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(join(__dirname, relativePath), "utf8");

describe("mobile workspace entry and recovery safeguards", () => {
  it("retries authoritative business/session access rather than unrelated catalog data", () => {
    const boundary = read("workspace-boundary.tsx");
    expect(boundary).toContain('onClick={() => void refreshWorkspaceContext().catch(() => {');
    expect(boundary).toContain('Workspace provider displays the authoritative error state.');
    expect(boundary).not.toContain("onClick={() => void refreshCatalog()}");
    expect(boundary).toContain("loading={contextBusy}");
  });

  it("clears a prior account session before onboarding a newly authenticated user", () => {
    const entry = read("../public-entry.tsx");
    const anchor = entry.indexOf("const lastContext = offlineQueue.sessions.loadLastContext();");
    expect(anchor).toBeGreaterThan(0);
    const next = entry.slice(anchor, anchor + 800);
    expect(next.indexOf("offlineQueue.sessions.clear();")).toBeLessThan(next.indexOf("const membership = selectMembershipForLogin"));
  });

  it("does not restore a cached business with a token from another user's membership", () => {
    const entry = read("../public-entry.tsx");
    const validate = entry.slice(entry.indexOf("async function validateSession("), entry.indexOf("export function buildSessionFromMembership("));
    expect(validate).toContain("membership.businessId === session.businessId");
    expect(validate).toContain('membership.businessStatus === "ACTIVE"');
    expect(validate).toContain("Boolean(membership.staffId)");
  });
});
