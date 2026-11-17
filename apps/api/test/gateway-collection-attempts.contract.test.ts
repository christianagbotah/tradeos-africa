import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const migration=readFileSync(new URL(
  "../../../packages/db/migrations/0043_gateway_collection_attempts.sql",
  import.meta.url),"utf8");
const service=readFileSync(new URL("../src/payment-providers/attempts.ts",import.meta.url),"utf8");
describe("provider-neutral financial fail-closed guard",()=>{
  it("cannot mistake a prepared test attempt for verified money",()=>{
    expect(migration).toContain("environment='TEST'");
    expect(migration).toContain("CHECK(state IN ('PREPARED','CANCELLED','REVIEW_REQUIRED'))");
    expect(migration).toContain("UNIQUE (business_id,sale_id)");
    expect(migration).toContain("UNIQUE (payment_id)");
    expect(migration).toContain("Gateway payment attempt identity is immutable");
    expect(migration).toContain("Gateway attempt event history is append-only");
    expect(service).toContain("No HTTP route exposes this mutation");
    expect(service).toContain("charged:false");
    expect(service).not.toContain("status='SUCCEEDED'");
    expect(service).not.toContain("recordCashbookEntry");
    expect(service).not.toContain("checkoutUrl");
  });
});
