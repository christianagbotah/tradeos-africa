import { describe, expect, it } from "vitest";
import type { WebSession } from "../../../lib/offline-sync";
import {
  buildBusinessSwitchSession,
  buildBranchSwitchSession,
  mergeConfirmedBranch,
  mergeConfirmedBusiness,
  reconcileConfirmedBranchContext,
  reconcileConfirmedBusinessContext,
  type WorkspaceBusinessContext,
  type WorkspaceMembership,
} from "./workspace-provider";

const CURRENT: WebSession = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  clientId: "client-1",
  businessId: "business-a",
  branchId: "branch-a",
  staffId: "staff-a",
  currencyCode: "GHS",
  timezone: "Africa/Accra",
  businessName: "Business A",
  role: "OWNER",
  displayName: "Ama Owner",
};

function membership(overrides: Partial<WorkspaceMembership> = {}): WorkspaceMembership {
  return {
    id: "membership-b",
    businessId: "business-b",
    businessName: "Business B",
    businessType: "SERVICES",
    businessStatus: "ACTIVE",
    role: "MANAGER",
    staffId: "staff-b",
    ...overrides,
  };
}

function context(overrides: Partial<WorkspaceBusinessContext> = {}): WorkspaceBusinessContext {
  return {
    business: {
      id: "business-b",
      name: "Business B Authoritative",
      legalName: null,
      businessType: "SERVICES",
      email: null,
      phone: null,
      registrationNumber: null,
      taxId: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: "GH",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
      logoUrl: null,
      status: "ACTIVE",
    },
    membership: { role: "MANAGER", staffId: "staff-b" },
    branches: [
      {
        id: "branch-main-b",
        name: "Main",
        code: "MAIN",
        timezone: "Africa/Accra",
        email: null,
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        region: null,
        postalCode: null,
        active: true,
        updatedAt: "2026-10-13T12:00:00.000Z",
      },
      {
        id: "branch-tema-b",
        name: "Tema",
        code: "TEMA",
        timezone: "Africa/Accra",
        email: null,
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: "Tema",
        region: "Greater Accra",
        postalCode: null,
        active: true,
        updatedAt: "2026-10-13T12:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("workspace business switching", () => {
  it("hydrates a switched session only from authoritative membership/context data", () => {
    const next = buildBusinessSwitchSession(CURRENT, membership(), context(), "branch-tema-b");
    expect(next).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      clientId: "client-1",
      businessId: "business-b",
      branchId: "branch-tema-b",
      staffId: "staff-b",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
      businessName: "Business B Authoritative",
      role: "MANAGER",
      displayName: "Ama Owner",
    });
  });

  it("rejects cross-business context and unusable memberships", () => {
    expect(() => buildBusinessSwitchSession(
      CURRENT,
      membership({ businessId: "business-b" }),
      context({ business: { ...context().business, id: "business-c" } }),
    )).toThrow("BUSINESS_CONTEXT_MISMATCH");

    expect(() => buildBusinessSwitchSession(
      CURRENT,
      membership({ businessStatus: "SUSPENDED" }),
      context(),
    )).toThrow("BUSINESS_MEMBERSHIP_INACTIVE");

    expect(() => buildBusinessSwitchSession(
      CURRENT,
      membership({ staffId: null }),
      context({ membership: { role: "MANAGER", staffId: null } }),
    )).toThrow("NO_ACTIVE_STAFF");
  });

  it("falls back from an inactive preferred branch to MAIN", () => {
    const ctx = context({
      branches: context().branches.map((branch) => (
        branch.id === "branch-tema-b" ? { ...branch, active: false } : branch
      )),
    });
    expect(buildBusinessSwitchSession(CURRENT, membership(), ctx, "branch-tema-b").branchId).toBe("branch-main-b");
  });
});

describe("workspace branch switching", () => {
  it("switches only to an active branch in the current business context", () => {
    const businessBSession = buildBusinessSwitchSession(CURRENT, membership(), context());
    const next = buildBranchSwitchSession(businessBSession, context(), "branch-tema-b");
    expect(next.branchId).toBe("branch-tema-b");
    expect(next.timezone).toBe("Africa/Accra");
    expect(next.businessId).toBe("business-b");
  });

  it("rejects inactive, missing, and cross-business branch context", () => {
    const businessBSession = buildBusinessSwitchSession(CURRENT, membership(), context());
    const inactive = context({
      branches: context().branches.map((branch) => (
        branch.id === "branch-tema-b" ? { ...branch, active: false } : branch
      )),
    });
    expect(() => buildBranchSwitchSession(businessBSession, inactive, "branch-tema-b")).toThrow("BRANCH_NOT_ACTIVE");
    expect(() => buildBranchSwitchSession(businessBSession, context(), "missing")).toThrow("BRANCH_NOT_ACTIVE");
    expect(() => buildBranchSwitchSession(CURRENT, context(), "branch-main-b")).toThrow("BUSINESS_CONTEXT_MISMATCH");
  });
});

