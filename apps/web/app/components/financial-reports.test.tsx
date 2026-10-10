import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(appRoot, file), "utf8");

describe("canonical Reports and TradeOS CFO frontend", () => {
  it("uses Z.ai command, stat, state, status and mobile-record primitives", () => {
    const source = read("components/financial-reports.tsx");
    for (const contract of ["CommandBar", "StatCard", "StatePanel", "StatusBadge", "MobileRecordCard"]) expect(source).toContain(contract);
    for (const legacy of ['className="panel"', "panel-heading", 'className="eyebrow"', 'className="form-row', "metrics-grid", "metric-card", "ai-panel", "working-capital-panel", "working-capital-grid", "workflow-badge"]) expect(source).not.toContain(legacy);
  });

  it("migrates forecast and CFO action presentation off legacy report classes", () => {
    const forecast = read("components/cash-forecast.tsx");
    const cfo = read("components/cfo-action-center.tsx");
    for (const contract of ["StatCard", "StatusBadge", "MobileRecordCard"]) expect(forecast).toContain(contract);
    expect(forecast).not.toContain("working-capital-panel");
    expect(forecast).not.toContain("panel-heading");
    expect(forecast).not.toContain("workflow-badge");
    expect(cfo).toContain("StatusBadge");
    expect(cfo).not.toContain("panel-heading");
    expect(cfo).not.toContain('className="eyebrow"');
    expect(cfo).not.toContain('className="ghost-button"');
  });

  it("owns report styling in a canonical module and removes report skinning from globals", () => {
    const layout = read("layout.tsx");
    expect(layout).toContain('import "./reports.css";');
    const css = read("reports.css");
    expect(css).toContain("var(--tos-border)");
    expect(css).toContain("var(--tos-focus-ring)");
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)/);
    const globals = read("globals.css");
    for (const selector of [".ai-panel", ".working-capital-panel", ".cfo-action-list", ".forecast-badges", ".forecast-explanation"]) expect(globals).not.toContain(selector);
  });
});
