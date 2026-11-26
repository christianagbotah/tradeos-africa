import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const pos=readFileSync(
  new URL("../src/commerce/hubtel-pos-config.ts",import.meta.url),"utf8");
const service=readFileSync(
  new URL("../src/commerce/hubtel-pos-service.ts",import.meta.url),"utf8");
const readiness=readFileSync(
  new URL("../src/payment-providers/hubtel-activation-readiness.ts",import.meta.url),
  "utf8");
const routes=readFileSync(
  new URL("../src/payment-providers/routes.ts",import.meta.url),"utf8");
const migration=readFileSync(
  new URL("../../../packages/db/migrations/0047_hubtel_checkout_credential_provenance.sql",
    import.meta.url),"utf8");
const prior=readFileSync(
  new URL("../../../packages/db/migrations/0046_merchant_gateway_self_service.sql",
    import.meta.url),"utf8");

describe("Hubtel merchant POS preflight fail-closed invariants",()=>{
  it("requires platform account approval, private flag and explicit DB authorization",()=>{
    expect(pos).toContain('TRADEOS_HUBTEL_MERCHANT_POS_ENABLED==="true"');
    expect(pos).toContain("record.collection_enabled");
    expect(pos).toContain('record.status==="VERIFIED"');
    expect(pos).toContain("record.account_reference===row.collection_account");
    expect(pos).toContain('credentialSource:"PLATFORM_ALIAS"');
    expect(pos).toContain('credentialSource:"MERCHANT_VAULT"');
    expect(prior).toContain("collection_enabled=false");
    expect(migration).toContain("c.collection_enabled=true");
    expect(migration).toContain("Hubtel payment credential provenance cannot be changed");
  });
  it("keeps the user checklist read-only and prevents payment-method misposting",()=>{
    expect(readiness).toContain("getHubtelMerchantActivationReadiness");
    expect(readiness).not.toContain("unsealMerchantGatewayCredentials");
    expect(readiness).not.toContain("INSERT INTO");
    expect(readiness).not.toContain("UPDATE payments");
    expect(routes).toContain("/payment-gateways/HUBTEL/activation-readiness");
    expect(service).toContain("attempt.credential_source");
    expect(service).toContain("method:verified.paymentMethod");
    expect(service).not.toContain('currencyCode:"GHS",method:"MOMO",');
  });
});
