"use client";
import { QuickSale } from "../../components/quick-sale";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function SellPage() {
  const { context, branchId, sellableItems } = useWorkspace();
  return <QuickSale businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} items={sellableItems} />;
}
