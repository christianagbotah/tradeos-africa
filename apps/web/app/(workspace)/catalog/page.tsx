"use client";
import { CatalogStarter } from "../../components/catalog-starter";
import { DataCard } from "../../components/ui/data-card";
import { PageHeader } from "../../components/ui/page-header";
import { canAccessWorkspaceRoute } from "../../components/workspace/workspace-navigation";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function CatalogPage() {
  const { context, branchId, refreshBusiness } = useWorkspace();
  if (!canAccessWorkspaceRoute(context.membership.role, "/catalog")) return <div className="tradeos-page-stack"><PageHeader eyebrow="Catalog" title="Catalog & units" subtitle="Products, services, pricing and flexible unit conversions." /><DataCard title="Read-only access"><p>Your role cannot change catalog, pricing or unit-conversion settings.</p></DataCard></div>;
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Catalog" title="Catalog & units" subtitle="Configure products, services, prices and flexible bulk-to-sale unit conversions." /><CatalogStarter businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} onCreated={() => void refreshBusiness()} /></div>;
}
