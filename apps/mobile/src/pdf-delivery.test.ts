import {describe,it,expect} from "vitest";
import {pdfFileName,receiptAvailable} from "./pdf-delivery";
describe("native PDF delivery",()=>{
 it("restricts paper sizes and generates a safe PDF filename",()=>{
  expect(pdfFileName("receipt","b8fe8921-08a7-423c-b2eb-947beec01acd","58mm")).toBe("TradeOS-Receipt-b8fe8921-58mm.pdf");
  expect(()=>pdfFileName("document","../../secret","A5")).toThrow();
 });
 it("only enables receipts for posted sales with no pending payments",()=>{
  const sale={status:"COMPLETED",completedAt:"2026-11-25T00:00:00Z",lines:[{}],payments:[{status:"SUCCEEDED"}]};
  expect(receiptAvailable(sale)).toBe(true);
  expect(receiptAvailable({...sale,status:"OPEN"})).toBe(false);
  expect(receiptAvailable({...sale,payments:[{status:"PENDING"}]})).toBe(false);
 });
});
