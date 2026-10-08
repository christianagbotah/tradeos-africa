import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyValue } from "./money-value"; import { QuickAction } from "./quick-action"; import { AttentionItem } from "./attention-item"; import { BusinessPulse } from "./business-pulse"; import { Button } from "../ui/button";
describe("TradeOS business presentation components",()=>{
 it("formats GHS and non-GHS money without hard-coding cedi",()=>{ const g=renderToStaticMarkup(<MoneyValue minor={123456} currencyCode="GHS"/>); const u=renderToStaticMarkup(<MoneyValue minor={-9876} currencyCode="USD"/>); expect(g).toContain("₵"); expect(g).toContain("1,234.56"); expect(u).toContain("USD"); expect(u).toContain("-"); expect(u).not.toContain("₵"); });
 it("renders semantic actions and attention evidence",()=>{ const html=renderToStaticMarkup(<><QuickAction href="/sell" label="Sell" description="Start a sale"/><AttentionItem title="Debt overdue" detail="3 customers" priority="warning" href="/customers" actionLabel="Collect" evidence={["₵2,760 overdue"]}/></>); expect(html).toContain('href="/sell"'); expect(html).toContain("Debt overdue"); expect(html).toContain("₵2,760 overdue"); });
 it("renders pulse evidence, coverage and actions",()=>{ const html=renderToStaticMarkup(<BusinessPulse headline="Today" summary="Evidence-backed summary" evidence={["12 sales"]} coverage="Live data" actions={[{href:"/sales",label:"View sales"}]}/>); expect(html).toContain("TradeOS Pulse"); expect(html).toContain("Live data"); expect(html).toContain("12 sales"); expect(html).toContain('href="/sales"'); });
 it("keeps button touch class contract",()=>{ expect(renderToStaticMarkup(<Button>Save</Button>)).toContain("tos-button"); });
});
