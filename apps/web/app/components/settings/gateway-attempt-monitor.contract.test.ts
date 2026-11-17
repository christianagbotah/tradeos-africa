import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const content=readFileSync(new URL("./gateway-attempt-monitor.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
describe("merchant test payment attempt monitoring",()=>{
  it("remains read-only and only follows the authenticated business",()=>{
    expect(content).toContain("/payment-gateways/attempts?limit=20");
    expect(content).toContain("result.businessId!==businessId");
    expect(content).toContain("result.collectionEnabled!==false");
    expect(content).toContain("No test payment attempts recorded yet");
    expect(content).toContain("Preparation");
    expect(content).not.toContain("method:\"POST\"");
    expect(content).not.toContain("method:\"PUT\"");
    expect(parent).toContain("canManage&&businessId?<GatewayAttemptMonitor");
  });
});
