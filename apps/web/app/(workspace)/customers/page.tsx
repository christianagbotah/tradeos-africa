"use client";
import { CustomersCredit } from "../../components/customers-credit";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function CustomersPage() {
  const { context, branchId } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Commerce" title="Customers & credit" subtitle="Manage customer balances, credit limits, collections and account history." /><CustomersCredit businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} /></div>;
}
