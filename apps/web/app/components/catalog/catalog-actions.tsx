"use client";

import React, { useState } from "react";
import { ClientApiError, clientApi, messageFrom } from "../../lib/client-api";
import { catalogCapabilities } from "../../lib/lifecycle-capabilities";
import {
  enqueueMutation,
  flushPendingMutations,
  getFailedMutations,
  getOrCreateClientId,
} from "../../lib/offline-sync";
import type { CatalogItem } from "../../lib/workspace-types";
import { Button } from "../ui/button";

export function catalogDeleteConfirmation(item: CatalogItem): string {
  return `Permanently delete “${item.name}”? TradeOS will allow this only when the item has never been used in sales, purchases, stock movements, returns or recipes. This cannot be undone.`;
}

export function catalogActionMessage(code: string | null | undefined, fallback = "Catalog action could not be completed."): string {
  if (code === "CATALOG_ITEM_IN_USE") return "This item has business history, so it cannot be permanently deleted. Archive it instead.";
  if (code === "STALE_VERSION") return "This item changed on another device. Refresh the latest version before trying again.";
  if (code === "CATALOG_STRUCTURE_LOCKED") return "Business history protects this item’s stock and unit structure. Duplicate it for a new structure.";
  if (code === "OFFLINE_DELETE") return "Permanent deletion requires an online connection so TradeOS can verify that the item has no protected business history.";
  if (code === "ROLE_FORBIDDEN") return "Your role is not allowed to perform this catalog action.";
  return fallback;
}

export function CatalogActions({
  item,
  role,
  businessId,
  onEdit,
  onDuplicate,
  onChanged,
}: {
  item: CatalogItem;
  role: string;
  businessId: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const capabilities = catalogCapabilities(role);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!capabilities.canEdit) return null;

  const changeStatus = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const clientMutationId = crypto.randomUUID();
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId,
        businessId,
        mutationType: item.active ? "CATALOG_ITEM_ARCHIVE" : "CATALOG_ITEM_REACTIVATE",
        occurredAt: new Date().toISOString(),
        payload: { itemId: item.id, expectedUpdatedAt: item.updatedAt },
      });
      if (!navigator.onLine) {
        setMessage(`${item.active ? "Archive" : "Reactivation"} saved offline · pending sync.`);
        return;
      }
      const summary = await flushPendingMutations();
      const failed = getFailedMutations().find((entry) => entry.mutation.clientMutationId === clientMutationId);
      if (failed) {
        setMessage(catalogActionMessage(failed.result.errorCode, failed.result.errorMessage ?? "Catalog status change was rejected."));
        return;
      }
      if (summary.received > 0) {
        setMessage("Status change is saved locally and still pending synchronization.");
        return;
      }
      await onChanged();
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  const deleteUnused = async () => {
    if (busy || !capabilities.canDeleteUnused) return;
    if (!navigator.onLine) {
      setMessage(catalogActionMessage("OFFLINE_DELETE"));
      setConfirmDelete(false);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await clientApi(
        `/api/tradeos/v1/catalog/items/${encodeURIComponent(item.id)}?businessId=${encodeURIComponent(businessId)}&expectedUpdatedAt=${encodeURIComponent(item.updatedAt)}`,
        { method: "DELETE" },
      );
      setConfirmDelete(false);
      await onChanged();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(catalogActionMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="catalog-actions">
      <Button variant="secondary" size="compact" type="button" onClick={onEdit}>Edit</Button>
      <details>
        <summary aria-label={`More actions for ${item.name}`}>More</summary>
        <div className="catalog-action-menu">
          <button type="button" onClick={onDuplicate}>Duplicate</button>
          <button type="button" disabled={busy} onClick={() => void changeStatus()}>{item.active ? "Archive" : "Reactivate"}</button>
          {capabilities.canDeleteUnused ? <button className="danger" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete unused</button> : null}
        </div>
      </details>
      {message ? <span className="catalog-action-message" role="status">{message}</span> : null}

      {confirmDelete ? (
        <div className="catalog-confirm-backdrop">
          <div className="catalog-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`delete-title-${item.id}`} aria-describedby={`delete-copy-${item.id}`}>
            <span className="catalog-confirm-kicker">Permanent action</span>
            <h3 id={`delete-title-${item.id}`}>Delete {item.name}?</h3>
            <p id={`delete-copy-${item.id}`}>{catalogDeleteConfirmation(item)}</p>
            <p className="catalog-confirm-note">If protected history exists, TradeOS will refuse deletion and keep the item intact. Archive is the safe lifecycle action for used items.</p>
            <div className="catalog-confirm-actions">
              <Button variant="ghost" type="button" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" type="button" disabled={busy} onClick={() => void deleteUnused()}>{busy ? "Checking…" : `Delete ${item.name}`}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
