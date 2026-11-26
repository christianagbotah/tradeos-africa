import type {CustomerPaymentMethod,MobileMoneyAccount,MobileMoneyDefault} from "./api-client";
export const paymentMethods:readonly CustomerPaymentMethod[]=["CASH","MOMO","CARD","BANK","OTHER"];
export const canCollectCustomerPayment=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT"].includes(role);
export const canControlCustomerCredit=(role:string)=>["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role);
export type CustomerReceiptInput={customerId:string;amountMinor:number;method:CustomerPaymentMethod;moneyAccountId:string};
export type ReceiptOutcome="SYNCED"|"PENDING"|"NEEDS_REVIEW";
export function parseMinorAmount(text:string,allowZero=false):number{
  const value=text.trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error("Enter an amount with up to two decimal places.");
  const [whole,fraction=""]=value.split(".");
  const minor=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  if(!Number.isSafeInteger(minor)||minor<(allowZero?0:1))throw new Error("Enter a valid amount.");
  return minor;
}
export function eligibleCustomerAccounts(accounts:readonly MobileMoneyAccount[],businessId:string,branchId:string,method:string,currencyCode:string){
  return accounts.filter(a=>a.businessId===businessId&&(a.branchId===null||a.branchId===branchId)&&a.active&&a.method===method&&a.currencyCode===currencyCode);
}
export function preferredAccount(accounts:readonly MobileMoneyAccount[],defaults:readonly MobileMoneyDefault[],branchId:string,method:string){
  const configured=defaults.find(d=>d.branchId===branchId&&d.method===method);
  if(configured&&accounts.some(a=>a.id===configured.moneyAccountId))return configured.moneyAccountId;
  return accounts.length===1?accounts[0]!.id:null;
}
export function creditTerms(text:string){
  const value=text.trim();
  if(!/^\d+$/.test(value)||Number(value)>3650)throw new Error("Enter credit terms from 0 to 3650 days.");
  return Number(value);
}
