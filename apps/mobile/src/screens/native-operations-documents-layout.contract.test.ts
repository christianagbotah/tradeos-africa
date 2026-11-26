import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const read=(name:string)=>readFileSync(resolve(__dirname,name),"utf8");
const operations=read("OperationsScreen.tsx"),documents=read("DocumentsScreen.tsx");
describe("native operations and documents layout safeguards",()=>{
 it("retains actual count and closing interlocks",()=>{
  expect(operations).toContain("Count actual balances for every payment method.");
  expect(operations).toContain("Confirm actual closing counts.");
  expect(operations).toContain("current.openShiftCount>0||!!current.shift");
  expect(operations).toContain("paymentMethods.map(method=>");
 });
 it("preserves document scope, draft retry and issue confirmation",()=>{
  expect(documents).toContain("documentMatchesScope(");
  expect(documents).toContain("Draft documents do not post sales or deduct stock.");
  expect(documents).toContain("Retry same draft");
  expect(documents).toContain("Issued documents cannot be edited.");
  expect(documents).toContain("<PdfDeliveryPanel");
 });
});
