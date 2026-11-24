import type {MobileAccountDraft,MobileTreasuryAccount,MobileReconciliation,CustomerPaymentMethod} from "./api-client";
import {canManageTreasury,canRecordExpense,accountInScope} from "./finance-workspace";
import {parseMinorAmount,paymentMethods} from "./customer-payment";
export const kindByMethod={CASH:"CASH_DRAWER",MOMO:"MOMO_WALLET",CARD:"CARD_CLEARING",BANK:"BANK_ACCOUNT",OTHER:"OTHER"} as const;
export type TreasuryTransaction={type:"MONEY_RECONCILIATION_CREATE";payload:{moneyAccountId:string;type:"CASH_COUNT"|"STATEMENT";periodStart:string;periodEnd:string;observedBalanceMinor:number;note:string}}|{type:"MONEY_RECONCILIATION_RESOLVE";payload:{reconciliationId:string;note:string}};
export function accountDraft(input:{name:string;method:CustomerPaymentMethod;provider:string;referenceLabel:string;allowNegative:boolean;shared:boolean},branchId:string,currencyCode:string):MobileAccountDraft{
 const name=input.name.trim(),provider=input.provider.trim(),referenceLabel=input.referenceLabel.trim();
 if(!name||name.length>160||provider.length>300||referenceLabel.length>300||!paymentMethods.includes(input.method))throw new Error("Check account name, method and reference details.");
 return {name,method:input.method,kind:kindByMethod[input.method],provider:provider||null,referenceLabel:referenceLabel||null,allowNegative:input.allowNegative,branchId:input.shared?null:branchId,currencyCode};
}
export function reconciliationInput(account:MobileTreasuryAccount,observed:string,type:"CASH_COUNT"|"STATEMENT",start:string,end:string,note:string,role:string,businessId:string,branchId:string,currencyCode:string,now=Date.now()):TreasuryTransaction{
 if(!canRecordExpense(role)||!accountInScope(account,businessId,branchId,currencyCode)||!["CASH_COUNT","STATEMENT"].includes(type))throw new Error("Choose an authorized account.");
 if(type==="CASH_COUNT"&&(account.method!=="CASH"||account.kind!=="CASH_DRAWER")||role==="CASHIER"&&(type!=="CASH_COUNT"||account.branchId!==branchId))throw new Error("Cash counts require an authorized cash drawer.");
 const a=Date.parse(start),b=Date.parse(end);
 if(!Number.isFinite(a)||!Number.isFinite(b)||a>b||b>now||note.length>1000)throw new Error("Enter a valid reconciliation period ending no later than now.");
 const raw=observed.trim(),negative=raw.startsWith("-");
 if(negative&&type==="CASH_COUNT")throw new Error("Cash count cannot be negative.");
 const observedBalanceMinor=parseMinorAmount(negative?raw.slice(1):raw,true)*(negative?-1:1);
 return {type:"MONEY_RECONCILIATION_CREATE",payload:{moneyAccountId:account.id,type,periodStart:new Date(a).toISOString(),periodEnd:new Date(b).toISOString(),observedBalanceMinor,note:note.trim()}};
}
export function resolutionInput(row:MobileReconciliation,note:string,role:string,branchId:string):TreasuryTransaction{
 if(!canManageTreasury(role)||row.branchId!==branchId||row.status!=="VARIANCE"||!note.trim()||note.length>1000)throw new Error("Only managers can resolve an outstanding variance with an explanation.");
 return {type:"MONEY_RECONCILIATION_RESOLVE",payload:{reconciliationId:row.id,note:note.trim()}};
}
