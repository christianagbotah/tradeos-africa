import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ui=readFileSync(fileURLToPath(new URL("./voice-sale-assistant.tsx",import.meta.url)),"utf8");
const pos=readFileSync(fileURLToPath(new URL("./pos-workspace.tsx",import.meta.url)),"utf8");
const checkout=readFileSync(fileURLToPath(new URL("./checkout-sheet.tsx",import.meta.url)),"utf8");
describe("voice-assisted POS guardrails",()=>{
  it("requires user to review before applying, never automatically posts",()=>{
    expect(ui).toContain("I reviewed the customer, item identities");
    expect(ui).toContain('draft.intent!=="SALE"');
    expect(ui).toContain("Review draft — nothing has been posted");
    expect(ui).toContain("Adding the cart does not take payment or post a sale");
    expect(ui).not.toContain('authenticatedFetch(');
    expect(pos).toContain("setLines(prev=>{");
    expect(pos).toContain("Speak a sale");
  });
  it("browser voice is optional, with clear privacy and text fallback",()=>{
    expect(ui).toContain("webkitSpeechRecognition");
    expect(ui).toContain("Type or paste the transaction");
    expect(ui).toContain("speech provider may process your audio");
    expect(ui).toContain('maxLength={2000}');
    expect(ui).toContain("setRecognitionError");
  });
  it("checkout exposes credit and part payment only with explicit review",()=>{
    expect(checkout).toContain('"CUSTOMER_CREDIT"');
    expect(checkout).toContain("setSplitWithCredit");
    expect(checkout).toContain("Customer paid part");
    expect(checkout).toContain("creditReady");
    expect(checkout).toContain("availableCreditMinor");
    expect(checkout).toContain("creditMinor");
    expect(checkout).toContain('customerId: customer.id');
  });
});
