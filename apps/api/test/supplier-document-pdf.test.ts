import { describe, expect, it } from "vitest";
import { renderSupplierPurchaseOrderPdf, supplierPurchaseOrderPdfFilename } from "../src/supplier-document-pdf.js";

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
  it("uses one safe PO number in email and downloadable PDF filenames",()=>{
    expect(supplierPurchaseOrderPdfFilename("PO-2026-0042"))
      .toBe("PO-2026-0042.pdf");
    expect(supplierPurchaseOrderPdfFilename("2026-0042"))
      .toBe("PO-2026-0042.pdf");
    expect(supplierPurchaseOrderPdfFilename("../unsafe/path"))
      .not.toContain("/");
    expect(()=>supplierPurchaseOrderPdfFilename("...")).toThrow(
      "PO_PDF_NUMBER_INVALID");
  });
  it("uses exact eight-decimal cost rounding and rejects inconsistent totals",async()=>{
    const fractional = {...snapshot,lines:[{...snapshot.lines[0],
      quantity:2.5,unitCostMinor:101,lineTotalMinor:253}],totalMinor:253};
    const pdf = await renderSupplierPurchaseOrderPdf(fractional);
    expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
    await expect(renderSupplierPurchaseOrderPdf({
      ...fractional, totalMinor:254,
    })).rejects.toThrow("PO_PDF_TOTAL_MISMATCH");
    await expect(renderSupplierPurchaseOrderPdf({
      ...fractional, lines:[{...fractional.lines[0],lineTotalMinor:252}],
    })).rejects.toThrow("PO_PDF_LINE_TOTAL_MISMATCH");
    await expect(renderSupplierPurchaseOrderPdf({
      ...fractional,lines:[{...fractional.lines[0],quantity:2.500000001}],
    })).rejects.toThrow("PO_PDF_QUANTITY_INVALID");
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
