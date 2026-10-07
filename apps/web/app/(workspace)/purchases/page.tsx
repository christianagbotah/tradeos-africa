"use client";
import { PurchasesInventory } from "../../components/purchases-inventory";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function PurchasesPage() {
  const { context, branchId, catalog } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Procurement" title="Purchases" subtitle="Receive stock, manage suppliers, payment terms and purchase returns." /><PurchasesInventory businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} catalog={catalog} view="purchases" /></div>;
}
