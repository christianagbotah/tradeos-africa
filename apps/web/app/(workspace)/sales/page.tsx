"use client";
import { SalesAndReturns } from "../../components/sales-returns";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function SalesPage() {
  const { context, branchId } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Commerce" title="Sales" subtitle="Review completed transactions, receipts, payment history and customer activity." /><SalesAndReturns businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} view="sales" /></div>;
}
