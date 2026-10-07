"use client";
import { OperationsReconciliation } from "../../components/operations-reconciliation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function OperationsPage() {
  const { context, branchId } = useWorkspace();
  return <OperationsReconciliation staffId={context.membership.staffId} businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} />;
}
