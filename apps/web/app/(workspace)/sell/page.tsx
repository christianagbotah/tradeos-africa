"use client";
import { QuickSale } from "../../components/quick-sale";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function SellPage() {
  const { context, branchId, sellableItems } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Commerce" title="Sell / POS" subtitle="Fast counter selling with server pricing, customer credit and offline-safe synchronization." /><QuickSale businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} items={sellableItems} /></div>;
}
