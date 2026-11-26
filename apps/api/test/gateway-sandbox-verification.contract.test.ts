import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const service=readFileSync(
  new URL("../src/payment-providers/sandbox-verification.ts",import.meta.url),
  "utf8");
const migration=readFileSync(
  new URL("../../../packages/db/migrations/0044_gateway_sandbox_verification_observations.sql",
    import.meta.url),"utf8");
const api=readFileSync(
  new URL("../src/payment-providers/routes.ts",import.meta.url),"utf8");
const hubtel=readFileSync(
  new URL("../src/commerce/hubtel-pos-service.ts",import.meta.url),"utf8");
const global=readFileSync(
  new URL("../src/payment-providers/attempts.ts",import.meta.url),"utf8");
describe("sandbox evidence cannot become a receipt",()=>{
  it("keeps the verification service server-only and separate from money posting",()=>{
    expect(service).toContain("unsealTestGatewayKey");
    expect(service).toContain("merchant_connection_revision");
    expect(service).toContain("GATEWAY_VERIFICATION_MISMATCH");
    expect(service).toContain("SANDBOX_PAID");
    expect(service).toContain("posted:false");
    expect(service).not.toContain("UPDATE payments SET status=");
    expect(service).not.toContain("UPDATE sales SET status=");
    expect(service).not.toContain("recordCashbookEntry");
    expect(service).not.toContain("INSERT INTO inventory_movements");
    // The owner-only TEST portal now explicitly exposes verification while
    // preserving the isolated evidence-only service and its DB guards.
    expect(api).toContain("observeSandboxGatewayVerification");
    expect(api).toContain("verify-sandbox");
    expect(api).toContain("GATEWAY_SANDBOX_PORTAL_CHECK_LIMITED");
    expect(api).toContain("requireBusinessRole(pool,auth,req.params.businessId,MANAGE)");
    expect(api).not.toContain("HubtelRefundClient");
  });
  it("enforces immutable tenant payment evidence and cross-provider sale locks",()=>{
    expect(migration).toContain("UNIQUE (attempt_id,observation_kind)");
    expect(migration).toContain("UNIQUE (provider_code,provider_transaction_id)");
    expect(migration).toContain("payment_method IS NOT NULL");
    expect(migration).toContain("environment='TEST'");
    expect(migration).toContain("Sandbox payment evidence is immutable");
    expect(migration).toContain("CREATE TRIGGER hubtel_cross_gateway_attempt_guard");
    expect(migration).toContain("CREATE TRIGGER gateway_cross_hubtel_attempt_guard");
    expect(migration).toContain("FOR UPDATE");
    expect(hubtel).toContain("HUBTEL_POS_EXISTING_GLOBAL_GATEWAY_ATTEMPT");
    expect(global).toContain("GATEWAY_ATTEMPT_EXISTING_HUBTEL");
  });
});
