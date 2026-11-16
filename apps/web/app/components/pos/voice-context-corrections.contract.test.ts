import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const source=(path:string)=>readFileSync(
  fileURLToPath(new URL(path,import.meta.url)),"utf8");
const voice=source("./voice-sale-assistant.tsx");
const pos=source("./pos-workspace.tsx");
const parser=source("../../../lib/voice-context-corrections.ts");
const checkout=source("./checkout-sheet.tsx");
describe("customer and payment voice amendments are review-only",()=>{
  it("uses only active customer matches and explicit operator selection",()=>{
    expect(voice).toContain("rankVoiceCustomerCandidates");
    expect(voice).toContain("customers.filter(c=>c.active)");
    expect(voice).toContain("Select an existing active customer before confirming");
    expect(voice).toContain("setCustomerId(selected.id)");
    expect(voice).toContain("setCustomerId(\"\")");
    expect(voice).toContain("Choose the existing customer (required)");
    expect(parser).toContain("return customers.map(customer=>");
  });
  it("requires confirmation and re-review for a changed payment method",()=>{
    expect(voice).toContain("Confirm customer/payment correction");
    expect(voice).toContain("setPaymentMethod(contextCorrection.method)");
    expect(voice).toContain("setReviewed(false)");
    expect(voice).toContain("contextSnapshot!==snapshot()");
    expect(voice).toContain("Boolean(contextCorrection)");
    expect(voice).toContain("Credit sales require an active, linked customer");
    expect(voice).toContain("Final settlement still");
    expect(parser).toContain("Split and part payments must be reviewed");
  });
  it("never sends money, edits credit, or creates customer accounts via voice",()=>{
    expect(voice).not.toContain("authenticatedFetch(");
    expect(voice).not.toContain("createCustomer(");
    expect(pos).toContain("setVoiceCustomerId(customerId)");
    expect(pos).toContain("setVoicePayment(payment)");
    expect(checkout).toContain("creditReady");
    expect(checkout).toContain("setSplitWithCredit");
    expect(checkout).toContain("quoteReady&&approvalValid");
  });
});
