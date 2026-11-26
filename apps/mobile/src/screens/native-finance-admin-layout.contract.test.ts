import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const read=(name:string)=>readFileSync(resolve(__dirname,name),"utf8");
const finance=read("FinanceScreen.tsx"),reports=read("ReportsScreen.tsx"),admin=read("BusinessAdminScreen.tsx"),provider=read("ProviderSettingsScreen.tsx");
describe("native finance and administration layout safeguards",()=>{
 it("retains posted-money confirmation and distinguishes movements from balances",()=>{
  expect(finance).toContain("canReadFinance(role)");
  expect(finance).toContain("canRecordExpense(role)");
  expect(finance).toContain("if(!review||!online||lock.current)return");
  expect(finance).toContain("Confirm the real-world payment has occurred.");
  expect(finance).toContain("Net branch movement is not the same as account balance or profit.");
  expect(finance).toContain("<TreasuryPanel");
 });
 it("retains report scope and forecast caveats",()=>{
  expect(reports).toContain("assertReportScope(await api.getFinancialReport");
  expect(reports).toContain("verifyForecast(assertReportScope");
  expect(reports).toContain("not a statutory full income statement");
  expect(reports).toContain("not guaranteed cash receipts");
 });
 it("preserves access confirmation and credential restrictions",()=>{
  expect(admin).toContain("canDeactivateBranch(target,context.branches,branchId)");
  expect(admin).toContain("if(!confirm||!manage||!online||lock.current||!context)return");
  expect(admin).toContain("Share only with the intended staff member");
  expect(provider).toContain("canManageProviders(role)");
  expect(provider).toContain("secureTextEntry={f.secret}");
  expect(provider).toContain("if(!action||!canAction(action)||lock.current)return");
  expect(provider).toContain("does not enable live collection");
 });
});
