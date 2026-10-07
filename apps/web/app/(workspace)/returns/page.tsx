"use client";
import { SalesAndReturns } from "../../components/sales-returns";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function ReturnsPage() {
  const { context, branchId } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Customer recovery" title="Returns & refunds" subtitle="Process protected returns, refunds and stock dispositions against the original sale." /><SalesAndReturns businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} view="returns" /></div>;
}
