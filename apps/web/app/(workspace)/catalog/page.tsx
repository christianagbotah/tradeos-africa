"use client";
import { CatalogStarter } from "../../components/catalog-starter";
import { PageHeader } from "../../components/ui/page-header";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function CatalogPage() {
  const { context, branchId, refreshBusiness } = useWorkspace();
  return <div className="tradeos-page-stack"><PageHeader eyebrow="Catalog" title="Catalog & units" subtitle="Configure products, services, prices and flexible bulk-to-sale unit conversions." /><CatalogStarter businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} onCreated={() => void refreshBusiness()} /></div>;
}
