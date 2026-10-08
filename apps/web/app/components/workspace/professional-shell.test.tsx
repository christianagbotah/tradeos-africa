import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";import {describe,expect,it} from "vitest";
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");const read=(r:string)=>fs.readFileSync(path.join(appRoot,r),"utf8");
describe("TradeOS adaptive authenticated shell",()=>{
 it("uses bottom navigation and a structured More sheet instead of a phone sidebar drawer",()=>{const s=read("components/workspace/app-shell.tsx");expect(s).toContain("MobileBottomNav");expect(s).toContain("MobileMoreSheet");expect(s).not.toContain("workspace-mobile-drawer");expect(s).toContain("workspace-profile-menu");expect(s).toContain("Sign out");});
 it("keeps switchers conditional and route context persistent",()=>{const s=read("components/workspace/app-shell.tsx");expect(s).toContain("session.memberships.length > 1");expect(s).toContain("activeBranches.length > 1");expect(s).toContain('key={`${context.business.id}:${branchId}`}');});
 it("uses token-backed touch sizing and phone safe areas without tiny shell labels",()=>{const css=read("workspace-shell.css");expect(css).toContain("var(--tos-touch-mobile)");expect(css).toContain("var(--tos-touch-icon)");expect(css).toContain("env(safe-area-inset-bottom)");expect(css).not.toMatch(/font-size:\s*(9|10)px/);});
 it("retains legacy polish only as compatibility for unmigrated feature modules",()=>{const css=read("workspace-polish.css");expect(css).toContain(".workspace-main .panel");expect(css).not.toContain(".workspace-mobile-bottom-nav");});
 it("keeps operations responsive tables",()=>{expect(read("components/operations-reconciliation.tsx")).toContain("ResponsiveTable");});
});
