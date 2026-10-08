"use client";
import { PurchasesInventory } from "../../components/purchases-inventory";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function InventoryPage() {
  const { context, branchId, catalog } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Stock control" title="Inventory" subtitle="Monitor branch stock, quarantine quantities, average cost and inventory value." /><PurchasesInventory businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} catalog={catalog} view="inventory" /></div>;
}
