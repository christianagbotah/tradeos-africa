import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const service=readFileSync(
  new URL("../src/platform-admin/hubtel-merchant-reviews.ts",import.meta.url),"utf8");
const schema=readFileSync(
  new URL("../../../packages/db/migrations/0048_hubtel_merchant_account_reviews.sql",
    import.meta.url),"utf8");
const merchant=readFileSync(
  new URL("../src/payment-providers/hubtel-activation-readiness.ts",import.meta.url),
  "utf8");
const routes=readFileSync(
  new URL("../src/platform-admin/routes.ts",import.meta.url),"utf8");

describe("Hubtel platform beneficiary review authorization boundaries",()=>{
  it("cannot allow collection to start from an ownership review",()=>{
    expect(schema).toContain("business_merchant_gateway_credentials");
    expect(schema).toContain("c.collection_enabled=false");
    expect(schema).toContain("b.status='ACTIVE'");
    expect(schema).toContain("hubtel_merchant_review_events_immutable");
    expect(service).toContain('collectionEnabled:false');
    expect(service).not.toContain("UPDATE business_hubtel_sales_accounts");
    expect(service).not.toContain("UPDATE payments");
    expect(service).not.toContain("UPDATE sales");
    expect(service).not.toContain("INSERT INTO cashbook_entries");
    expect(service).not.toContain("collection_enabled=true");
  });
  it("requires privileged platform identity and a review of the exact key revision",()=>{
    expect(service).toContain('"SUPER_ADMIN"');
    expect(service).toContain('"PLATFORM_ADMIN"');
    expect(service).toContain("ADMIN_HUBTEL_BENEFICIARY_NOT_CONFIRMED");
    expect(service).toContain("ADMIN_HUBTEL_REVIEW_STALE");
    expect(service).toContain("current.credential_revision!==args.expectedCredentialRevision");
    expect(merchant).toContain("review.rows[0].credential_revision===saved?.revision");
    expect(merchant).toContain("ownershipApproved");
    expect(routes).toContain("/api/admin/payments/hubtel/merchant-accounts");
    expect(routes).toContain("readAdminCookie");
  });
});
