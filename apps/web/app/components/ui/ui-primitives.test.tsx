import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";
import { PageToolbar } from "./page-toolbar";
import { StatCard } from "./stat-card";
import { FormCard } from "./form-card";
import { DataCard } from "./data-card";
import { StatusBadge } from "./status-badge";
import { ResponsiveTable } from "./responsive-table";
import { Button } from "./button";
import { CommandBar } from "./command-bar";
import { StatePanel } from "./state-panel";
import { MobileRecordCard } from "./mobile-record-card";
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => fs.readFileSync(path.join(appRoot, file), "utf8");
describe("TradeOS UI primitives", () => {
  it("renders semantic professional page framing", () => {
    const html = renderToStaticMarkup(<><PageHeader eyebrow="Commerce" title="Sales" subtitle="Track completed transactions" action={<button>Export</button>} /><PageToolbar aria-label="Sales filters"><span>Filters</span></PageToolbar></>);
    expect(html).toContain("<h1"); expect(html).toContain("Commerce"); expect(html).toContain("tradeos-page-header"); expect(html).toContain('aria-label="Sales filters"');
  });
  it("renders stat, form, data and status primitives with stable class contracts", () => {
    const html = renderToStaticMarkup(<><StatCard label="Revenue" value="₵1,200" hint="Today" tone="positive" /><FormCard title="Record payment"><label>Amount<input /></label></FormCard><DataCard title="Recent activity"><p>Row</p></DataCard><StatusBadge tone="warning">Pending</StatusBadge></>);
    for (const c of ["tradeos-stat-card","tradeos-form-card","tradeos-data-card","tradeos-status-badge"]) expect(html).toContain(c);
  });
  it("keeps wide data inside a responsive table container", () => {
    const html = renderToStaticMarkup(<ResponsiveTable aria-label="Transactions"><table><tbody><tr><td>One</td></tr></tbody></table></ResponsiveTable>);
    expect(html).toContain("tradeos-responsive-table"); expect(html).toContain('aria-label="Transactions"');
  });
  it("keeps primitives presentational and free of business API dependencies", () => {
    for (const file of ["page-header.tsx","page-toolbar.tsx","stat-card.tsx","form-card.tsx","data-card.tsx","status-badge.tsx","responsive-table.tsx"]) {
      const source=read(`components/ui/${file}`); expect(source).not.toContain("clientApi"); expect(source).not.toContain("/api/tradeos"); expect(source).not.toContain("useWorkspace");
    }
  });
  it("loads semantic TradeOS tokens before component styling and avoids tiny normal labels", () => {
    const layout=read("layout.tsx"), tokens=read("tradeos-tokens.css"), primitives=read("ui-primitives.css");
    expect(layout).toContain('import "./tradeos-tokens.css"');
    expect(layout.indexOf('tradeos-tokens.css')).toBeLessThan(layout.indexOf('workspace-shell.css'));
    for (const token of ["--tos-font-body","--tos-text-body","--tos-text-supporting","--tos-text-meta","--tos-touch-mobile","--tos-touch-icon","--tos-radius-sm","--tos-radius-md","--tos-radius-lg"]) expect(tokens).toContain(token);
    expect(primitives).toContain("var(--tos-text-body)");
    expect(primitives).not.toMatch(/font-size:\s*(9|10)px/);
  });

  it("renders CommandBar with a stable class, aria-label, and a primary action slot", () => {
    const html = renderToStaticMarkup(
      <CommandBar ariaLabel="Sales filters" primaryAction={<Button>Export</Button>}>
        <input aria-label="Search sales" />
      </CommandBar>
    );
    expect(html).toContain("tradeos-command-bar");
    expect(html).toContain('aria-label="Sales filters"');
    expect(html).toContain("tradeos-command-bar__primary");
    expect(html).toContain("Export");
  });

  it("renders StatePanel with a stable class and intentional state region", () => {
    const html = renderToStaticMarkup(
      <StatePanel state="empty" title="No sales yet" description="Make your first sale to see it here." action={<Button>Sell now</Button>} />
    );
    expect(html).toContain("tradeos-state-panel");
    expect(html).toContain("tradeos-state-panel--empty");
    expect(html).toContain("No sales yet");
    expect(html).toContain("role=\"status\"");
  });

  it("renders MobileRecordCard with a stable class and title/meta/status slots", () => {
    const html = renderToStaticMarkup(
      <MobileRecordCard
        title={<span>TRD-10252</span>}
        meta={<span>Ama · 12:08</span>}
        status={<StatusBadge tone="positive">Paid</StatusBadge>}
      >
        <p>2 items · ₵36.00</p>
      </MobileRecordCard>
    );
    expect(html).toContain("tradeos-mobile-record-card");
    expect(html).toContain("TRD-10252");
    expect(html).toContain("tradeos-mobile-record-card__title");
    expect(html).toContain("tradeos-mobile-record-card__meta");
    expect(html).toContain("tradeos-mobile-record-card__status");
  });

  it("keeps the new primitives presentational and free of business API dependencies", () => {
    for (const file of ["command-bar.tsx", "state-panel.tsx", "mobile-record-card.tsx"]) {
      const source = read(`components/ui/${file}`);
      expect(source).not.toContain("clientApi");
      expect(source).not.toContain("/api/tradeos");
      expect(source).not.toContain("useWorkspace");
    }
  });

  it("exposes the TradeOS focus ring, surface, border, and semantic state tokens", () => {
    const tokens = read("tradeos-tokens.css");
    expect(tokens).toContain("--tos-focus-ring");
    expect(tokens).toContain("--tos-surface");
    expect(tokens).toContain("--tos-border");
    expect(tokens).toContain("--tos-positive");
    expect(tokens).toContain("--tos-warning");
    expect(tokens).toContain("--tos-danger");
    expect(tokens).toContain("--tos-info");
  });

  it("keeps visible :focus-visible styling and no normal-control font sizes below 12px", () => {
    const primitives = read("ui-primitives.css");
    expect(primitives).toMatch(/:focus-visible/);
    expect(primitives).not.toMatch(/font-size:\s*(9|10)px/);
  });
});
