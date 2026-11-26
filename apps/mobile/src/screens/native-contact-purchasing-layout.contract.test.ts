import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const read=(name:string)=>readFileSync(new URL("./"+name,import.meta.url),"utf8");
const customer=read("CustomersScreen.tsx"), supplier=read("SuppliersScreen.tsx"), orders=read("PurchaseOrdersScreen.tsx");
describe("native contact and purchasing layout contracts",()=>{
 it("retains authorized customer management and uncertainty handling",()=>{
  expect(customer).toContain("canReadCustomers(role)");
  expect(customer).toContain("canEditCustomer(role)");
  expect(customer).toContain("uncertainCreate");
  expect(customer).toContain("Review directory before creating again");
  expect(customer).toContain("<CustomerFinancePanel");
 });
 it("retains supplier payment and physical goods confirmation safeguards",()=>{
  expect(supplier).toContain("canPaySuppliers(role)");
  expect(supplier).toContain("canManageSuppliers(role)");
  expect(supplier).toContain("Confirm goods were received.");
  expect(supplier).toContain("Confirm funds have already been paid.");
  expect(supplier).toContain("if(!review||!online||lock.current)return");
  expect(supplier).toContain("<PurchaseReturnPanel");
 });
 it("preserves scoped orders, identical retries and explicit linked receipt confirmation",()=>{
  expect(orders).toContain("orderScope(r.order,businessId,branchId)");
  expect(orders).toContain("Crypto.randomUUID()");
  expect(orders).toContain("Retry identical draft");
  expect(orders).toContain("linkedReceipt(order,received,reference)");
  expect(orders).toContain("Only confirm goods physically received.");
  expect(orders).toContain("Do not submit again");
 });
});
