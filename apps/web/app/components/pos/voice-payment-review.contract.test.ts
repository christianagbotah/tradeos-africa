import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const source=(rel:string)=>readFileSync(fileURLToPath(
  new URL(rel,import.meta.url)),"utf8");
const assistant=source("./voice-sale-assistant.tsx");
const pos=source("./pos-workspace.tsx");
const checkout=source("./checkout-sheet.tsx");
describe("voice payment review must not authorize payment",()=>{
  it("transfers only advisory data on final voice draft acknowledgement",()=>{
    expect(assistant).toContain("paymentState:draft.paymentState");
    expect(assistant).toContain("tenderedMinor:draft.tenderedMinor");
    expect(assistant).toContain("This is only a transcription");
    expect(assistant).toContain("Checkout calculates authoritative prices");
    expect(pos).toContain("setVoicePaymentSuggestion(lines.length===0?suggestion:null)");
    expect(pos).toContain("setVoicePaymentSuggestion(null)");
    expect(pos).toContain("initialVoicePaymentSuggestion={voicePaymentSuggestion}");
  });
  it("keeps an explicit checkout button before copying a spoken amount",()=>{
    expect(checkout).toContain("evaluateVoicePaymentSuggestion");
    expect(checkout).toContain('onClick={copySpokenCash}');
    expect(checkout).toContain("Spoken payment — review required");
    expect(checkout).toContain("Speech is not proof that money was received.");
    expect(checkout).toContain("Use spoken amount for cash + credit split");
    expect(checkout).toContain("Use spoken amount as cash received");
    expect(checkout).toContain('setPaidNowMinor(voiceSuggestion.tenderedMinor)');
    expect(checkout).toContain('setCashReceivedMinor(voiceSuggestion.tenderedMinor)');
    expect(checkout).toContain("creditReady");
    expect(checkout).toContain("quoteReady&&approvalValid");
    expect(checkout).toContain('getOfflineQueue().authenticatedFetch("/v1/pricing/quote"');
  });
  it("does not implement any new voice payment posting API",()=>{
    expect(assistant).not.toContain("authenticatedFetch(");
    expect(checkout).toContain('mutationType: "SALE_CREATE"');
    expect(checkout).toContain("if (!canCharge || busy) return;");
    expect(checkout).toContain("Electronic payments are never");
  });
});
