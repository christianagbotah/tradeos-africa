import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(appRoot, relative));

describe("System Admin AI operations and automation contract", () => {
  it("adds AI Operations to navigation and exposes the automation workspace", () => {
    const nav = read("components/nav.ts");
    expect(nav).toContain('href: "/console/automation"');
    expect(nav).toContain('label: "AI Operations"');
    expect(exists("console/automation/page.tsx")).toBe(true);
  });

  it("puts a concise grounded operations briefing on Overview and preserves deterministic fallback", () => {
    const overview = read("console/page.tsx");
    expect(overview).toContain("/api/admin/intelligence/briefing");
    expect(overview).toContain("/api/admin/attention");
    expect(overview).toContain("AI operations briefing");
    expect(overview).toContain("Urgent now");
    expect(overview).toContain("Revenue & billing risk");
    expect(overview).toContain("Tenant health");
    expect(overview).toContain("Sync & device health");
    expect(overview).toContain("AI unavailable");
    expect(overview).toContain("Deterministic attention remains available");
  });

  it("gives the overview AI briefing padded content and consistent vertical spacing", () => {
    const overview = read("console/page.tsx");
    const css = read("admin-components.css");
    expect(overview).toMatch(/<Section[\s\S]*title="AI operations briefing"[\s\S]*padded[\s\S]*>/);
    expect(overview).toContain('className="admin-ai-briefing-stack"');
    expect(css).toMatch(/\.admin-ai-briefing-stack\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*var\(--tos-admin-space-md\)/);
    expect(css).toMatch(/\.admin-ai-category-grid span\s*\{[\s\S]*padding:\s*8px 12px/);
  });

  it("renders insight cards with evidence, confidence, record links and generated time", () => {
    expect(exists("components/ai-insight-card.tsx")).toBe(true);
    if (!exists("components/ai-insight-card.tsx")) return;
    const card = read("components/ai-insight-card.tsx");
    for (const token of ["finding", "severity", "evidence", "confidence", "recommendation", "recordHref", "generatedAt"]) {
      expect(card).toContain(token);
    }
    expect(card).toContain("Authoritative record");
    expect(card).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders approval cards with impact, target, evidence, role, reason and explicit decisions", () => {
    expect(exists("components/approval-card.tsx")).toBe(true);
    if (!exists("components/approval-card.tsx")) return;
    const card = read("components/approval-card.tsx");
    for (const token of ["proposedAction", "impact", "target", "evidence", "requiredRole", "reason", "Approve", "Reject"]) {
      expect(card).toContain(token);
    }
    expect(card).toContain("window.confirm");
  });

  it("provides policies, approvals, run history and safe natural-language query UI without horizontal-table dependence", () => {
    if (!exists("console/automation/page.tsx")) return;
    const page = read("console/automation/page.tsx");
    const css = ["admin-components-base.css", "admin-components.css"].map(read).join("\n");
    expect(page).toContain("/api/admin/automation/policies");
    expect(page).toContain("/api/admin/automation/runs");
    expect(page).toContain("/api/admin/intelligence/query");
    expect(page).toContain("WAITING_APPROVAL");
    expect(page).toContain("Run history");
    expect(page).toContain("Ask TradeOS");
    expect(page).toContain("Evidence");
    expect(page).not.toContain("dangerouslySetInnerHTML");
    expect(page).not.toContain("<table");
    expect(css).toContain(".admin-ai-grid");
    expect(css).toContain(".admin-approval-card");
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*admin-ai-grid/);
  });
});
