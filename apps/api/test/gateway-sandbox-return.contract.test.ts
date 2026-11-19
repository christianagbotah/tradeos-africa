import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const code=readFileSync(new URL(
  "../src/payment-providers/sandbox-hosted-checkout.ts",import.meta.url),"utf8");
const page=readFileSync(new URL(
  "../../web/app/gateway-test-return/page.tsx",import.meta.url),"utf8");
describe("provider TEST hosted checkout return",()=>{
  it("pins the return to the TradeOS origin and immutable attempt and reference",()=>{
    expect(code).toContain("/gateway-test-return");
    expect(code).toContain('url.searchParams.set("attempt",attempt.id)');
    expect(code).toContain('url.searchParams.set("expected_ref",attempt.client_reference)');
    expect(code).toContain("returnUrl:url.toString()");
    expect(page).toContain("not confirmation of payment");
    expect(page).not.toContain("authenticatedFetch");
  });
});
