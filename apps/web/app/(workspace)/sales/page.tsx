"use client";
import { SalesAndReturns } from "../../components/sales-returns";
import { ZaiRouteHeader } from "../../components/ui/zai-route-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function SalesPage() {
  const { context, branchId, sellableItems } = useWorkspace();
  return <section className="zai-route-view"><ZaiRouteHeader kicker="Commerce" title="Sales" subtitle="Review completed transactions, receipts, payment history and customer activity." /><SalesAndReturns businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} sellableItems={sellableItems} view="sales" /></section>;
}
