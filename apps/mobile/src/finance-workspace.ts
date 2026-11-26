import type {MobileTreasuryAccount,MobileExpenseCategory,CustomerPaymentMethod} from "./api-client";
import {parseMinorAmount,paymentMethods} from "./customer-payment";
export const canReadFinance=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT","VIEWER"].includes(role);
export const canRecordExpense=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT"].includes(role);
export const canManageTreasury=(role:string)=>["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role);
export type FinanceTransaction={type:"EXPENSE_CREATE";payload:{moneyAccountId:string;method:CustomerPaymentMethod;categoryId:string;amountMinor:number;description:string;payee:string}}|{type:"MONEY_TRANSFER_CREATE";payload:{sourceAccountId:string;destinationAccountId:string;amountMinor:number;note:string}};
export function accountInScope(a:MobileTreasuryAccount,businessId:string,branchId:string,currencyCode:string){return a.businessId===businessId&&(!a.branchId||a.branchId===branchId)&&a.currencyCode===currencyCode&&a.active&&paymentMethods.includes(a.method as CustomerPaymentMethod);}
export function expenseInput(account:MobileTreasuryAccount,category:MobileExpenseCategory,amount:string,description:string,payee:string,businessId:string,branchId:string,currencyCode:string):FinanceTransaction{
 const amountMinor=parseMinorAmount(amount);
 if(!accountInScope(account,businessId,branchId,currencyCode)||!category.active||(!description.trim()&&!payee.trim())||description.length>1000||payee.length>1000)throw new Error("Select an active account and category, and enter a description or payee.");
 if(!account.allowNegative&&amountMinor>account.balanceMinor)throw new Error("Insufficient balance in the selected account.");
 return {type:"EXPENSE_CREATE",payload:{moneyAccountId:account.id,method:account.method as CustomerPaymentMethod,categoryId:category.id,amountMinor,description:description.trim(),payee:payee.trim()}};
}
export function transferInput(source:MobileTreasuryAccount,destination:MobileTreasuryAccount,amount:string,note:string,businessId:string,branchId:string,currencyCode:string):FinanceTransaction{
 const amountMinor=parseMinorAmount(amount);
 if(source.id===destination.id||![source,destination].every(a=>accountInScope(a,businessId,branchId,currencyCode))||!note.trim()||note.length>1000)throw new Error("Select two different active accounts and enter a transfer reference.");
 if(!source.allowNegative&&amountMinor>source.balanceMinor)throw new Error("Insufficient source account balance.");
 return {type:"MONEY_TRANSFER_CREATE",payload:{sourceAccountId:source.id,destinationAccountId:destination.id,amountMinor,note:note.trim()}};
}
