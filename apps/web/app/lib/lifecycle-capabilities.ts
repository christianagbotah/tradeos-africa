export type CatalogCapabilities = {
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canReactivate: boolean;
  canDeleteUnused: boolean;
};

const catalogReadRoles = new Set([
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "SALES",
  "INVENTORY",
  "ACCOUNTANT",
  "STAFF",
  "VIEWER",
]);

const catalogWriteRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY"]);
const catalogDeleteRoles = new Set(["OWNER", "ADMIN"]);

export function catalogCapabilities(role: string): CatalogCapabilities {
  const canRead = catalogReadRoles.has(role);
  const canWrite = catalogWriteRoles.has(role);
  return {
    canRead,
    canCreate: canWrite,
    canEdit: canWrite,
    canArchive: canWrite,
    canReactivate: canWrite,
    canDeleteUnused: catalogDeleteRoles.has(role),
  };
}
