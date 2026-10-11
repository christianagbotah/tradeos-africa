"use client";
import { PosWorkspace } from "../../components/pos/pos-workspace";
import { ZaiAccessState } from "../../components/ui/zai-access-state";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function SellPage() {
  const { context, branchId, sellableItems } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/sell")) return <ZaiAccessState kicker="Commerce" title="Sell / POS" message="Your role can review business information but cannot create sales." />;
  return <div className="pos-route-page"><h1 className="sr-only">Sell / POS</h1><PosWorkspace businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} items={sellableItems} /></div>;
}
