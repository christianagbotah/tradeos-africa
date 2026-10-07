"use client";

import { FinancialReports } from "../../components/financial-reports";
import { PageHeader } from "../../components/ui/page-header";
import { StatCard } from "../../components/ui/stat-card";
import { StatusBadge } from "../../components/ui/status-badge";
import { useWorkspace } from "../../components/workspace/use-workspace";

export default function DashboardPage() {
  const { context, branchId, activeBranch, catalog, sellableItems } = useWorkspace();
  const trackedProducts = catalog.filter((item) => item.trackStock).length;
  const services = catalog.filter((item) => item.kind === "SERVICE").length;

  return (
    <div className="tradeos-page-stack" data-workspace-route="dashboard">
      <PageHeader eyebrow="Overview" title="Business dashboard" subtitle="Your operational health, working capital and financial signals in one place." status={<StatusBadge tone="positive">{activeBranch.name}</StatusBadge>} />
      <section className="tradeos-stat-grid" aria-label="Business overview">
        <StatCard label="Sellable choices" value={sellableItems.length} hint="Across configured sale units" />
        <StatCard label="Tracked products" value={trackedProducts} hint="Inventory-managed catalog items" />
        <StatCard label="Services" value={services} hint="Configured service items" />
        <StatCard label="Operating currency" value={context.business.currencyCode === "GHS" ? "₵ GHS" : context.business.currencyCode} hint={context.business.countryCode} tone="dark" />
      </section>
      <FinancialReports businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} businessTimezone={context.business.timezone} branchTimezone={activeBranch.timezone} view="dashboard" />
    </div>
  );
}
