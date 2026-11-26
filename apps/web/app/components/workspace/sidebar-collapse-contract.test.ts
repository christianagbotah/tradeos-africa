import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(join(__dirname, "app-shell.tsx"), "utf8");
const css = readFileSync(join(__dirname, "../../workspace-shell.css"), "utf8");

describe("desktop sidebar collapse", () => {
  it("provides a labelled accessible toggle and a persistent device preference", () => {
    expect(shell).toContain('aria-label={sidebarCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}');
    expect(shell).toContain('aria-controls="tradeos-sidebar-navigation"');
    expect(shell).toContain('window.localStorage.getItem("tradeos.sidebar.collapsed")');
    expect(shell).toContain('window.localStorage.setItem("tradeos.sidebar.collapsed", String(next))');
    expect(shell).toContain('data-sidebar-collapsed={sidebarCollapsed}');
    expect(shell).toContain('data-collapsed={sidebarCollapsed}');
  });

  it("retains accessible navigation links and sign-out while labels are hidden", () => {
    expect(shell).toContain('title={item.label} aria-label={item.label}');
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
    expect(shell).toContain('title="Sign out" aria-label="Sign out"');
    expect(css).toContain('.tos-sidebar[data-collapsed="true"] .tos-sidebar__link-icon { width: 20px; height: 20px; }');
  });

  it("only shrinks the rail on desktops; tablet and mobile keep their drawer", () => {
    expect(css).toMatch(/@media \(min-width: 1025px\) \{[\s\S]*?\.tos-shell\[data-sidebar-collapsed="true"\]\s*\{ grid-template-columns: 76px minmax\(0, 1fr\); \}/);
    expect(css).toContain('@media (max-width: 1024px) {\n  .tos-sidebar__collapse { display: none; }');
    expect(css).toContain('.tos-sidebar__link-label');
  });
});
