import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const panel=readFileSync(new URL("./sms-provider-panel.tsx",import.meta.url),"utf8");
const nav=readFileSync(new URL("./settings-workspace.tsx",import.meta.url),"utf8");
const payments=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
describe("merchant provider configuration discoverability",()=>{
  it("offers SMS API configuration in its own Settings section",()=>{
    expect(nav).toContain('id: "messaging", label: "SMS & messaging"');
    expect(nav).toContain('section === "messaging"');
    expect(nav).toContain("<SmsProviderPanel");
    for(const name of ["Arkesel","Nalo Solutions","Hubtel SMS","Twilio"])
      expect(panel).toContain(name);
    expect(panel).toContain("sms-api-secret");
    expect(panel).toContain('type={showSecret?"text":"password"}');
    expect(panel).toContain("sms-account-password");
    expect(panel).toContain("expectedRevision:current?.revision??0");
    expect(panel).toContain("currentPassword:password");
    expect(panel).toContain("data.vaultReady");
    expect(panel).toContain("role===\"OWNER\"||role===\"ADMIN\"");
    expect(panel).toContain("Sending is not yet enabled");
  });
  it("puts payment secret fields alongside a single provider selection",()=>{
    expect(payments).toContain("tradeos-selected-payment-provider");
    expect(payments).toContain("providerCode={selected.code}");
    expect(payments).toContain("<GatewayConnectionsPanel");
    expect(payments).not.toContain("tos-pay-card");
    expect(payments).toContain("Save preferred provider");
    expect(payments).toContain("API credential self-service is not available");
  });
});
