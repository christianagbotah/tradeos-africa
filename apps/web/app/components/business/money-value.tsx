import React from "react";
import { minorToMajor, getCurrencyMeta } from "@tradeos/contracts";

export function MoneyValue({minor,currencyCode,sign="auto",emphasis="default"}:{minor:number;currencyCode:string;sign?:"auto"|"always"|"never";emphasis?:"default"|"strong"|"hero"}){
  const meta=getCurrencyMeta(currencyCode);
  const value=minorToMajor(minor,currencyCode);
  const text=meta && value!==null
    ? new Intl.NumberFormat(meta.locale,{style:"currency",currency:currencyCode,currencyDisplay:currencyCode==="GHS"?"narrowSymbol":"code",minimumFractionDigits:meta.decimalPlaces,maximumFractionDigits:meta.decimalPlaces,signDisplay:sign}).format(value).replace("GH₵","₵")
    : `${currencyCode.toUpperCase()} ${minor}`;
  return <span className={`tos-money-value tos-money-value--${emphasis}`} data-currency={currencyCode}>{text}</span>;
}
