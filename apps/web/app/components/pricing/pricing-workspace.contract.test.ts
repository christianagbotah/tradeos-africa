import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const ui=readFileSync(fileURLToPath(new URL("./pricing-workspace.tsx",import.meta.url)),"utf8");
const checkout=readFileSync(fileURLToPath(new URL("../pos/checkout-sheet.tsx",import.meta.url)),"utf8");
describe("customer pricing controls",()=>{
 it("exposes negotiated prices and approval reviews",()=>{
  expect(ui).toContain("Customer-specific prices");
  expect(ui).toContain("Request one-time discount");
  expect(ui).toContain("/v1/pricing/customer-rates");
  expect(ui).toContain("/v1/pricing/discount-requests");
  expect(ui).toContain("setInterval");
 });
 it("requires a current server quote and a valid approval before charging",()=>{
  expect(checkout).toContain("/v1/pricing/quote");
  expect(checkout).toContain("quoteReady&&approvalValid");
  expect(checkout).toContain("expectedUnitPriceMinor");
  expect(checkout).toContain("priceApprovalId");
 });
});
