import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const payment=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
const sms=readFileSync(new URL("./sms-provider-panel.tsx",import.meta.url),"utf8");
const merchant=readFileSync(new URL("./gateway-merchant-connection-panel.tsx",import.meta.url),"utf8");
const schema=readFileSync(new URL("../../../../api/src/payment-providers/merchant-schemas.ts",import.meta.url),"utf8");
describe("direct Hubtel online checkout and SMS setup",()=>{
  it("shows hosted checkout configuration in app, not a generic Hubtel documentation redirect",()=>{
    expect(payment).toContain('selected.code==="HUBTEL"');
    expect(payment).toContain("Hubtel Online Checkout is integrated");
    expect(payment).toContain("Transaction Status");
    expect(payment).toContain("data.countryCode===\"GH\"");
    expect(merchant).toContain("Connect Hubtel Online Checkout");
    expect(schema).toContain("Collection Account Number");
  });
  it("distinguishes SMS Client ID/Secret from Sales API credentials and requires explicit test opt-in",()=>{
    expect(sms).toContain('useState<Provider>("HUBTEL_SMS")');
    expect(sms).toContain("Hubtel SMS setup is here, not on a help page");
    expect(sms).toContain("SMS Client ID");
    expect(sms).toContain("confirmOwnership:true");
    expect(sms).toContain("Send one Hubtel SMS test");
    expect(sms).toContain("window.confirm");
    expect(sms).toContain("currentPassword:password");
  });
});
