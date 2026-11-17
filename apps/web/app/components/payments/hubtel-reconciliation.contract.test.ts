import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const monitor=readFileSync(
  new URL("./hubtel-reconciliation-workspace.tsx",import.meta.url),"utf8");
const actions=readFileSync(
  new URL("../sales/hubtel-sale-actions.tsx",import.meta.url),"utf8");

describe("Hubtel provider switch UI safety",()=>{
  it("separates existing Hubtel reconciliation from new-checkout eligibility",()=>{
    expect(monitor).toContain("existingCheckoutEnabled");
    expect(monitor).toContain("readiness?.existingCheckoutEnabled");
    expect(monitor).toContain("Switching to another provider prevents new Hubtel checkouts");
    expect(monitor).toContain("Hubtel collection is not enabled");
    expect(monitor).not.toContain("disabled={!readiness?.enabled");
  });
  it("permits original-provider verification but refuses to reopen a switched-away payment link",()=>{
    expect(actions).toContain("readiness?.enabled && (!checkout ||");
    expect(actions).toContain("readiness?.existingCheckoutEnabled && checkout");
    expect(actions).toContain('"REVIEW_REQUIRED"');
    expect(actions).toContain("Verify payment");
  });
});
