import { describe, expect, it } from "vitest";
import { getPublicEntryMode } from "./public-entry";
import type { MePayload } from "../lib/workspace-types";

const configuredSession: MePayload = {
  user: { id: "user-1", displayName: "Demo Owner", email: "owner@example.com", phoneE164: null },
  client: { platform: "WEB", deviceKey: "browser-1", appVersion: "test" },
  memberships: [{
    id: "membership-1",
    businessId: "business-1",
    businessName: "Demo Business",
    businessType: "DISTRIBUTION",
    businessStatus: "ACTIVE",
    role: "OWNER",
    staffId: "staff-1",
  }],
};

describe("PublicEntry routing", () => {
  it("redirects_configured_session_to_dashboard", () => {
    expect(getPublicEntryMode({ resolved: false, session: configuredSession, workspaceReady: false, error: null })).toEqual({ kind: "loading" });
    expect(getPublicEntryMode({ resolved: true, session: configuredSession, workspaceReady: false, error: null })).toEqual({ kind: "loading" });
    expect(getPublicEntryMode({ resolved: true, session: configuredSession, workspaceReady: true, error: null })).toEqual({ kind: "redirect", href: "/dashboard" });
  });

  it("keeps_unauthenticated_user_on_public_auth", () => {
    expect(getPublicEntryMode({ resolved: true, session: null, workspaceReady: false, error: null })).toEqual({ kind: "auth" });
  });

  it("keeps_member_without_business_context_in_onboarding", () => {
    const session: MePayload = { ...configuredSession, memberships: [] };
    expect(getPublicEntryMode({ resolved: true, session, workspaceReady: false, error: null })).toEqual({ kind: "onboarding" });
  });

  it("shows a recoverable workspace error instead of an infinite loading screen", () => {
    expect(getPublicEntryMode({ resolved: true, session: configuredSession, workspaceReady: false, error: "Business context unavailable" })).toEqual({ kind: "error" });
  });
});
