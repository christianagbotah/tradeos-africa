"use client";
import { PosWorkspace } from "../../components/pos/pos-workspace";
import { DataCard } from "../../components/ui/data-card";
import { PageHeader } from "../../components/ui/page-header";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function SellPage() {
  const { context, branchId, sellableItems } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/sell")) return <div className="tradeos-page-stack"><PageHeader eyebrow="Commerce" title="Sell / POS" subtitle="Fast counter selling with server pricing and offline-safe synchronization." /><DataCard title="Read-only access"><p>Your role can review business information but cannot create sales.</p></DataCard></div>;
  return <div className="pos-route-page"><h1 className="sr-only">Sell / POS</h1><PosWorkspace businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} items={sellableItems} /></div>;
}
