import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const file=readFileSync(new URL("./payment-provider-panel.tsx",import.meta.url),"utf8");
describe("merchant payment provider UI",()=>{
  it("never treats saved preference as payment authorization or collects secrets",()=>{
    expect(file).toContain("Payment providers");
    expect(file).toContain("Save preferred provider");
    expect(file).toContain("expectedRevision:snapshot.revision");
    expect(file).toContain("canManage");
    expect(file).toContain("provider.eligible");
    expect(file).toContain("does not activate collection");
    expect(file).toContain("Existing outstanding payments remain tied");
    expect(file).not.toContain('type="password"');
    expect(file).not.toContain('name="apiKey"');
  });
});
