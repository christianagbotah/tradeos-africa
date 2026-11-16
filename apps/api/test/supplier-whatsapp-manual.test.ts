import { describe, expect, it } from "vitest";
import {
  makeSupplierWhatsAppSummary, normalizeSupplierWhatsAppPhone,
} from "../src/supplier-whatsapp-manual.js";

describe("manual supplier WhatsApp contact",()=>{
  it("normalizes Ghana mobile numbers and explicit international numbers",()=>{
    expect(normalizeSupplierWhatsAppPhone("024 111 2222")).toBe("233241112222");
    expect(normalizeSupplierWhatsAppPhone("+233 (24) 111-2222")).toBe("233241112222");
    expect(normalizeSupplierWhatsAppPhone("233241112222")).toBe("233241112222");
    expect(normalizeSupplierWhatsAppPhone("0551112222")).toBe("233551112222");
    expect(normalizeSupplierWhatsAppPhone("+44 7700 900123")).toBe("447700900123");
  });
  it("never guesses ambiguous or unsafe recipients",()=>{
    for (const bad of [null,undefined,42,"","023","0241112222,0241119999",
      "0241112222\\nBcc: attacker@example.com","447700900123",
      "0302112233","+123","+010123456789","+233\\r\\n0241112222"]) {
      expect(normalizeSupplierWhatsAppPhone(bad)).toBe(null);
    }
  });
  it("makes a short currency-correct message without claiming delivery or payment",()=>{
    const message=makeSupplierWhatsAppSummary({
      orderNumber:"PO-2026-100",businessName:"Accra Materials",
      branchName:"Main",supplierName:"A Supplier",
      currencyCode:"GHS",totalMinor:123456,expectedDate:"2026-11-19",
    });
    expect(message).toContain("₵1,234.56");
    expect(message).toContain("19/11/2026");
    expect(message).toContain("attach the full purchase-order PDF separately");
    expect(message).toContain("not confirmation of goods receipt or payment");
    expect(message.length).toBeLessThan(1800);
  });
  it("rejects invalid amounts and sanitizes message text",()=>{
    expect(()=>makeSupplierWhatsAppSummary({
      orderNumber:"PO",businessName:"Shop",branchName:"A",
      supplierName:"Supplier",currencyCode:"GHS",totalMinor:-1,expectedDate:null,
    })).toThrow();
    const safe=makeSupplierWhatsAppSummary({
      orderNumber:"PO\nfoo",businessName:"Shop\r\nInjected",
      branchName:"Branch",supplierName:"Supplier",
      currencyCode:"GHS",totalMinor:2500,expectedDate:null,
    });
    expect(safe).toContain("Shop Injected");
    expect(safe).not.toContain("Shop\r\nInjected");
  });
});
