import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const ui=readFileSync(new URL("./hubtel-reconciliation-workspace.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("./hubtel-reconciliation-workspace.module.css",import.meta.url),"utf8");
const api=readFileSync(new URL("../../../../api/src/commerce/hubtel-pos-routes.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../../../../api/src/commerce/hubtel-pos-settlement-review.ts",import.meta.url),"utf8");

describe("Hubtel post-settlement review and non-financial safeguards",()=>{
  it("offers manual status checks for paid sales and visible review alerts",()=>{
    expect(ui).toContain('"Recheck settlement"');
    expect(ui).toContain('"settlement-review"');
    expect(ui).toContain("settlementExceptionKind");
    expect(ui).toContain("settlementAlerts");
    expect(ui).toContain("No automatic refund, cashbook reversal or stock movement");
    expect(ui).toContain("once every five minutes");
    expect(css).toContain("repeat(4,minmax(0,1fr))");
  });
  it("restricts merchant review endpoint to owner/admin/manager",()=>{
    expect(api).toContain('"/v1/sales/:saleId/hubtel/settlement-review"');
    expect(api).toContain('["OWNER","ADMIN","MANAGER"]');
    expect(api).toContain("reviewSettledHubtelSale");
  });
  it("reuses original provider account and never initiates a payment/refund",()=>{
    expect(service).toContain("requireHubtelPosConnection(");
    expect(service).toContain("attempt.credential_source");
    expect(service).toContain("attempt.client_reference");
    expect(service).toContain("collectionAccount:config.collectionAccount");
    expect(service).toContain("HUBTEL_POST_SETTLEMENT_CHECK_COOLDOWN");
    expect(service).toContain("original_provider_transaction_id");
    expect(service).not.toContain("refund-api.hubtel.com");
    expect(service).not.toContain("UPDATE payments SET");
    expect(service).not.toContain("UPDATE sales SET");
    expect(service).not.toContain("recordCashbookEntry");
  });
});
