import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("canonical operations workspace", () => {
  it("uses Z.ai primitives instead of legacy panel/form/button presentation", () => {
    const source = fs.readFileSync(path.join(appRoot, "components", "operations-reconciliation.tsx"), "utf8");
    for (const contract of ["Button", "MobileRecordCard", "StatePanel", "StatusBadge"]) expect(source).toContain(contract);
    for (const legacy of ['className="panel"', 'className="panel-heading"', 'className="form-row"', 'className="primary-button"']) expect(source).not.toContain(legacy);
    expect(source).toContain("operations-balance--mobile");
    expect(source).toContain("operations-history--mobile");
  });

  it("keeps operating-day and shift mutations durable and permission-aware", () => {
    const source = fs.readFileSync(path.join(appRoot, "components", "operations-reconciliation.tsx"), "utf8");
    for (const mutation of ["OPERATING_DAY_OPEN_CREATE", "OPERATING_DAY_CLOSE_CREATE", "SHIFT_OPEN_CREATE", "SHIFT_CLOSE_CREATE"]) expect(source).toContain(mutation);
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("dayRoles");
    expect(source).toContain("shiftRoles");
  });

  it("imports a canonical responsive operations stylesheet", () => {
    const layout = fs.readFileSync(path.join(appRoot, "layout.tsx"), "utf8");
    expect(layout).toContain('import "./operations.css";');
    const cssPath = path.join(appRoot, "operations.css");
    expect(fs.existsSync(cssPath)).toBe(true);
    if (!fs.existsSync(cssPath)) return;
    const css = fs.readFileSync(cssPath, "utf8");
    expect(css).toContain("var(--tos-border)");
    expect(css).toContain("var(--tos-focus-ring)");
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)/);
    expect(css).toMatch(/min-height:\s*48px/);
  });
});
