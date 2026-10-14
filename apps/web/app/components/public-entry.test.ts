/**
 * TradeOS Web — public-entry routing logic tests.
 *
 * Verifies the pure routing decision helpers used by <PublicEntry />:
 *   - derivePhase() initial phase machine
 *   - needsOnboarding() membership check
 *   - buildSessionFromMembership() legacy session construction
 *   - buildSessionFromBusinessContext() authoritative branch/session hydration
 *
 * The React component itself is not rendered here; these tests cover the
 * pure decision logic so the routing invariants are locked independently
 * of the DOM.
 */

import { describe, expect, it } from "vitest";
import {
  buildSessionFromBusinessContext,
  buildSessionFromMembership,
  derivePhase,
  needsOnboarding,
  selectMembershipForLogin,
  type AuthSession,
  type BusinessContextResponse,
  type MeResponse,
  type Membership,
  type PublicEntryPhase,
} from "./public-entry";

const VALID_AUTH: AuthSession = {
  accessToken: "tok_abc",
  refreshToken: "ref_abc",
  clientId: "client-1",
};

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: "mem-1",
    businessId: "b-1",
    businessName: "Test Business",
    businessType: "RETAIL_HARDWARE",
    businessStatus: "ACTIVE",
    role: "OWNER",
    staffId: "s-1",
    ...overrides,
  };
}

function makeMe(memberships: Membership[] = [makeMembership()]): MeResponse {
  return {
    user: { id: "u-1", displayName: "Ama", email: "a@b.com", phoneE164: null },
    client: { platform: "WEB", deviceKey: "k", appVersion: "0.0.1" },
    memberships,
  };
}

