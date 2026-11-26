import type {FinancialSummaryReport,CreditAgingReport,CashForecastResponse,CreditAgingSide} from "@tradeos/contracts";
export const canReadReports=(role:string)=>["OWNER","ADMIN","MANAGER","ACCOUNTANT","VIEWER"].includes(role);
export const canViewAllBranches=(role:string)=>["OWNER","ADMIN"].includes(role);
export const reportRanges=[{key:"today",label:"Today"},{key:"yesterday",label:"Yesterday"},{key:"week",label:"This week"},{key:"last_week",label:"Last week"},{key:"month",label:"This month"},{key:"last_month",label:"Last month"},{key:"quarter",label:"This quarter"}] as const;
export type ReportRange=typeof reportRanges[number]["key"];
export const forecastHorizons=[7,14,30] as const;
export function assertReportScope<T extends {businessId:string;branchId:string|null;currencyCode:string}>(r:T,businessId:string,branchId:string|null,currencyCode:string):T{
 if(!r||r.businessId!==businessId||r.branchId!==branchId||r.currencyCode!==currencyCode)throw new Error("Report scope could not be verified.");
 return r;
}
function checkMinor(n:number){if(!Number.isSafeInteger(n))throw new Error("Report amount is unavailable or invalid.");return n;}
export function reportOverview(r:FinancialSummaryReport){
 return [{label:"Net revenue",value:checkMinor(r.flow.netRevenueMinor)},{label:"Gross profit",value:checkMinor(r.flow.grossProfitMinor)},{label:"Operating profit",value:checkMinor(r.flow.operatingProfitMinor)},{label:"Expenses",value:checkMinor(r.flow.expenseMinor)}];
}
export function agingBuckets(side:CreditAgingSide){
 return [{label:"Not due",value:checkMinor(side.notDueMinor)},{label:"1–30 days overdue",value:checkMinor(side.overdue1To30DaysMinor)},{label:"31–60 days overdue",value:checkMinor(side.overdue31To60DaysMinor)},{label:"61–90 days overdue",value:checkMinor(side.overdue61To90DaysMinor)},{label:"Over 90 days overdue",value:checkMinor(side.overdueOver90DaysMinor)}];
}
export function verifyForecast(r:CashForecastResponse,horizon:number){
 if(r.horizonDays!==horizon||r.days.length!==horizon)throw new Error("Forecast horizon differs from requested period.");
 return r;
}
export function signedBar(value:number,max:number){return Math.max(0,Math.min(100,Math.abs(checkMinor(value))/Math.max(1,max)*100));}
export type ReportData=FinancialSummaryReport|CreditAgingReport|CashForecastResponse;
