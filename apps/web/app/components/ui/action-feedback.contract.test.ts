import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read=(relative:string)=>readFileSync(new URL(relative,import.meta.url),"utf8");
const toasts=read("./action-feedback.tsx");
const root=read("../../layout.tsx");
const pricing=read("../pricing/pricing-workspace.tsx");
const pos=read("../pos/product-browser.tsx");
const css=read("../../ui-primitives.css");

describe("global feedback for completed user actions",()=>{
  it("mounts the notification viewport outside scrollable cards",()=>{
    expect(root).toContain("<ActionFeedbackViewport />");
    expect(css).toContain(".tos-action-feedback {");
    expect(css).toContain("position: fixed;");
    expect(css).toContain("z-index: 2147482000");
  });
  it("has close controls, accessible outcomes, and keeps failed actions visible",()=>{
    expect(toasts).toContain('role={toast.tone === "error" ? "alert" : "status"}');
    expect(toasts).toContain('aria-label="Dismiss notification"');
    expect(toasts).toContain('detail.tone === "error" ? null');
    expect(toasts).toContain("slice(-3)");
  });
  it("makes price saves, discount requests, reviews and deactivations visible",()=>{
    expect(pricing).toContain("useActionFeedbackMessages(notice,error)");
    expect(pricing).toContain('setNotice("Customer-specific price deactivated.")');
    expect(pricing).toContain('setNotice("Discount "+(decision');
  });
  it("puts the voice sale action before product search",()=>{
    expect(pos.indexOf('className="tos-pos-voice-button"'))
      .toBeLessThan(pos.indexOf('className="tos-pos-search"'));
  });
});
