"use client";
import { CustomerWorkspace } from "../../components/customers/customer-workspace";
import { ZaiRouteHeader } from "../../components/ui/zai-route-header";
import { useWorkspace } from "../../components/workspace/use-workspace";

export default function CustomersPage() {
  const { context, branchId } = useWorkspace();
  return (
    <section className="zai-route-view">
      <ZaiRouteHeader kicker="Commerce" title="Customers" subtitle="Manage customer identities, receivables, account terms and lifecycle history without rewriting posted transactions." />
      <CustomerWorkspace businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} />
    </section>
  );
}
