import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const content=readFileSync(new URL("./gateway-attempt-monitor.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
describe("merchant test payment attempt monitoring",()=>{
  it("shows only authenticated TEST attempts; explicit actions never imply collection",()=>{
    expect(content).toContain("/payment-gateways/attempts?limit=20");
    expect(content).toContain("result.businessId!==businessId");
    expect(content).toContain("result.collectionEnabled!==false");
    expect(content).toContain("No test payment attempts recorded yet");
    expect(content).toContain("Preparation");
    expect(content).toContain('method:"POST"');
    expect(content).toContain("verify-sandbox");
    expect(content).toContain("prepare()");
    expect(content).toContain("providerTransactionId");
    expect(content).toContain("no checkout link, test charge or live collection");
    expect(content).toContain("the original sale is still open and unpaid");
    expect(content).not.toContain('method:"PUT"');
    expect(content).not.toContain("authorization_url");
    expect(content).not.toContain("requestRefund");
    expect(parent).toContain("canManage&&businessId?<GatewayAttemptMonitor");
  });
});
