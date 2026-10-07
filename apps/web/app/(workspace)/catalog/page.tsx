"use client";
import { CatalogStarter } from "../../components/catalog-starter";
import { useWorkspace } from "../../components/workspace/use-workspace";
export default function CatalogPage() {
  const { context, branchId, refreshBusiness } = useWorkspace();
  return <CatalogStarter businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} onCreated={() => void refreshBusiness()} />;
}
