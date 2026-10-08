"use client";
import { FinancialReports } from "../../components/financial-reports";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function ReportsPage() {
  const { context, branchId, activeBranch } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Insights" title="Reports & intelligence" subtitle="Understand revenue, profit, working capital, cash forecasts and business health." /><FinancialReports businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} businessTimezone={context.business.timezone} branchTimezone={activeBranch.timezone} view="reports" /></div>;
}
