"use client";
import { OperationsReconciliation } from "../../components/operations-reconciliation";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function OperationsPage() {
  const { context, branchId } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Operations" title="Day & shifts" subtitle="Open and close operating days, reconcile shifts and keep branch controls traceable." /><OperationsReconciliation staffId={context.membership.staffId} businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} /></div>;
}
