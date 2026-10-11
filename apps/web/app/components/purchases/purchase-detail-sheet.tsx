"use client";

import { IconClose } from "../ui/icons";
import { Button } from "../ui/button";

interface PurchaseDetailSheetProps {
  purchaseId: string | null;
  onClose: () => void;
}

/** Placeholder detail sheet — purchase read model endpoints are not yet exposed. */
export function PurchaseDetailSheet({ purchaseId, onClose }: PurchaseDetailSheetProps) {
  if (!purchaseId) return null;
  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Purchase detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Purchase</span>
            <h2 className="tos-sheet__title">{purchaseId.slice(0, 8)}</h2>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <div className="tos-sheet__body">
          <div className="tos-callout">
            Purchase receipt detail will be available once the purchase read endpoint is exposed. The mutation has been queued and will reconcile to inventory and the cashbook.
          </div>
        </div>
        <div className="tos-sheet__foot"><Button variant="primary" onClick={onClose}>Close</Button></div>
      </div>
    </>
  );
}
