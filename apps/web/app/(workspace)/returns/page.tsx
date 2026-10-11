"use client";
import { SalesAndReturns } from "../../components/sales-returns";
import { ZaiAccessState } from "../../components/ui/zai-access-state";
import { ZaiRouteHeader } from "../../components/ui/zai-route-header";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function ReturnsPage() {
  const { context, branchId, sellableItems } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/returns")) return <ZaiAccessState kicker="Customer recovery" title="Returns & refunds" message="Your role can review sales but cannot process returns or refunds." />;
  return <section className="zai-route-view"><ZaiRouteHeader kicker="Customer recovery" title="Returns & refunds" subtitle="Process protected returns, refunds and stock dispositions against the original sale." /><SalesAndReturns businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} sellableItems={sellableItems} view="returns" /></section>;
}
