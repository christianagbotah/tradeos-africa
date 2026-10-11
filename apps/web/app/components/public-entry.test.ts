/**
 * TradeOS Web — public-entry routing logic tests.
 *
 * Verifies the pure routing decision helpers used by <PublicEntry />:
 *   - derivePhase() initial phase machine
 *   - needsOnboarding() membership check
 *   - buildSessionFromMembership() session construction
 *
 * The React component itself is not rendered here; these tests cover the
 * pure decision logic so the routing invariants are locked independently
 * of the DOM.
 */

import { describe, expect, it } from "vitest";
import {
  buildSessionFromMembership,
  derivePhase,
  needsOnboarding,
  type AuthSession,
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
