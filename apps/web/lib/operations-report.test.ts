import {describe,expect,it} from "vitest";
import {dayCloseReportCsv} from "./operations-report";
const report={
  id:"day-1",businessDate:"2026-11-24",status:"CLOSED" as const,
  balances:[
    {method:"CASH",openingCountedMinor:5000,movementMinor:1000,
      expectedClosingMinor:6000,closingCountedMinor:5900,varianceMinor:-100},
    {method:"MOMO",openingCountedMinor:0,movementMinor:1500,
      expectedClosingMinor:1500,closingCountedMinor:1500,varianceMinor:0},
  ],
};
describe("server-confirmed day close report export",()=>{
  it("uses Ghana symbol, 2-decimal values and retains shortages",()=>{
    const csv=dayCloseReportCsv([report],"GHS");
    expect(csv).toContain("₵");
    expect(csv).toContain('"2026-11-24","CASH","50.00","10.00","60.00","59.00","-1.00"');
    expect(csv).toContain('"2026-11-24","MOMO","0.00","15.00","15.00","15.00","0.00"');
    expect(csv).not.toContain("day-1");
  });
  it("uses country-specific minor exponent (UGX no decimals, TND 3)",()=>{
    expect(dayCloseReportCsv([report],"UGX")).toContain('"5000","1000","6000","5900","-100"');
    expect(dayCloseReportCsv([report],"TND")).toContain('"5.000","1.000","6.000","5.900","-0.100"');
  });
  it("never reports an OPEN day as completed",()=>{
    expect(dayCloseReportCsv([{...report,status:"OPEN"}],"GHS").split("\r\n").length).toBe(2);
  });
  it("rejects malformed dates, methods and monetary values",()=>{
    expect(()=>dayCloseReportCsv([{...report,businessDate:"=HYPERLINK()"}],"GHS")).toThrow();
    expect(()=>dayCloseReportCsv([{...report,balances:[{...report.balances[0]!,method:"=SUM()"}]}],"GHS")).toThrow();
    expect(()=>dayCloseReportCsv([{...report,balances:[{...report.balances[0]!,movementMinor:NaN}]}],"GHS")).toThrow();
  });
});
