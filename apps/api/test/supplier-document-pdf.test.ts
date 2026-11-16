import { describe, expect, it } from "vitest";
import { renderSupplierPurchaseOrderPdf } from "../src/supplier-document-pdf.js";

const snapshot = {
  number:"PO-2026-0042",
  businessName:"Example Building Materials",
  branchName:"Tema Branch",
  supplierName:"Verified Ghana Supplier",
  currency:"GHS",
  expectedDate:"2026-11-18",
  notes:"Deliver only after the merchant confirms receiving arrangements.",
  totalMinor:5000,
  lines:[{name:"Steel rods 12mm",unit:"pieces",quantity:4,
    unitCostMinor:1250,lineTotalMinor:5000}],
};
describe("supplier purchase-order PDF from persisted snapshot",()=>{
  it("produces a bounded PDF with embedded Ghana currency support",async()=>{
    const pdf=await renderSupplierPurchaseOrderPdf(snapshot);
    expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(6000);
    expect(pdf.length).toBeLessThan(6_000_000);
    expect(pdf.toString("latin1")).toContain("/Type /Page");
  });
  it("paginates lengthy item lists and renders when delivery date is unset",async()=>{
    const pdf=await renderSupplierPurchaseOrderPdf({
      ...snapshot, expectedDate:null, notes:"",
      lines:Array.from({length:64},(_,index)=>({
        name:"Hardware item number "+index+" with a longer name for readability",
        unit:"boxes",quantity:2,unitCostMinor:1250,lineTotalMinor:2500,
      })),
      totalMinor:160000,
    });
    expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g)??[]).length)
      .toBeGreaterThanOrEqual(2);
  });
  it("rejects invalid snapshot values rather than mailing a corrupt PDF",async()=>{
    await expect(renderSupplierPurchaseOrderPdf({
      ...snapshot, totalMinor:Number.NaN,
    })).rejects.toThrow("PO_PDF_AMOUNT_INVALID");
    await expect(renderSupplierPurchaseOrderPdf({
      ...snapshot, lines:[],
    })).rejects.toThrow("PO_PDF_LINES_INVALID");
    await expect(renderSupplierPurchaseOrderPdf({
      ...snapshot, lines:[{...snapshot.lines[0],quantity:-1}],
    })).rejects.toThrow("PO_PDF_QUANTITY_INVALID");
  });
});
