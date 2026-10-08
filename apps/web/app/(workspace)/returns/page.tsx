"use client";
import { SalesAndReturns } from "../../components/sales-returns";
import { DataCard } from "../../components/ui/data-card";
import { PageHeader } from "../../components/ui/page-header";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function ReturnsPage() {
  const { context, branchId } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/returns")) return <div className="tradeos-page-stack"><PageHeader eyebrow="Customer recovery" title="Returns & refunds" subtitle="Protected refund and stock-disposition workflows." /><DataCard title="Read-only access"><p>Your role can review sales but cannot process returns or refunds.</p></DataCard></div>;
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Customer recovery" title="Returns & refunds" subtitle="Process protected returns, refunds and stock dispositions against the original sale." /><SalesAndReturns businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} view="returns" /></div>;
}
