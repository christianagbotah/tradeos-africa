/**
 * Shared shape passed from the inventory workspace to the adjustment sheet.
 *
 * Declared separately (rather than importing the workspace's TrackedRow) so
 * the sheet does not depend on the workspace module — keeps the import graph
 * one-directional: workspace → target type + sheet.
 */
export interface TrackedRowLike {
  item: {
    id: string;
    name: string;
    sku: string | null;
    stockUnitCode: string | null;
  };
  stock: {
    available: number;
    quarantine: number;
    damaged: number;
    waste: number;
  } | null;
  available: number;
}