function makeBusinessContext(overrides: Partial<BusinessContextResponse> = {}): BusinessContextResponse {
  return {
    business: {
      id: "b-1",
      name: "Authoritative Shop",
      businessType: "RETAIL_HARDWARE",
      countryCode: "GH",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
      status: "ACTIVE",
    },
    membership: { role: "OWNER", staffId: "s-1" },
    branches: [
      { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
    ],
    ...overrides,
  };
}

describe("derivePhase", () => {
  it("returns 'loading' before boot completes", () => {
    expect(derivePhase({ booted: false, hasStoredSession: false, validationResult: "pending" })).toBe<PublicEntryPhase>("loading");
    expect(derivePhase({ booted: false, hasStoredSession: true, validationResult: "valid" })).toBe<PublicEntryPhase>("loading");
  });

  it("returns 'auth' when booted with no stored session", () => {
    expect(derivePhase({ booted: true, hasStoredSession: false, validationResult: "pending" })).toBe<PublicEntryPhase>("auth");
  });

  it("returns 'loading' while validating a stored session", () => {
    expect(derivePhase({ booted: true, hasStoredSession: true, validationResult: "pending" })).toBe<PublicEntryPhase>("loading");
  });

  it("returns 'recovery' when a stored session fails validation", () => {
    expect(derivePhase({ booted: true, hasStoredSession: true, validationResult: "invalid" })).toBe<PublicEntryPhase>("recovery");
  });

  it("returns 'loading' when a stored session is valid (component will redirect)", () => {
    expect(derivePhase({ booted: true, hasStoredSession: true, validationResult: "valid" })).toBe<PublicEntryPhase>("loading");
  });

  it("prefers 'auth' over 'recovery' when there is no stored session regardless of validation result", () => {
    expect(derivePhase({ booted: true, hasStoredSession: false, validationResult: "invalid" })).toBe<PublicEntryPhase>("auth");
  });
});

describe("needsOnboarding", () => {
  it("returns true when there are no memberships", () => {
    expect(needsOnboarding(makeMe([]))).toBe(true);
  });

  it("returns true when the first membership has no staffId", () => {
    const me = makeMe([makeMembership({ staffId: null })]);
    expect(needsOnboarding(me)).toBe(true);
  });

  it("returns false when the first membership has a staffId", () => {
    expect(needsOnboarding(makeMe([makeMembership({ staffId: "s-1" })]))).toBe(false);
  });
});

describe("multi-business login selection", () => {
  it("does not force onboarding when a later active membership has a staff actor", () => {
    const me = makeMe([
      makeMembership({ id: "m-stale", businessId: "b-stale", businessStatus: "SUSPENDED", staffId: null }),
      makeMembership({ id: "m-live", businessId: "b-live", businessStatus: "ACTIVE", staffId: "s-live" }),
    ]);
    expect(needsOnboarding(me)).toBe(false);
  });

  it("prefers the last active business when it is still authorized", () => {
    const first = makeMembership({ id: "m-1", businessId: "b-1", staffId: "s-1" });
    const preferred = makeMembership({ id: "m-2", businessId: "b-2", staffId: "s-2" });
    const me = makeMe([first, preferred]);
    expect(selectMembershipForLogin(me, "b-2")?.businessId).toBe("b-2");
  });

  it("falls back to the first usable active membership when the preference is stale", () => {
    const suspended = makeMembership({ id: "m-1", businessId: "b-old", businessStatus: "SUSPENDED", staffId: "s-old" });
    const active = makeMembership({ id: "m-2", businessId: "b-live", businessStatus: "ACTIVE", staffId: "s-live" });
    const me = makeMe([suspended, active]);
    expect(selectMembershipForLogin(me, "missing-business")?.businessId).toBe("b-live");
  });
});

describe("buildSessionFromMembership", () => {
  it("constructs a WebSession with the membership's business and role", () => {
    const m = makeMembership({ businessId: "biz-123", businessName: "Shop", role: "MANAGER" });
    const me = makeMe([m]);
    const session = buildSessionFromMembership(VALID_AUTH, me, m);
    expect(session.accessToken).toBe("tok_abc");
    expect(session.refreshToken).toBe("ref_abc");
    expect(session.clientId).toBe("client-1");
    expect(session.businessId).toBe("biz-123");
    expect(session.businessName).toBe("Shop");
    expect(session.role).toBe("MANAGER");
    expect(session.displayName).toBe("Ama");
  });

  it("falls back to a placeholder staffId when the membership has none", () => {
    const m = makeMembership({ staffId: null });
    const session = buildSessionFromMembership(VALID_AUTH, makeMe([m]), m);
    expect(session.staffId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("never carries undefined optionals (exactOptionalPropertyTypes safety)", () => {
    const session = buildSessionFromMembership(VALID_AUTH, makeMe(), makeMembership());
    const keys = Object.keys(session) as ReadonlyArray<keyof typeof session>;
    for (const key of keys) {
      expect(session[key], `expected ${key} to be defined`).toBeDefined();
    }
  });
});

describe("buildSessionFromBusinessContext", () => {
  it("hydrates branch, currency, timezone, role and staff from authoritative business context", () => {
    const m = makeMembership({ businessId: "b-1", businessName: "Stale Name", role: "CASHIER", staffId: "stale-staff" });
    const context = makeBusinessContext({
      business: {
        id: "b-1",
        name: "Authoritative Shop",
        businessType: "RETAIL_HARDWARE",
        countryCode: "KE",
        currencyCode: "KES",
        timezone: "Africa/Nairobi",
        status: "ACTIVE",
      },
      membership: { role: "MANAGER", staffId: "staff-authoritative" },
      branches: [
        { id: "branch-1", name: "Nairobi", code: "MAIN", timezone: "Africa/Nairobi", active: true },
      ],
    });

    const session = buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context);
    expect(session.businessId).toBe("b-1");
    expect(session.businessName).toBe("Authoritative Shop");
    expect(session.branchId).toBe("branch-1");
    expect(session.currencyCode).toBe("KES");
    expect(session.timezone).toBe("Africa/Nairobi");
    expect(session.role).toBe("MANAGER");
    expect(session.staffId).toBe("staff-authoritative");
    expect(session.branchId).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  it("prefers an active MAIN branch even when another active branch appears first", () => {
    const context = makeBusinessContext({
      branches: [
        { id: "branch-secondary", name: "Airport", code: "AIR", timezone: "Africa/Accra", active: true },
        { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
      ],
    });
    const m = makeMembership();
    const session = buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context);
    expect(session.branchId).toBe("branch-main");
  });

  it("prefers the last active branch over MAIN when one is supplied", () => {
    const context = makeBusinessContext({
      branches: [
        { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
        { id: "branch-tema", name: "Tema", code: "TEMA", timezone: "Africa/Accra", active: true },
      ],
    });
    const m = makeMembership();
    const session = buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context, "branch-tema");
    expect(session.branchId).toBe("branch-tema");
  });

  it("ignores an inactive preferred branch and falls back to active MAIN", () => {
    const context = makeBusinessContext({
      branches: [
        { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
        { id: "branch-old", name: "Old", code: "OLD", timezone: "Africa/Accra", active: false },
      ],
    });
    const m = makeMembership();
    const session = buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context, "branch-old");
    expect(session.branchId).toBe("branch-main");
  });

  it("falls back to the first active branch when MAIN is inactive", () => {
    const context = makeBusinessContext({
      branches: [
        { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: false },
        { id: "branch-secondary", name: "Tema", code: "TEMA", timezone: "Africa/Accra", active: true },
      ],
    });
    const m = makeMembership();
    const session = buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context);
    expect(session.branchId).toBe("branch-secondary");
  });

  it("fails closed when the business has no active branch", () => {
    const context = makeBusinessContext({
      branches: [
        { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: false },
      ],
    });
    const m = makeMembership();
    expect(() => buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context)).toThrow(/NO_ACTIVE_BRANCH/);
  });

  it("rejects business context for a different business", () => {
    const m = makeMembership({ businessId: "b-1" });
    const context = makeBusinessContext({
      business: {
        id: "b-2",
        name: "Wrong Business",
        businessType: "RETAIL_HARDWARE",
        countryCode: "GH",
        currencyCode: "GHS",
        timezone: "Africa/Accra",
        status: "ACTIVE",
      },
    });
    expect(() => buildSessionFromBusinessContext(VALID_AUTH, makeMe([m]), m, context)).toThrow(/BUSINESS_CONTEXT_MISMATCH/);
  });
});
