import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const file=readFileSync(new URL("./gateway-connections-panel.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
const portal=readFileSync(new URL("./gateway-merchant-connection-panel.tsx",import.meta.url),"utf8");
describe("merchant gateway test-credential UI",()=>{
  it("requires secret password, hides keys, owner-only panel and never offers live charging",()=>{
    expect(file).toContain('type="password"');
    expect(file).toContain('currentPassword:password');
    expect(file).toContain('expectedRevision:current?.revision??0');
    expect(file).toContain('snapshot.vaultReady');
    expect(file).toContain("Real collections");
    expect(file).toContain("Disabled");
    expect(file).toContain('setSecretKey("")');
    expect(file).not.toContain("sk_live_");
    expect(parent).toContain("canManage&&businessId");
    expect(parent).toContain("<GatewayMerchantConnectionPanel");
    expect(parent).toContain("providerCode={selected.code}");
    expect(parent).toContain("tradeos-selected-payment-provider");
    expect(portal).toContain("Connect & activate your merchant account");
    expect(portal).toContain("Verify Hubtel account (no charge)");
    expect(portal).toContain("Request activation");
    expect(portal).toContain("schema.fields.map");
    expect(portal).toContain("currentPassword:password");
    expect(portal).toContain("snapshot.vaultReady");
  });
});
