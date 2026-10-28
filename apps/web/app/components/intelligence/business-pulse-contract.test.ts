import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(__dirname,"../../../../..");
const panelPath=path.join(root,"apps/web/app/components/intelligence/business-pulse.tsx");
const shellPath=path.join(root,"apps/web/app/components/workspace/app-shell.tsx");
const cssPath=path.join(root,"apps/web/app/intelligence.css");
const source=(p:string)=>fs.existsSync(p)?fs.readFileSync(p,"utf8"):"";

describe("business pulse contract",()=>{
  it("mounts one global Pulse in AppShell and scopes its payload to current business and branch",()=>{
    const shell=source(shellPath), pulse=source(panelPath);
    expect(shell).toContain('import { BusinessPulsePanel }');
    expect(shell).toContain('<BusinessPulsePanel />');
    expect(pulse).toContain('useApiFetch<BusinessPulse>');
    expect(pulse).toContain('/v1/intelligence/pulse?businessId=');
    expect(pulse).toContain('pulseMatchesContext');
    expect(pulse).toMatch(/data\.businessId\s*===\s*session\.businessId/);
    expect(pulse).toMatch(/data\.branchId\s*===\s*session\.branchId/);
  });

  it("shows an unseen badge and explicit live loading/error/offline states",()=>{
    const pulse=source(panelPath);
    expect(pulse).toContain('unseenCount');
    expect(pulse).toContain('Business Pulse');
    expect(pulse).toContain('Fresh Pulse data requires a connection');
    expect(pulse).toContain('Could not load Business Pulse');
    expect(pulse).toContain('aria-busy');
  });

  it("marks seen online with scope-only POST and never calls an economic mutation endpoint",()=>{
    const pulse=source(panelPath);
    expect(pulse).toContain('/v1/intelligence/pulse/seen');
    expect(pulse).toMatch(/method:\s*"POST"/);
    expect(pulse).toMatch(/JSON\.stringify\(\{\s*businessId:\s*session\.businessId,\s*branchId:\s*session\.branchId\s*\}\)/s);
    expect(pulse).toMatch(/if \((?:!session \|\| )?!queue\.online/);
    expect(pulse).toContain("refetch");
    expect(pulse).toContain("awaitingFresh");
    expect(pulse).toMatch(/setAwaitingFresh\(true\);[\s\S]*refetch\(\);/);
    expect(pulse).toMatch(/if \(!open \|\| awaitingFresh \|\| loading \|\| !pulse \|\| pulse\.unseenCount < 1\) return;/);
    expect(pulse).toMatch(/void markSeen\(pulse\);/);
    expect(pulse).not.toMatch(/\/(?:sales|payments|refunds|returns|purchases|inventory|cashbook|staff|memberships)\b[^"']*["'][^\n]*method:\s*"(?:POST|PATCH|DELETE)"/s);
  });

  it("resets open/acknowledgement UI when business or branch context changes",()=>{
    const pulse=source(panelPath);
    expect(pulse).toContain("contextKeyRef");
    expect(pulse).toMatch(/setOpen\(false\);[\s\S]*setAwaitingFresh\(false\);[\s\S]*setSeenBusy\(false\);[\s\S]*setSeenError\(null\);/);
    expect(pulse).toMatch(/\[contextKey\]/);
    expect(pulse).toMatch(/contextKeyRef\.current !== requestKey/);
  });

  it("keeps the mobile unseen badge inside the Pulse trigger so it cannot expand the viewport",()=>{
    const css=source(cssPath);
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.tos-pulse-trigger__badge\s*\{[^}]*right:\s*0(?:px)?;/);
    expect(css).not.toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.tos-pulse-trigger__badge\s*\{[^}]*right:\s*-\d/);
  });

  it("reuses lazy task explanations in Pulse without nesting the explanation control inside workflow links",()=>{
    const pulse=source(panelPath);
    expect(pulse).toContain('import { BusinessActionExplanation }');
    expect(pulse).toMatch(/<BusinessActionExplanation\s+item=\{item\}\s+businessId=\{session\.businessId\}\s+online=\{queue\.online\}\s*\/>/s);
    expect(pulse).toMatch(/className="[^"]*tos-pulse-task[^"]*"/);
    expect(pulse).toContain('className="tos-pulse-task__link"');
    expect(pulse).not.toMatch(/<Link[^>]*className="tos-pulse-task__link"[^>]*>(?:(?!<\/Link>)[\s\S])*<BusinessActionExplanation/);
  });

  it("keeps feed actions navigation-only and ships responsive drawer styling",()=>{
    const pulse=source(panelPath), css=source(cssPath);
    expect(pulse).toContain('<Link');
    expect(pulse).toContain('pulseAttentionHref');
    expect(pulse).toContain('pulseActionHref');
    expect(pulse).toContain('if (item.actionType === "CREATE_PERFORMANCE_REVIEW") return "/reports";');
    expect(pulse).toContain('if (item.actionType === "CREATE_INVENTORY_REVIEW") return "/inventory";');
    expect(pulse).toContain('if (item.actionType === "CREATE_PAYABLES_REVIEW") return "/purchases";');
    expect(pulse).toContain('if (item.actionType === "CREATE_DATA_READINESS_REVIEW") return "/settings?section=business";');
    expect(css).toContain('.tos-pulse-drawer');
    expect(css).toContain('.tos-pulse-trigger__badge');
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.tos-pulse-trigger__label/);
  });
});
