import React from "react";
import { minorToMajor, getCurrencyMeta } from "@tradeos/contracts";

export function MoneyValue({minor,currencyCode,sign="auto",emphasis="default"}:{minor:number;currencyCode:string;sign?:"auto"|"always"|"never";emphasis?:"default"|"strong"|"hero"}){
  const meta=getCurrencyMeta(currencyCode);
  const value=meta?minorToMajor(minor,currencyCode)??0:minor/100;
  const text=new Intl.NumberFormat(meta?.locale??"en-GH",{style:"currency",currency:currencyCode,currencyDisplay:currencyCode==="GHS"?"narrowSymbol":"code",minimumFractionDigits:meta?.decimalPlaces??2,maximumFractionDigits:meta?.decimalPlaces??2,signDisplay:sign}).format(value).replace("GH₵","₵");
  return <span className={`tos-money-value tos-money-value--${emphasis}`} data-currency={currencyCode}>{text}</span>;
}
