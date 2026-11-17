import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const checkout=readFileSync(fileURLToPath(
  new URL("./checkout-sheet.tsx",import.meta.url)),"utf8");
describe("POS cash / electronic checkout",()=>{
  it("separates primary tenders and pay-later customer credit",()=>{
    expect(checkout).toContain('tos-pay-card__label">Cash');
    expect(checkout).toContain('tos-pay-card__label">Electronic');
    expect(checkout).toContain('tos-pay-card__label">Pay later (customer credit)');
    expect(checkout).not.toContain('value: "OTHER", label: "Other"');
    expect(checkout).not.toContain('value: "BANK", label: "Bank transfer"');
  });
  it("uses pending Hubtel for both MoMo and card",()=>{
    expect(checkout).toContain('onClick={()=>chooseTender("MOMO")}');
    expect(checkout).toContain('onClick={()=>chooseTender("CARD")}');
    expect(checkout).toContain('setHubtelSelected(next==="MOMO"||next==="CARD")');
    expect(checkout).toContain('(!hubtelSelected||(online&&hubtelAvailable))');
    expect(checkout).toContain('(payload as Record<string,unknown>).paymentProvider="HUBTEL"');
    expect(checkout).toContain('resultData?.status!=="AWAITING_PAYMENT"');
    expect(checkout).toContain('target.hostname!=="pay.hubtel.com"');
    expect(checkout).toContain('independent Hubtel');
    expect(checkout).toContain('Only Hubtel collects card details');
  });
});
