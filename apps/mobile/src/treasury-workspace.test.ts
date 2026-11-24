import {describe,it,expect} from "vitest";
import {accountDraft,reconciliationInput,resolutionInput} from "./treasury-workspace";
import type {MobileTreasuryAccount,MobileReconciliation} from "./api-client";
const account={id:"a",businessId:"b",branchId:"br",currencyCode:"GHS",method:"CASH",kind:"CASH_DRAWER",active:true,balanceMinor:1000} as MobileTreasuryAccount;
const cutoff="2026-11-24T12:00:00.000Z";
const now=Date.parse("2026-11-24T13:00:00.000Z");
describe("native treasury configuration",()=>{
 it("maps account methods to their correct account kinds",()=>{
  expect(accountDraft({name:" MTN ",method:"MOMO",provider:"MTN",referenceLabel:"",allowNegative:false,shared:false},"br","GHS")).toMatchObject({name:"MTN",kind:"MOMO_WALLET",branchId:"br",allowNegative:false});
  expect(accountDraft({name:" Bank ",method:"BANK",provider:"",referenceLabel:"",allowNegative:false,shared:true},"br","GHS")).toMatchObject({kind:"BANK_ACCOUNT",branchId:null});
 });
 it("allows only scoped drawer counts for cashiers and prevents negative cash",()=>{
  expect(reconciliationInput(account,"12.34","CASH_COUNT",cutoff,cutoff,"","CASHIER","b","br","GHS",now)).toMatchObject({type:"MONEY_RECONCILIATION_CREATE",payload:{observedBalanceMinor:1234,moneyAccountId:"a"}});
  expect(()=>reconciliationInput({...account,branchId:null},"1","CASH_COUNT",cutoff,cutoff,"","CASHIER","b","br","GHS",now)).toThrow();
  expect(()=>reconciliationInput(account,"-1","CASH_COUNT",cutoff,cutoff,"","OWNER","b","br","GHS",now)).toThrow();
  expect(()=>reconciliationInput(account,"1","CASH_COUNT",cutoff,"2026-11-25T00:00:00Z","","OWNER","b","br","GHS",now)).toThrow();
 });
 it("supports signed statement balances and manager-only variance resolution",()=>{
  expect(reconciliationInput({...account,method:"BANK",kind:"BANK_ACCOUNT"},"-12.34","STATEMENT",cutoff,cutoff,"","ACCOUNTANT","b","br","GHS",now)).toMatchObject({payload:{observedBalanceMinor:-1234}});
  const r={id:"r",branchId:"br",status:"VARIANCE"} as MobileReconciliation;
  expect(resolutionInput(r,"Checked evidence","MANAGER","br")).toMatchObject({type:"MONEY_RECONCILIATION_RESOLVE",payload:{reconciliationId:"r"}});
  expect(()=>resolutionInput(r,"Checked evidence","CASHIER","br")).toThrow();
  expect(()=>resolutionInput({...r,status:"RESOLVED"},"Checked","OWNER","br")).toThrow();
 });
});
