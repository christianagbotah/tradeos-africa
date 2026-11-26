import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const form=readFileSync(fileURLToPath(
  new URL("./purchase-order-workspace.tsx",import.meta.url)),"utf8");
const formStyle=readFileSync(fileURLToPath(
  new URL("./purchase-order-workspace.module.css",import.meta.url)),"utf8");
const preview=readFileSync(fileURLToPath(
  new URL("../../(workspace)/purchase-orders/[orderId]/page.tsx",import.meta.url)),"utf8");
const previewStyle=readFileSync(fileURLToPath(
  new URL("../../(workspace)/purchase-orders/[orderId]/purchase-order-preview.module.css",import.meta.url)),"utf8");

describe("supplier purchase order presentation contracts",()=>{
  it("keeps the item, purchasing unit, quantity, cost, total and remove in one row",()=>{
    expect(formStyle).toMatch(/\.lineRow\{[^}]*display:grid;grid-template-columns:[^}]*;/);
    expect(formStyle).toContain("min-width:955px");
    expect(formStyle).toContain("overflow-x:auto");
    expect(form).toContain('className={styles.lineRow}');
    expect(form).toContain('className={styles.scroll}');
    expect(form).toContain("disabled={!canWrite||!item}");
    expect(form).toContain('aria-label={`Line ${index+1} purchasing unit`}');
    expect(form).toContain('aria-label={`Line ${index+1} quantity`}');
    expect(form).toContain("unitCostMinor");
    expect(form).toContain("formatMoney(lineTotal,currency)");
  });
  it("shows purchase order total in explicit white above a navy preview",()=>{
    expect(preview).toContain("TOTAL AMOUNT");
    expect(preview).toContain("money(order.totalMinor)");
    expect(previewStyle).toMatch(/\.heroAmount strong\{[^}]*color:#fff/);
    expect(previewStyle).toMatch(/\.hero\{[^}]*background:linear-gradient/);
    expect(preview).toContain('order.status==="ISSUED"');
    expect(preview).toContain("Print / Save as PDF");
  });
  it("never confuses a supplier order with receipt or payment",()=>{
    expect(form).toContain("No stock or money is recorded");
    expect(preview).toContain("not proof of delivery");
    expect(preview).toContain("after goods are received");
    expect(form).not.toContain("PURCHASE_RECEIVE_CREATE");
  });
});
