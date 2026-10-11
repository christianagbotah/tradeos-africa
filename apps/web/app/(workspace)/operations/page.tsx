"use client";
import { OperationsReconciliation } from "../../components/operations-reconciliation";
import { ZaiAccessState } from "../../components/ui/zai-access-state";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function OperationsPage() {
  const { context, branchId } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/operations")) return <ZaiAccessState kicker="Operations" title="Day & shifts" message="Your role cannot open, close or reconcile operating days and shifts." />;
  return <OperationsReconciliation staffId={context.membership.staffId} businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} />;
}
