export type MasterDataRevision = {
  expectedUpdatedAt: string;
};

export type CatalogMutationType =
  | "CATALOG_ITEM_CREATE"
  | "CATALOG_ITEM_UPDATE"
  | "CATALOG_ITEM_ARCHIVE"
  | "CATALOG_ITEM_REACTIVATE";
