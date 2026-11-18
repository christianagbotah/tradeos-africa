import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("./hubtel-exception-case-panel.tsx",import.meta.url),"utf8");
const route=readFileSync(new URL("../../../../api/src/commerce/hubtel-pos-routes.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../../../../api/src/commerce/hubtel-exception-review-cases.ts",import.meta.url),"utf8");
describe("Hubtel two-person exception approval safety",()=>{
  it("keeps investigation distinct from executing money or inventory movements",()=>{
    expect(ui).toContain("Settlement investigation approvals");
    expect(ui).toContain("do not issue refunds or reverse accounting entries");
    expect(ui).toContain("No refund, stock or accounting transaction was executed.");
    expect(ui).toContain("separate workflow.");
    expect(service).not.toContain("HubtelRefundClient");
    expect(service).not.toContain("refund_transactions");
    expect(service).not.toContain("recordCashbookEntry");
    expect(service).not.toContain("UPDATE sales SET");
    expect(service).not.toContain("UPDATE payments SET");
  });
  it("separates author from approver and protects all financial routes",()=>{
    expect(route).toContain("listHubtelExceptionReviewCases");
    expect(route).toContain('["OWNER","ADMIN"]');
    expect(route).toContain("submitHubtelExceptionReview");
    expect(route).toContain("decideHubtelExceptionReview");
    expect(service).toContain("HUBTEL_REVIEW_SELF_APPROVAL_FORBIDDEN");
    expect(service).toContain("HUBTEL_REVIEW_REVISION_CONFLICT");
    expect(service).toContain("hubtel_pos_exception_review_events");
    expect(ui).toContain("item.proposedByUserId===account?.id");
  });
  it("supports evidence submission, rejection and mobile review",()=>{
    expect(ui).toContain("Record evidence");
    expect(ui).toContain("Second-person decision");
    expect(ui).toContain("Return for more evidence");
    expect(ui).toContain("PROVIDER_INVESTIGATION");
    expect(ui).toContain("ACCOUNTING_REVIEW");
    const style=readFileSync(new URL("./hubtel-exception-case-panel.module.css",import.meta.url),"utf8");
    expect(style).toContain("@media(max-width:800px)");
  });
});
