"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApi, messageFrom } from "../../lib/client-api";
import { readFeatureCache, writeFeatureCache } from "../../lib/feature-cache";
import { captureSessionEpoch, isSessionEpochCurrent } from "../../lib/session-lifecycle";
import {
  mutationAppliedEvent,
  type AppliedMutationDetail,
} from "../../lib/offline-sync";
import type { ProcurementSnapshot } from "./procurement-types";

export type ProcurementDataSource = "live" | "cached" | "unavailable";

const refreshMutationTypes = new Set([
  "PURCHASE_RETURN_CREATE",
  "PURCHASE_RECEIVE_CREATE",
  "SUPPLIER_PAYMENT_CREATE",
  "SALE_CREATE",
  "RETURN_CREATE",
  "REFUND_CREATE",
]);

export function isProcurementSnapshot(value: unknown): value is ProcurementSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ProcurementSnapshot>;
  return Array.isArray(snapshot.suppliers)
    && Array.isArray(snapshot.inventory)
    && Array.isArray(snapshot.purchases);
}

export function useProcurementData({ businessId, branchId }: { businessId: string; branchId: string }) {
  const [suppliers, setSuppliers] = useState<ProcurementSnapshot["suppliers"]>([]);
  const [inventory, setInventory] = useState<ProcurementSnapshot["inventory"]>([]);
  const [purchases, setPurchases] = useState<ProcurementSnapshot["purchases"]>([]);
  const [source, setSource] = useState<ProcurementDataSource>("unavailable");
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const sessionEpoch = captureSessionEpoch();
    const cached = readFeatureCache("purchases-inventory", businessId, branchId, "root", isProcurementSnapshot);
    if (cached) {
      setSuppliers(cached.suppliers);
      setInventory(cached.inventory);
      setPurchases(cached.purchases);
      setSource("cached");
    }

    if (!navigator.onLine) {
      if (!cached) setSource("unavailable");
      setMessage(cached
        ? "Offline: showing saved suppliers, purchases and inventory for this branch."
        : "Offline: no saved purchase or inventory data exists for this branch yet.");
      return;
    }

    try {
      const [supplierData, inventoryData, purchaseData] = await Promise.all([
        clientApi<{ suppliers: ProcurementSnapshot["suppliers"] }>(`/api/tradeos/v1/suppliers?businessId=${encodeURIComponent(businessId)}&limit=200`),
        clientApi<{ items: ProcurementSnapshot["inventory"] }>(`/api/tradeos/v1/inventory?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`),
        clientApi<{ purchases: ProcurementSnapshot["purchases"] }>(`/api/tradeos/v1/purchases?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}&limit=20`),
      ]);
      if (!isSessionEpochCurrent(sessionEpoch)) return;

      const next: ProcurementSnapshot = {
        suppliers: supplierData.suppliers,
        inventory: inventoryData.items,
        purchases: purchaseData.purchases,
      };
      setSuppliers(next.suppliers);
      setInventory(next.inventory);
      setPurchases(next.purchases);
      setSource("live");
      setMessage(null);
      writeFeatureCache("purchases-inventory", businessId, branchId, next);
    } catch (error) {
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      if (cached) {
        setSource("cached");
        setMessage(`Showing saved branch data. ${messageFrom(error)}`);
      } else {
        setSource("unavailable");
        setMessage(messageFrom(error));
      }
    }
  }, [businessId, branchId]);

  useEffect(() => {
    setSuppliers([]);
    setInventory([]);
    setPurchases([]);
    setSource("unavailable");
    setMessage(null);
    void reload();

    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (detail?.businessId === businessId
        && detail.branchId === branchId
        && refreshMutationTypes.has(detail.mutationType)) {
        void reload();
      }
    };
    const onOnline = () => void reload();
    window.addEventListener(mutationAppliedEvent, onApplied);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener(mutationAppliedEvent, onApplied);
      window.removeEventListener("online", onOnline);
    };
  }, [businessId, branchId, reload]);

  return { suppliers, inventory, purchases, source, message, reload };
}
