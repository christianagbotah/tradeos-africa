import fs from "node:fs"; import path from "node:path"; import {fileURLToPath} from "node:url"; import {describe,expect,it} from "vitest";
import {isWorkspaceNavActive,visibleWorkspaceNav,workspaceNavigation,mobileWorkspaceNav,mobileMoreNav,isMobileMoreActive} from "./workspace-navigation";
const hrefs=(role:string)=>mobileWorkspaceNav(role).map((item)=>item.href);
describe("TradeOS application shell navigation",()=>{
 it("uses real workspace routes",()=>{expect(workspaceNavigation.map(i=>i.href)).toEqual(["/dashboard","/sell","/sales","/customers","/purchases","/inventory","/catalog","/returns","/cashbook","/operations","/reports"]);});
 it("marks nested routes active",()=>{expect(isWorkspaceNavActive("/cashbook/history","/cashbook")).toBe(true);expect(isWorkspaceNavActive("/sales","/cashbook")).toBe(false);});
 it("keeps existing role route visibility authoritative",()=>{expect(visibleWorkspaceNav("OWNER")).toHaveLength(11);expect(visibleWorkspaceNav("VIEWER").map(i=>i.href)).not.toContain("/sell");});
 it("derives exact role-aware phone priorities",()=>{expect(hrefs("OWNER")).toEqual(["/dashboard","/sell","/cashbook","/inventory","#more"]);expect(hrefs("MANAGER")).toEqual(["/dashboard","/sell","/cashbook","/inventory","#more"]);expect(hrefs("CASHIER")).toEqual(["/dashboard","/sell","/sales","/cashbook","#more"]);expect(hrefs("INVENTORY")).toEqual(["/dashboard","/inventory","/purchases","/catalog","#more"]);expect(hrefs("ACCOUNTANT")).toEqual(["/dashboard","/cashbook","/customers","/reports","#more"]);expect(hrefs("VIEWER")).toEqual(["/dashboard","/sales","/inventory","/reports","#more"]);});
 it("fails closed for unknown roles and More contains only authorized leftovers",()=>{expect(hrefs("UNKNOWN")).toEqual(["#more"]);expect(mobileMoreNav("UNKNOWN")).toEqual([]);for(const item of mobileMoreNav("CASHIER")) expect(visibleWorkspaceNav("CASHIER").map(i=>i.href)).toContain(item.href);});
 it("marks More active when the current route lives under More",()=>{expect(isMobileMoreActive("OWNER","/customers")).toBe(true);expect(isMobileMoreActive("OWNER","/sell")).toBe(false);expect(isMobileMoreActive("UNKNOWN","/customers")).toBe(false);});
 it("keeps route-driven aria state in shell source",()=>{const dir=path.dirname(fileURLToPath(import.meta.url));const source=fs.readFileSync(path.join(dir,"app-shell.tsx"),"utf8");expect(source).toContain("usePathname()");expect(source).toContain('aria-current={active ? "page" : undefined}');});
});

// Task 2: hierarchy, active-state, permission-presentation, and responsive contracts
describe("TradeOS shell hierarchy and permission presentation", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const readSrc = (file: string) => fs.readFileSync(path.join(dir, file), "utf8");

  it("provides grouped desktop navigation with parent/child hierarchy", () => {
    const source = readSrc("app-shell.tsx");
    expect(source).toContain("workspace-nav-group");
    expect(source).toContain("workspace-nav-label");
    expect(source).toMatch(/groups\s*=/);
  });

  it("ensures exactly one active nav item for nested paths", () => {
    const visible = visibleWorkspaceNav("OWNER");
    for (const pathname of ["/sales/123", "/cashbook/history", "/inventory/movements", "/customers/c-1"]) {
      const active = visible.filter((item) => isWorkspaceNavActive(pathname, item.href));
      expect(active).toHaveLength(1);
    }
  });

  it("provides business and branch context in the shell source", () => {
    const source = readSrc("app-shell.tsx");
    expect(source).toContain("context.business");
    expect(source).toContain("activeBranch");
  });

  it("provides an account menu with sign out", () => {
    const source = readSrc("app-shell.tsx");
    expect(source).toContain("workspace-profile-menu");
    expect(source).toContain("Sign out");
  });

  it("does not promote mutation-only destinations in read-only mobile nav", () => {
    const viewerMobile = mobileWorkspaceNav("VIEWER").map((i) => i.href);
    expect(viewerMobile).not.toContain("/sell");
    expect(viewerMobile).not.toContain("/returns");
    expect(viewerMobile).not.toContain("/catalog");
  });

  it("requires content containers to allow shrinking (no overflow at 360px)", () => {
    const css = readSrc("../../workspace-shell.css");
    expect(css).toMatch(/\.workspace-main\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.workspace-content\s*\{[^}]*min-width:\s*0/);
    expect(css).not.toMatch(/\.workspace-content\s*\{[^}]*width:\s*\d+px/);
  });

  it("includes a mobile breakpoint at or under 768px with safe-area padding", () => {
    const css = readSrc("../../workspace-shell.css");
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*(76[0-9]|7[0-5][0-9])px\s*\)/);
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});


describe("mobile shell composition correction", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const readSrc = (file: string) => fs.readFileSync(path.join(dir, file), "utf8");

  it("uses a dedicated mobile business/branch context trigger instead of desktop selectors", () => {
    const source = readSrc("app-shell.tsx");
    expect(source).toContain("workspace-mobile-context-trigger");
    expect(source).toContain("workspace-mobile-context-copy");
    expect(source).toContain("Open business and branch context");
  });

  it("keeps desktop account controls out of the phone header while exposing the mobile context trigger", () => {
    const css = readSrc("../../workspace-shell.css");
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.workspace-context-actions\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.workspace-mobile-context-trigger\s*\{[^}]*display:\s*(?:grid|flex)/);
  });
});
