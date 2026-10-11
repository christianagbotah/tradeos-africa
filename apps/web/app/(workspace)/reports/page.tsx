"use client";
import { FinancialReports } from "../../components/financial-reports";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function ReportsPage() {
  const { context, branchId, activeBranch } = useWorkspace();
  return <FinancialReports businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} businessTimezone={context.business.timezone} branchTimezone={activeBranch.timezone} view="reports" />;
}
