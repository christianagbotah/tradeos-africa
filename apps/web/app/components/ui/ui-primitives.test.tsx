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

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("TradeOS UI primitives", () => {
  it("renders semantic professional page framing", () => {
    const html = renderToStaticMarkup(<><PageHeader eyebrow="Commerce" title="Sales" subtitle="Track completed transactions" action={<button>Export</button>} /><PageToolbar aria-label="Sales filters"><span>Filters</span></PageToolbar></>);
    expect(html).toContain("<h1");
    expect(html).toContain("Commerce");
    expect(html).toContain("tradeos-page-header");
    expect(html).toContain('aria-label="Sales filters"');
  });

  it("renders stat, form, data and status primitives with stable class contracts", () => {
    const html = renderToStaticMarkup(<><StatCard label="Revenue" value="₵1,200" hint="Today" tone="positive" /><FormCard title="Record payment"><label>Amount<input /></label></FormCard><DataCard title="Recent activity"><p>Row</p></DataCard><StatusBadge tone="warning">Pending</StatusBadge></>);
    expect(html).toContain("tradeos-stat-card");
    expect(html).toContain("tradeos-form-card");
    expect(html).toContain("tradeos-data-card");
    expect(html).toContain("tradeos-status-badge");
  });

  it("keeps wide data inside a responsive table container", () => {
    const html = renderToStaticMarkup(<ResponsiveTable aria-label="Transactions"><table><tbody><tr><td>One</td></tr></tbody></table></ResponsiveTable>);
    expect(html).toContain("tradeos-responsive-table");
    expect(html).toContain('aria-label="Transactions"');
  });

  it("keeps primitives presentational and free of business API dependencies", () => {
    for (const file of ["page-header.tsx", "page-toolbar.tsx", "stat-card.tsx", "form-card.tsx", "data-card.tsx", "status-badge.tsx", "responsive-table.tsx"]) {
      const source = fs.readFileSync(path.join(appRoot, "components", "ui", file), "utf8");
      expect(source).not.toContain("clientApi");
      expect(source).not.toContain("/api/tradeos");
      expect(source).not.toContain("useWorkspace");
    }
  });

  it("imports the shared visual system and route pages adopt the page header", () => {
    const layout = fs.readFileSync(path.join(appRoot, "layout.tsx"), "utf8");
    expect(layout).toContain('import "./ui-primitives.css";');
    for (const route of ["dashboard", "sell", "sales", "customers", "purchases", "inventory", "catalog", "returns", "operations", "reports"]) {
      const source = fs.readFileSync(path.join(appRoot, "(workspace)", route, "page.tsx"), "utf8");
      expect(source).toContain("PageHeader");
    }
  });
});
