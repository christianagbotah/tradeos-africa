import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentUrl = new URL("./team-invite-acceptance.tsx", import.meta.url);
const pageUrl = new URL("../../invite/team/page.tsx", import.meta.url);

describe("team invitation acceptance security contract", () => {
  it("reads the secret only from the URL fragment and scrubs it immediately", () => {
    const source = readFileSync(componentUrl, "utf8");
    expect(source).toContain("window.location.hash");
    expect(source).toContain("new URLSearchParams");
    expect(source).toContain('hash.replace(/^#/, "")');
    expect(source).toContain("window.history.replaceState");
    expect(source).not.toContain("window.location.search");
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it("supports existing-account and new-account acceptance without putting the token in navigation", () => {
    const source = readFileSync(componentUrl, "utf8");
    expect(source).toContain('"/v1/auth/login"');
    expect(source).toContain('"/v1/staff/invitations/accept"');
    expect(source).toContain('"/v1/staff/invitations/accept/register"');
    expect(source).toContain("acceptanceToken: token");
    expect(source).toContain('router.replace("/dashboard")');
    expect(source).not.toMatch(/router\.(?:push|replace)\([^\n]*token/);
  });

  it("shows a safe missing-secret state after the fragment has been scrubbed", () => {
    const source = readFileSync(componentUrl, "utf8");
    expect(source).toContain("This invitation link is no longer available in this tab");
    expect(source).toContain("Open the original invitation link again");
  });

  it("has a dedicated public route", () => {
    const page = readFileSync(pageUrl, "utf8");
    expect(page).toContain("TeamInviteAcceptance");
  });
});
