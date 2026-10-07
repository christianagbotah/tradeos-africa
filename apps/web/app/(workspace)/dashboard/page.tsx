"use client";

import { FinancialReports } from "../../components/financial-reports";
import { useWorkspace } from "../../components/workspace/use-workspace";

export default function DashboardPage() {
  const { context, branchId, activeBranch, catalog, sellableItems } = useWorkspace();
  const trackedProducts = catalog.filter((item) => item.trackStock).length;
  const services = catalog.filter((item) => item.kind === "SERVICE").length;

  return (
    <div data-workspace-route="dashboard">
      <section className="metrics-grid">
        <article className="metric-card"><span>Sellable choices</span><strong>{sellableItems.length}</strong><small>Across configured sale units</small></article>
        <article className="metric-card"><span>Tracked products</span><strong>{trackedProducts}</strong><small>Inventory-managed catalog items</small></article>
        <article className="metric-card"><span>Services</span><strong>{services}</strong><small>Configured service items</small></article>
        <article className="metric-card health-card"><span>Currency</span><strong>{context.business.currencyCode === "GHS" ? "₵ GHS" : context.business.currencyCode}</strong><small className="positive">{context.business.countryCode}</small></article>
      </section>
      <FinancialReports
        businessId={context.business.id}
        branchId={branchId}
        currencyCode={context.business.currencyCode}
        role={context.membership.role}
        businessTimezone={context.business.timezone}
        branchTimezone={activeBranch.timezone}
        view="dashboard"
      />
    </div>
  );
}
