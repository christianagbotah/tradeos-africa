import {describe,it,expect} from "vitest";
import {canReadFinance,canRecordExpense,canManageTreasury,expenseInput,transferInput} from "./finance-workspace";
import type {MobileTreasuryAccount,MobileExpenseCategory} from "./api-client";
const account={id:"a",businessId:"b",branchId:"br",method:"CASH",currencyCode:"GHS",active:true,balanceMinor:2000,allowNegative:false} as MobileTreasuryAccount;
const category={id:"c",active:true} as MobileExpenseCategory;
describe("native finance",()=>{
 it("matches backend role boundaries",()=>{
  expect(canReadFinance("VIEWER")).toBe(true);
  expect(canRecordExpense("CASHIER")).toBe(true);
  expect(canManageTreasury("CASHIER")).toBe(false);
  expect(canReadFinance("POS_ATTENDANT")).toBe(false);
 });
 it("records expense against selected category and account with exact minor amount",()=>{
  expect(expenseInput(account,category,"12.30","Transport","","b","br","GHS")).toMatchObject({type:"EXPENSE_CREATE",payload:{categoryId:"c",moneyAccountId:"a",amountMinor:1230,description:"Transport"}});
  expect(()=>expenseInput(account,category,"20.01","Transport","","b","br","GHS")).toThrow();
  expect(()=>expenseInput(account,{...category,active:false},"1","Transport","","b","br","GHS")).toThrow();
 });
 it("requires distinct same-scope accounts and adequate funds",()=>{
  const destination={...account,id:"d",method:"BANK"};
  expect(transferInput(account,destination,"10","deposit","b","br","GHS").payload).toMatchObject({sourceAccountId:"a",destinationAccountId:"d",amountMinor:1000});
  expect(()=>transferInput(account,account,"1","deposit","b","br","GHS")).toThrow();
  expect(()=>transferInput(account,{...destination,businessId:"other"},"1","deposit","b","br","GHS")).toThrow();
 });
});
