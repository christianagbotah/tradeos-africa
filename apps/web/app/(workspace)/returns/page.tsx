"use client";
import { SalesAndReturns } from "../../components/sales-returns";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function ReturnsPage() {
  const { context, branchId } = useWorkspace();
  return <SalesAndReturns businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} view="returns" />;
}
