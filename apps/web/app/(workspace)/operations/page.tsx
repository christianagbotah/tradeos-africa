"use client";
import { OperationsReconciliation } from "../../components/operations-reconciliation";
import { DataCard } from "../../components/ui/data-card";
import { PageHeader } from "../../components/ui/page-header";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function OperationsPage() {
  const { context, branchId } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/operations")) return <div className="tradeos-page-stack"><PageHeader eyebrow="Operations" title="Day & shifts" subtitle="Branch operating-day and reconciliation controls." /><DataCard title="Read-only access"><p>Your role cannot open, close or reconcile operating days and shifts.</p></DataCard></div>;
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Operations" title="Day & shifts" subtitle="Open and close operating days, reconcile shifts and keep branch controls traceable." /><OperationsReconciliation staffId={context.membership.staffId} businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} /></div>;
}
