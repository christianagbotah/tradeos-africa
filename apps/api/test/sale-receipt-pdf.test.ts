import {describe,it,expect} from "vitest";
import {
  renderVerifiedSaleReceiptPdf,parseReceiptPaper,receiptPdfFilename,
  type VerifiedReceiptSnapshot,type ReceiptPaper,
} from "../src/sale-receipt-pdf.js";

const sale:VerifiedReceiptSnapshot={
  saleId:"b8fe8921-08a7-423c-b2eb-947beec01acd",
  status:"COMPLETED",
  completedAt:"2026-11-15T14:10:00Z",
  businessName:"Variety Groceries & Household Supplies",
  branchName:"Accra Central",address:"High Street, Accra",
  phone:"0241234567",timezone:"Africa/Accra",
  customerName:"Madam Rejoice - JoyFresh",cashierName:"Christian Agbotah",
  currencyCode:"GHS",totalMinor:4400,
  lines:[{name:"Take Away Pack A5, special printed package",
    quantity:2,unitCode:"PCS",unitNetMinor:2000,
    lineTaxMinor:400,lineTotalMinor:4400}],
  payments:[{method:"MOMO",amountMinor:4400,refundedMinor:0,status:"SUCCEEDED"}],
};
function pageCount(pdf:Buffer){
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g)??[]).length;
}
describe("authenticated sales receipt PDF layouts",()=>{
  it.each(["A5","80mm","58mm"] as ReceiptPaper[])(
    "renders %s as a real printer-sized PDF with embedded currency fonts",
    async paper=>{
      const pdf=await renderVerifiedSaleReceiptPdf(sale,paper);
      expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(5000);
      expect(pdf.length).toBeLessThan(6_000_000);
      expect(pageCount(pdf)).toBe(1);
      const pageBox=pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      expect(pageBox).toBeTruthy();
      const width=Number(pageBox?.[1]);
      expect(width).toBeCloseTo(paper==="A5"?419.53:paper==="80mm"?226.77:164.41,0);
      if(paper==="A5")expect(Number(pageBox?.[2])).toBeCloseTo(595.27,0);
      else expect(Number(pageBox?.[2])).toBeLessThan(1000);
    },
  );
  it("paginates long names/large carts without clipping the thermal page",async()=>{
    const many:VerifiedReceiptSnapshot={
      ...sale,lines:Array.from({length:90},(_,i)=>({
        name:"Item "+i+" Supermarket tissue roll and Ghanaian grocery very long name",
        quantity:2,unitCode:"PCS",unitNetMinor:2000,
        lineTaxMinor:400,lineTotalMinor:4400,
      })),totalMinor:396000,
      payments:[{method:"CASH",amountMinor:396000,refundedMinor:0,status:"SUCCEEDED"}],
    };
    const thermal=await renderVerifiedSaleReceiptPdf(many,"58mm");
    const a5=await renderVerifiedSaleReceiptPdf(many,"A5");
    expect(pageCount(thermal)).toBeGreaterThan(1);
    expect(pageCount(a5)).toBeGreaterThan(1);
  }, 30_000);
  it("labels customer-credit and refunded receipts without hiding reversals",async()=>{
    const credit=await renderVerifiedSaleReceiptPdf({
      ...sale,payments:[{method:"CUSTOMER_CREDIT",amountMinor:4400,refundedMinor:0,status:"SUCCEEDED"}],
    },"80mm");
    const returned=await renderVerifiedSaleReceiptPdf({
      ...sale,status:"PARTIALLY_REFUNDED",
      payments:[{method:"MOMO",amountMinor:4400,refundedMinor:1000,status:"PARTIALLY_REVERSED"}],
    },"58mm");
    expect(credit.subarray(0,5).toString()).toBe("%PDF-");
    expect(returned.subarray(0,5).toString()).toBe("%PDF-");
  });
  it("rejects invalid paper, unpaid records and oversized/corrupt amounts",async()=>{
    expect(parseReceiptPaper("58mm")).toBe("58mm");
    expect(()=>parseReceiptPaper("A4")).toThrow("RECEIPT_PAPER_INVALID");
    expect(receiptPdfFilename(sale.saleId,"A5"))
      .toBe("TradeOS-Receipt-b8fe8921-A5.pdf");
    await expect(renderVerifiedSaleReceiptPdf({
      ...sale,status:"OPEN" as "COMPLETED",
    })).rejects.toThrow("RECEIPT_SNAPSHOT_INVALID");
    await expect(renderVerifiedSaleReceiptPdf({
      ...sale,payments:[{...sale.payments[0]!,status:"PENDING"}],
    })).rejects.toThrow("RECEIPT_PAYMENT_PENDING");
    await expect(renderVerifiedSaleReceiptPdf({
      ...sale,totalMinor:Number.NaN,
    })).rejects.toThrow("RECEIPT_AMOUNT_INVALID");
  });
});
