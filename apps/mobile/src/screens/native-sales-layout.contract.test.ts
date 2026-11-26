import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const read=(name:string)=>readFileSync(new URL("./"+name,import.meta.url),"utf8");
const sales=read("SalesScreen.tsx"), history=read("PostedSalesHistory.tsx"), pdf=read("PdfDeliveryPanel.tsx");

describe("native sales and receipt presentation contracts",()=>{
 it("keeps all queue counters, synchronization interlock and branch-scoped history",()=>{
  for(const counter of ["queue.pending","queue.blocked","queue.failed"]) expect(sales).toContain(counter);
  expect(sales).toContain("snapshot.syncing || snapshot.online !== true || queue.pending === 0");
  expect(sales).toContain("ready.user.id");
  expect(sales).toContain("branchId={ready.branch.id}");
  expect(history).toContain("saleMatchesScope(result.sale,businessId,branchId,saleId)");
  expect(history).toContain("canReadSalesHistory(role)");
 });
 it("retains receipt availability, reversal permissions and real PDF handoff",()=>{
  expect(history).toContain("receiptAvailable(detail)");
  expect(history).toContain("canReverseSale(role)");
  expect(pdf).toContain("pdfPapers.map");
  expect(pdf).toContain("if(!online||disabled||lock.current)return");
  expect(pdf).toContain("api.downloadDocumentPdf(kind,businessId,branchId,id,paper)");
  expect(pdf).toContain("Print.printAsync({uri:file.uri})");
  expect(pdf).toContain('mimeType:"application/pdf"');
  expect(pdf).toContain('disabled={unavailable}');
 });
});