describe("confirmed CRUD updates shared business and branch views", () => {
  it("replaces a renamed branch immediately without losing other branches", () => {
    const before = context();
    const renamed = { ...before.branches[1]!, name: "Tema East Branch",
      updatedAt: "2026-11-19T08:55:00.000Z" };
    const after = mergeConfirmedBranch(before, "business-b", renamed);
    expect(after?.branches.find((b) => b.id === renamed.id)?.name).toBe("Tema East Branch");
    expect(after?.branches[0]).toEqual(before.branches[0]);
    expect(before.branches[1]?.name).toBe("Tema");
  });
  it("adds a newly created branch and retains tenant isolation", () => {
    const before = context();
    const newBranch = { ...before.branches[0]!, id: "branch-takoradi", name: "Takoradi" };
    expect(mergeConfirmedBranch(before, "business-b", newBranch)?.branches).toHaveLength(3);
    expect(mergeConfirmedBranch(before, "another-business", newBranch)).toBe(before);
    expect(mergeConfirmedBranch(null, "business-b", newBranch)).toBeNull();
  });
  it("updates active flags and business names only within the current business", () => {
    const before = context();
    const deactivated = { ...before.branches[1]!, active: false };
    expect(mergeConfirmedBranch(before, "business-b", deactivated)?.branches[1]?.active).toBe(false);
    const renamed = { ...before.business, name: "Business B New Name" };
    expect(mergeConfirmedBusiness(before, renamed)?.business.name).toBe("Business B New Name");
    expect(mergeConfirmedBusiness(before, { ...renamed, id: "business-a" })).toBe(before);
  });
});

describe("server-confirmed CRUD may not be rolled back by stale context GET", () => {
  const now = Date.parse("2026-11-19T09:40:00.000Z");
  it("preserves a committed branch rename when GET returns an old name and revision", () => {
    const before = context();
    const confirmed = { ...before.branches[0]!,
      name: "Main — Updated", updatedAt: "2026-11-19T09:39:55.000Z" };
    const revisions = new Map([[before.business.id + ":" + confirmed.id,
      { branch: confirmed, confirmedAt: now }]]);
    const stale = reconcileConfirmedBranchContext(before, revisions, now + 500);
    expect(stale.branches[0]?.name).toBe("Main — Updated");
    expect(revisions.size).toBe(1);
    expect(before.branches[0]?.name).toBe("Main");
  });
  it("releases the guard only after the server catches up or returns a newer revision", () => {
    const before = context();
    const committed = { ...before.branches[1]!, name: "Tema Updated",
      updatedAt: "2026-11-19T09:39:55.000Z" };
    const key = before.business.id + ":" + committed.id;
    const revisions = new Map([[key, { branch: committed, confirmedAt: now }]]);
    const caughtUp = context({ branches: [before.branches[0]!, committed] });
    expect(reconcileConfirmedBranchContext(caughtUp, revisions, now + 800))
      .toBe(caughtUp);
    expect(revisions.size).toBe(0);
    const differentNewer = { ...committed, name: "Other manager changed it",
      updatedAt: "2026-11-19T09:40:20.000Z" };
    revisions.set(key, { branch: committed, confirmedAt: now });
    const newer = context({ branches: [before.branches[0]!, differentNewer] });
    expect(reconcileConfirmedBranchContext(newer, revisions, now + 22000)
      .branches[1]?.name).toBe("Other manager changed it");
    expect(revisions.size).toBe(0);
  });
  it("does not leak any confirmed branch into a different tenant", () => {
    const before = context();
    const committed = { ...before.branches[0]!, name: "Main Updated",
      updatedAt: "2026-11-19T09:39:55.000Z" };
    const revisions = new Map([[before.business.id + ":" + committed.id,
      { branch: committed, confirmedAt: now }]]);
    const otherBusiness = context({ business: { ...before.business, id: "another-business" } });
    expect(reconcileConfirmedBranchContext(otherBusiness, revisions, now + 1000))
      .toBe(otherBusiness);
  });
  it("preserves a newly created branch missing from a temporarily stale list", () => {
    const before = context();
    const created = { ...before.branches[0]!, id: "branch-new",
      name: "New Branch", updatedAt: "2026-11-19T09:39:55.000Z" };
    const revisions = new Map([[before.business.id + ":" + created.id,
      { branch: created, confirmedAt: now }]]);
    const out = reconcileConfirmedBranchContext(before, revisions, now + 200);
    expect(out.branches.map(b => b.name)).toContain("New Branch");
    const expired = reconcileConfirmedBranchContext(before, revisions, now + 150000);
    expect(expired.branches.map(b => b.name)).not.toContain("New Branch");
  });
});

describe("server-confirmed business profile is not replaced by a stale context", () => {
  it("keeps the confirmed trading name and releases when the server catches up", () => {
    const before = context();
    const now = Date.parse("2026-11-19T09:40:00Z");
    const confirmed = { ...before.business, name: "Updated Retail" };
    const revisions = new Map([[before.business.id, { business: confirmed, confirmedAt: now }]]);
    const stale = reconcileConfirmedBusinessContext(before, revisions, now + 1000);
    expect(stale.business.name).toBe("Updated Retail");
    expect(before.business.name).toBe("Business B Authoritative");
    const fresh = context({ business: confirmed });
    expect(reconcileConfirmedBusinessContext(fresh, revisions, now + 3000)).toBe(fresh);
    expect(revisions.size).toBe(0);
  });
});
