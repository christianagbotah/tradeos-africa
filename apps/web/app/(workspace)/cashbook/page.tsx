"use client";
import { CashbookExpenses } from "../../components/cashbook-expenses";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function CashbookPage() {
  const { context, branchId } = useWorkspace();
  return <CashbookExpenses businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} />;
}
