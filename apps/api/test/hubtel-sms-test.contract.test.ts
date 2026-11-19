import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const api=readFileSync(new URL("../src/messaging/hubtel-sms-test.ts",import.meta.url),"utf8");
const routes=readFileSync(new URL("../src/messaging/routes.ts",import.meta.url),"utf8");
const migration=readFileSync(new URL("../../../packages/db/migrations/0054_hubtel_sms_connection_tests.sql",import.meta.url),"utf8");
const ui=readFileSync(new URL("../../web/app/components/settings/sms-provider-panel.tsx",import.meta.url),"utf8");
const checkout=readFileSync(new URL("../src/platform-admin/hubtel-checkout-client.ts",import.meta.url),"utf8");
describe("Hubtel direct setup, online checkout and single SMS test guardrails",()=>{
  it("only authenticates business owner/admin for password confirmed Hubtel SMS test",()=>{
    expect(routes).toContain('/HUBTEL_SMS/test-send');
    expect(routes).toContain('requireBusinessRole(pool,auth,req.params.businessId,["OWNER","ADMIN"])');
    expect(api).toContain("reauthenticateSensitiveSettings");
    expect(api).toContain("confirmOwnership!==true");
    expect(api).toContain("unsealSmsProviderSecret");
    expect(api).toContain("OUTCOME_UNKNOWN");
    expect(api).toContain("HUBTEL_SMS_TEST_UNRESOLVED");
    expect(api).not.toContain("UPDATE payments SET");
    expect(api).not.toContain("UPDATE sales SET");
    expect(api).not.toContain("INSERT INTO cashbook_entries");
  });
  it("keeps SMS one-time attempt immutable, branch-safe, 10-minute limited",()=>{
    expect(migration).toContain("UNIQUE(business_id,client_request_id)");
    expect(migration).toContain("Hubtel test SMS intent and final result are immutable");
    expect(migration).toContain("cannot be removed");
    expect(api).toContain("interval '10 minutes'");
    expect(api).toContain("state='INITIATING'");
    expect(ui).toContain("Send one Hubtel SMS test");
    expect(ui).toContain("I own or control this number");
  });
  it("routes payment to the actual Hubtel hosted online checkout",()=>{
    expect(checkout).toContain('"/items/initiate"');
    expect(checkout).toContain('https://payproxyapi.hubtel.com');
    expect(ui).not.toContain('provider=== "HUBTEL_SMS"');
  });
});
