import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const file=readFileSync(new URL("./gateway-connections-panel.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
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
    expect(parent).toContain("canManage&&businessId?<GatewayConnectionsPanel");
  });
});
