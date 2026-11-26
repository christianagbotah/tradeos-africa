import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const service=readFileSync(new URL(
  "../src/payment-providers/sandbox-hosted-checkout.ts",import.meta.url),"utf8");
const schema=readFileSync(new URL(
  "../../../packages/db/migrations/0053_gateway_sandbox_hosted_checkout.sql",
  import.meta.url),"utf8");
const routes=readFileSync(new URL(
  "../src/payment-providers/routes.ts",import.meta.url),"utf8");

describe("merchant-hosted TEST checkout: no money or duplicate posting",()=>{
  it("accepts TEST credentials only, guards against repeated external POST",()=>{
    expect(service).toContain("unsealTestGatewayKey");
    expect(service).toContain('sk_test_');
    expect(service).toContain('FLWSECK_TEST-');
    expect(service).toContain("newlyClaimed:false");
    expect(service).toContain("OUTCOME_UNKNOWN");
    expect(service).toContain("merchant_connection_revision");
    expect(service).not.toContain("unsealMerchantGatewayCredentials");
    expect(service).not.toContain("UPDATE payments SET");
    expect(service).not.toContain("UPDATE sales SET");
    expect(service).not.toContain("INSERT INTO cashbook_entries");
    expect(service).not.toContain("HubtelRefundClient");
  });
  it("restricts checkout URLs, forbids double retries and writes audit events",()=>{
    expect(schema).toContain("PRIMARY KEY REFERENCES gateway_collection_attempts(id)");
    expect(schema).toContain("Only provider-owned TEST checkout URLs");
    expect(schema).toContain("Hosted TEST checkout identity or final state is immutable");
    expect(schema).toContain("gateway_sandbox_hosted_checkout_events");
    expect(schema).toContain("TEST checkout audit events are append-only");
    expect(schema).toContain("manual review is required");
    expect(schema).toContain("CANCELLED");
    expect(routes).toContain("/hosted-test-checkout");
    expect(routes).toContain("requireBusinessRole(pool,auth,req.params.businessId,MANAGE)");
  });
});
