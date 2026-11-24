import {describe,it,expect} from "vitest";
import type {FinancialSummaryReport,CreditAgingSide,CashForecastResponse} from "@tradeos/contracts";
import {canReadReports,canViewAllBranches,assertReportScope,reportOverview,agingBuckets,signedBar,verifyForecast} from "./report-workspace";
describe("native report presentation",()=>{
 it("limits report access and consolidated branch scope",()=>{
  expect(canReadReports("CASHIER")).toBe(false);expect(canReadReports("ACCOUNTANT")).toBe(true);expect(canReadReports("POS_ATTENDANT")).toBe(false);
  expect(canViewAllBranches("OWNER")).toBe(true);expect(canViewAllBranches("MANAGER")).toBe(false);
  const report={businessId:"b",branchId:"br",currencyCode:"GHS"};
  expect(assertReportScope(report,"b","br","GHS")).toBe(report);
  expect(()=>assertReportScope(report,"b",null,"GHS")).toThrow();
  expect(()=>assertReportScope(report,"other","br","GHS")).toThrow();
 });
 it("preserves server-calculated signed profit and rejects invalid amount",()=>{
  const r={flow:{netRevenueMinor:1500,grossProfitMinor:1000,operatingProfitMinor:-300,expenseMinor:1300}} as FinancialSummaryReport;
  expect(reportOverview(r).find(x=>x.label==="Operating profit")?.value).toBe(-300);
  expect(()=>reportOverview({...r,flow:{...r.flow,netRevenueMinor:NaN}})).toThrow();
  expect(signedBar(-50,100)).toBe(50);expect(signedBar(0,0)).toBe(0);
 });
 it("does not double-count overlapping due-within buckets in aging bars",()=>{
  const side={notDueMinor:50,dueWithin7DaysMinor:10,dueWithin30DaysMinor:30,overdue1To30DaysMinor:20,overdue31To60DaysMinor:10,overdue61To90DaysMinor:5,overdueOver90DaysMinor:15} as CreditAgingSide;
  expect(agingBuckets(side).reduce((sum,x)=>sum+x.value,0)).toBe(100);
 });
 it("rejects forecasts with wrong horizon",()=>{
  const r={horizonDays:7,days:Array(7).fill({})} as CashForecastResponse;
  expect(verifyForecast(r,7)).toBe(r);expect(()=>verifyForecast(r,14)).toThrow();
 });
});
