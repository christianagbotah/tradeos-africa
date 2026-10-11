"use client";
import { PurchasesInventory } from "../../components/purchases-inventory";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function PurchasesPage() {
  const { context, branchId, catalog } = useWorkspace();
  return <PurchasesInventory businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} catalog={catalog} view="purchases" />;
}
