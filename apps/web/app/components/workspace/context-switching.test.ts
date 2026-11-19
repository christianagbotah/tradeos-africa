import { describe, expect, it } from "vitest";
import type { WebSession } from "../../../lib/offline-sync";
import {
  buildBusinessSwitchSession,
  buildBranchSwitchSession,
  mergeConfirmedBranch,
  mergeConfirmedBusiness,
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
