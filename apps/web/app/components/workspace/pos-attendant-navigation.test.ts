import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  visibleNavItems,primaryNavItems,secondaryNavItems,mobileMoreNavigationGroups,
} from "./workspace-navigation";
const shell=readFileSync(join(__dirname,"app-shell.tsx"),"utf8");
const css=readFileSync(join(__dirname,"../../workspace-shell.css"),"utf8");
const checkout=readFileSync(join(__dirname,"../pos/checkout-sheet.tsx"),"utf8");
const pos=readFileSync(join(__dirname,"../pos/pos-workspace.tsx"),"utf8");
const staff=readFileSync(join(__dirname,"../settings/staff-editor.tsx"),"utf8");

describe("shop attendant least-privilege web experience",()=>{
  it("shows only the selling route, not dashboard, catalog editor or finances",()=>{
    expect(visibleNavItems("POS_ATTENDANT").map(x=>x.segment)).toEqual(["sell"]);
    expect(primaryNavItems("POS_ATTENDANT").map(x=>x.segment)).toEqual(["sell"]);
    expect(secondaryNavItems("POS_ATTENDANT")).toEqual([]);
    expect(mobileMoreNavigationGroups("POS_ATTENDANT")).toEqual([]);
  });
  it("retains existing owner/cashier navigation semantics",()=>{
    expect(visibleNavItems("OWNER").some(x=>x.segment==="reports")).toBe(true);
    expect(visibleNavItems("CASHIER").some(x=>x.segment==="catalog")).toBe(true);
    expect(visibleNavItems("CASHIER").some(x=>x.segment==="sell")).toBe(true);
  });
  it("blocks direct routes as well as hidden links, allows sign out",()=>{
    expect(shell).toContain('attendantOnly && activeSegment !== "sell"');
    expect(shell).toContain("Sales-only access");
    expect(shell).toContain('href="/sell"');
    expect(shell).toContain('aria-label="Sign out of POS"');
    expect(shell).toContain("onClick={handleSignOut}");
    expect(shell).toContain("moreOpen && !attendantOnly");
    expect(css).toContain('.tos-bottomnav[data-pos-attendant="true"]');
  });
  it("sends restricted tender policy into the checkout without an alternate backdoor",()=>{
    expect(pos).toContain('const cashOnly = role === "POS_ATTENDANT"');
    expect(pos).toContain("cashOnly={cashOnly}");
    expect(checkout).toContain("cashOnly?: boolean");
    expect(checkout).toContain('if (cashOnly && next !== "CASH") return;');
    expect(checkout).toContain('cashOnly ? null : customers.find');
    expect(checkout).toContain("if(!open||!online||cashOnly){setApprovals([]);return;}");
    expect(checkout).toContain("if(!open || !online || cashOnly){setHubtelAvailable(false);return;}");
    expect(checkout).toContain('{!cashOnly ? <CustomerPicker');
    expect(checkout).toContain('{!cashOnly ? <button type="button" className="tos-pay-card"');
  });
  it("makes the dedicated role available to administrators for explicit assignment",()=>{
    expect(staff).toContain('POS_ATTENDANT: "POS attendant · cash-only POS"');
    expect(staff).toContain('"MANAGER", "CASHIER", "POS_ATTENDANT"');
  });
});
