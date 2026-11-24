import type {MobileOperationsCurrent,MobileOperationInterval,CustomerPaymentMethod} from "./api-client";
import {parseMinorAmount,paymentMethods} from "./customer-payment";
export const canReadOperations=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT","VIEWER"].includes(role);
export const canManageDays=(role:string)=>["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role);
export const canManageOwnShift=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT"].includes(role);
export const canChangeShiftPolicy=(role:string)=>["OWNER","ADMIN"].includes(role);
export type OperationAction="OPERATING_DAY_OPEN_CREATE"|"OPERATING_DAY_CLOSE_CREATE"|"SHIFT_OPEN_CREATE"|"SHIFT_CLOSE_CREATE";
type Count={method:CustomerPaymentMethod;countedMinor:number};
export type OperationTransaction={type:OperationAction;payload:{businessDate?:string;dayId?:string;shiftId?:string;note?:string;openingBalances?:Count[];closingBalances?:Count[]}};
export function blankCounts():Record<CustomerPaymentMethod,string>{return {CASH:"",MOMO:"",CARD:"",BANK:"",OTHER:""};}
export function inOperationScope(r:MobileOperationInterval,businessId:string,branchId:string){return r.businessId===businessId&&r.branchId===branchId;}
export function branchBusinessDate(timezone:string,now=new Date()){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 return ["year","month","day"].map(k=>parts.find(p=>p.type===k)?.value).join("-");
}
export function operationInput(type:OperationAction,current:MobileOperationsCurrent,counts:Record<CustomerPaymentMethod,string>,businessDate:string,note:string,role:string,businessId:string,branchId:string):OperationTransaction{
 const day=type.startsWith("OPERATING_DAY"),close=type.includes("CLOSE");
 if(day?!canManageDays(role):!canManageOwnShift(role))throw new Error("Your role cannot perform this action.");
 if(note.length>1000)throw new Error("Keep the handover note within 1000 characters.");
 if([current.operatingDay,current.shift].some(x=>x&&!inOperationScope(x,businessId,branchId)))throw new Error("Refresh the selected branch.");
 const balances=paymentMethods.map(method=>({method,countedMinor:parseMinorAmount(counts[method],true)}));
 if(type==="OPERATING_DAY_OPEN_CREATE"){
  if(current.operatingDay||!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)||!Number.isFinite(Date.parse(businessDate))||new Date(businessDate).toISOString().slice(0,10)!==businessDate)throw new Error("An open day already exists or the business date is invalid.");
  return {type,payload:{businessDate,openingBalances:balances,note:note.trim()}};
 }
 if(!current.operatingDay||current.operatingDay.status!=="OPEN")throw new Error("Open the business day first.");
 if(type==="OPERATING_DAY_CLOSE_CREATE"){
  if(current.openShiftCount!==0||current.shift)throw new Error("Close every open staff shift before closing the day.");
  return {type,payload:{dayId:current.operatingDay.id,closingBalances:balances,note:note.trim()}};
 }
 if(type==="SHIFT_OPEN_CREATE"){
  if(current.shift)throw new Error("Your shift is already open.");
  return {type,payload:{dayId:current.operatingDay.id,openingBalances:balances,note:note.trim()}};
 }
 if(!close||!current.shift||current.shift.status!=="OPEN"||current.shift.operatingDayId!==current.operatingDay.id)throw new Error("No verified open personal shift.");
 return {type,payload:{shiftId:current.shift.id,closingBalances:balances,note:note.trim()}};
}
