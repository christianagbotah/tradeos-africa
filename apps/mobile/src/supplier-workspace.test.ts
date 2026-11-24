import {describe,it,expect} from "vitest";
import {supplierInput,purchaseInput,supplierPayment,canManageSuppliers,canPaySuppliers} from "./supplier-workspace";
import type {MobileSupplier,MobileCatalogItem} from "./api-client";
const supplier={id:"s",active:true,balanceMinor:1000} as MobileSupplier;
const item={id:"i",businessId:"b",active:true,kind:"PRODUCT",trackStock:true,units:[{code:"box",canPurchase:true}]} as MobileCatalogItem;
describe("native suppliers",()=>{
 it("preserves role restrictions on payment terms",()=>{
 const draft={name:"Supplier",phone:"",email:"",address:"",terms:"30"};
 expect(supplierInput(draft,"INVENTORY")).not.toHaveProperty("paymentTermsDays");
 expect(supplierInput(draft,"ACCOUNTANT")).toHaveProperty("paymentTermsDays",30);
 expect(canManageSuppliers("CASHIER")).toBe(false);expect(canPaySuppliers("INVENTORY")).toBe(false);
 });
 it("uses eligible purchase units and exact unit cost",()=>{
 const lines=[{itemId:"i",purchaseUnitCode:"box",quantity:"2",cost:"12.34"}];
 expect(purchaseInput(supplier,lines,[item],"b","invoice","SUPPLIER_CREDIT").payload).toMatchObject({lines:[{itemId:"i",purchaseUnitCode:"box",quantity:2,unitCostMinor:1234}]});
 expect(()=>purchaseInput(supplier,lines,[item],"b","","CASH")).toThrow();
 expect(()=>purchaseInput(supplier,lines,[item],"other","","SUPPLIER_CREDIT")).toThrow();
 });
 it("prevents overpayment and requires a paying account",()=>{
 expect(()=>supplierPayment(supplier,"10.01","CASH","a","")).toThrow();
 expect(()=>supplierPayment(supplier,"10","CASH","","")).toThrow();
 expect(supplierPayment(supplier,"10","CASH","a","ref").payload).toMatchObject({amountMinor:1000,moneyAccountId:"a"});
 });
});
