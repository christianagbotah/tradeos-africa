"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";

type LifecycleVerb = "archive" | "deactivate";

type Props = {
  entityLabel: string;
  active: boolean;
  canEdit?: boolean;
  canChangeStatus: boolean;
  busy?: boolean;
  lifecycleVerb?: LifecycleVerb;
  onEdit?: () => void;
  onToggleStatus: () => void | Promise<void>;
};

export function masterDataLifecycleMessage(
  code: string | null | undefined,
  entityLabel: string,
  fallback = "This change could not be saved.",
): string {
  if (code === "STALE_VERSION") return `This ${entityLabel} changed on another device. Refresh the latest version before saving again.`;
  if (code === "ACCOUNT_IS_DEFAULT") return "This account is still a default for one or more payment methods. Replace those defaults before deactivating it.";
  if (code === "CUSTOMER_INACTIVE") return "This customer is inactive. Reactivate the customer before recording new sales or payments.";
  if (code === "SUPPLIER_INACTIVE" || code === "SUPPLIER_NOT_FOUND") return "This supplier is inactive for new purchasing. Reactivate it before receiving new stock.";
  if (code === "HISTORY_PROTECTED") return `This ${entityLabel} is protected by business history. Archive it instead of deleting historical records.`;
  return fallback;
}

export function MasterDataActions({
  entityLabel,
  active,
  canEdit = false,
  canChangeStatus,
  busy = false,
  lifecycleVerb = "archive",
  onEdit,
  onToggleStatus,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreFocus = useRef(false);
  const normalizedLabel = entityLabel.trim().toLowerCase();
  const destructiveVerb = lifecycleVerb === "deactivate" ? "Deactivate" : "Archive";

  useEffect(() => {
    if (confirming) {
      shouldRestoreFocus.current = true;
      confirmRef.current?.focus();
      return;
    }
    if (shouldRestoreFocus.current) {
      triggerRef.current?.focus();
      shouldRestoreFocus.current = false;
    }
  }, [confirming]);

  const confirmStatusChange = async () => {
    await onToggleStatus();
    setConfirming(false);
  };

  return (
    <div className="master-data-actions">
      <div className="master-data-action-row">
        {canEdit && onEdit ? <Button type="button" variant="secondary" disabled={busy} onClick={onEdit}>Edit {normalizedLabel}</Button> : null}
        {canChangeStatus ? active ? (
          <button ref={triggerRef} type="button" className="tos-button tos-button--danger tos-button--default" disabled={busy} onClick={() => setConfirming(true)}>{destructiveVerb} {normalizedLabel}</button>
        ) : (
          <button ref={triggerRef} type="button" className="tos-button tos-button--secondary tos-button--default" disabled={busy} onClick={() => void onToggleStatus()}>Reactivate {normalizedLabel}</button>
        ) : null}
      </div>

      {confirming ? (
        <div className="master-data-confirmation" role="alertdialog" aria-label={`Confirm ${destructiveVerb.toLowerCase()} ${normalizedLabel}`}>
          <div>
            <strong>{destructiveVerb} {normalizedLabel}?</strong>
            <span>Existing business history stays intact. This only stops the record from being used for new activity.</span>
          </div>
          <div className="master-data-confirmation-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <button ref={confirmRef} type="button" className="tos-button tos-button--danger tos-button--default" disabled={busy} onClick={() => void confirmStatusChange()}>Confirm {destructiveVerb.toLowerCase()}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
