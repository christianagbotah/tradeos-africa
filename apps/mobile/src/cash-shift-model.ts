import {getCurrencyMeta} from "@tradeos/contracts";
import type {MobileOwnCashShiftStatus} from "./api-client";

/** Parse decimal cash exactly, without binary floating point or hardcoded /100. */
export function parseCashShiftMinor(text:string,currencyCode:string):number|null{
  const meta=getCurrencyMeta(currencyCode);
  if(!meta)return null;
  const match=/^([0-9]+)(?:\.([0-9]+))?$/.exec(text.trim());
  if(!match)return null;
  const decimals=match[2]??"";
  if(decimals.length>meta.exponent)return null;
  const scale=10n**BigInt(meta.exponent);
  const amount=BigInt(match[1]!)*scale+
    BigInt((decimals.padEnd(meta.exponent,"0"))||"0");
  if(amount>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return Number(amount);
}

/** Render actual currency exponent including Ghana cedi's native ₵ symbol. */
export function formatCashShiftMinor(minor:number,currencyCode:string):string{
  const meta=getCurrencyMeta(currencyCode);
  if(!meta||!Number.isSafeInteger(minor))return "Amount unavailable";
  const magnitude=new Intl.NumberFormat(meta.locale,{
    minimumFractionDigits:meta.exponent,maximumFractionDigits:meta.exponent,
  }).format(Math.abs(minor)/10**meta.exponent);
  return (minor<0?"-":"")+meta.symbol+magnitude;
}

export function ownShiftCashExpected(status:MobileOwnCashShiftStatus|null):number|null{
  return status?.shift?.balances.find(balance=>balance.method==="CASH")
    ?.expectedClosingMinor??null;
}

export function cashShiftConfirmationValid(
  status:MobileOwnCashShiftStatus|null,countedMinor:number|null,online:boolean,
):boolean{
  return online&&status?.operatingDay?.status==="OPEN"&&countedMinor!==null&&
    Number.isSafeInteger(countedMinor)&&countedMinor>=0;
}
