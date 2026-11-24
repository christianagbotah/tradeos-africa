import { getCurrencyMeta } from "@tradeos/contracts";

export interface DayReportBalance {
  method:string;openingCountedMinor:number;movementMinor:number;
  expectedClosingMinor:number;closingCountedMinor:number|null;
  varianceMinor:number|null;
}
export interface DayReportRow {
  id:string;businessDate:string;status:"OPEN"|"CLOSED";
  balances:readonly DayReportBalance[];
}
/**
 * CSV uses currency-specific decimal exponent; never divide blindly by 100.
 * It contains server-confirmed historical counts, not simulated balances.
 */
export function dayCloseReportCsv(days:readonly DayReportRow[],currencyCode:string):string {
  const currency=getCurrencyMeta(currencyCode);
  if(!currency)throw new Error("Unknown report currency.");
  const money=(minor:number|null):string=>{
    if(minor===null)return "";
    if(!Number.isSafeInteger(minor))throw new Error("Invalid report amount.");
    return (minor/10**currency.exponent).toFixed(currency.exponent);
  };
  const cols=[
    "Business date","Method",
    "Opening "+currency.symbol,"Movement "+currency.symbol,
    "Expected closing "+currency.symbol,"Actual counted "+currency.symbol,
    "Variance "+currency.symbol,
  ];
  const data=[cols];
  for(const day of days.filter(day=>day.status==="CLOSED")){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day.businessDate))throw new Error("Invalid business date.");
    for(const method of day.balances){
      if(!["CASH","MOMO","CARD","BANK","OTHER"].includes(method.method))
        throw new Error("Unknown payment method.");
      data.push([day.businessDate,method.method,
        money(method.openingCountedMinor),money(method.movementMinor),
        money(method.expectedClosingMinor),money(method.closingCountedMinor),
        money(method.varianceMinor)]);
    }
  }
  return "\uFEFF"+data.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(",")).join("\r\n")+"\r\n";
}
