import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const adminPage=readFileSync(
  new URL("../console/hubtel-merchant-accounts/page.tsx",import.meta.url),
  "utf8");
const nav=readFileSync(new URL("./nav.ts",import.meta.url),"utf8");
const overview=readFileSync(
  new URL("../console/page.tsx",import.meta.url),"utf8");

describe("platform Hubtel beneficiary review UI",()=>{
  it("makes authenticated review queue discoverable and protects decisions",()=>{
    expect(nav).toContain('/console/hubtel-merchant-accounts');
    expect(overview).toContain('/console/hubtel-merchant-accounts');
    expect(adminPage).toContain("usePlatformAdminSession");
    expect(adminPage).toContain("useAdminResource");
    expect(adminPage).toContain("expectedCredentialRevision");
    expect(adminPage).toContain("expectedReviewVersion");
    expect(adminPage).toContain("beneficiaryOwnershipConfirmed");
    expect(adminPage).toContain('adminUser?.role==="SUPER_ADMIN"');
    expect(adminPage).toContain('adminUser?.role==="PLATFORM_ADMIN"');
    expect(adminPage).toContain('role="alert"');
    expect(adminPage).toContain("Record approval (no charging)");
    expect(adminPage).toContain("Record rejection");
    expect(adminPage).toContain("window.confirm");
    expect(adminPage).toContain("live collections");
  });
  it("does not ask for or render provider API secrets",()=>{
    expect(adminPage).not.toContain("apiSecret");
    expect(adminPage).not.toContain("apiKey");
    expect(adminPage).not.toContain("encrypted_credentials");
  });
});
