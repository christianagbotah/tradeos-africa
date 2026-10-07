"use client";
import { CustomersCredit } from "../../components/customers-credit";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function CustomersPage() {
  const { context, branchId } = useWorkspace();
  return <CustomersCredit businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} />;
}
