"use client";

import { useMemo, useState } from "react";

type ReturnMode = "RETURN_REFUND" | "REFUND_ONLY" | "EXCHANGE" | "PARTIAL";
type Disposition = "RESTOCK" | "QUARANTINE" | "DISCARD";
type RefundMethod = "ORIGINAL_METHOD" | "CASH" | "MOMO" | "BANK" | "CUSTOMER_CREDIT";

const modes: Array<{ id: ReturnMode; title: string; detail: string }> = [
  { id: "RETURN_REFUND", title: "Return + refund", detail: "Stock comes back and money is refunded." },
  { id: "REFUND_ONLY", title: "Refund only", detail: "Money is refunded without recreating stock." },
  { id: "EXCHANGE", title: "Exchange", detail: "Return an item and link a replacement." },
  { id: "PARTIAL", title: "Partial refund", detail: "Refund selected lines or quantities only." },
];

export function ReturnsPanel() {
  const [mode, setMode] = useState<ReturnMode>("RETURN_REFUND");
  const [quantity, setQuantity] = useState(1);
  const [disposition, setDisposition] = useState<Disposition>("RESTOCK");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("ORIGINAL_METHOD");
  const [reason, setReason] = useState("Customer changed mind");

  const unitPrice = 18;
  const refundable = useMemo(() => Math.max(0, quantity) * unitPrice, [quantity]);
  const needsStockDecision = mode !== "REFUND_ONLY";

  return (
    <section className="panel" id="returns">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Protected workflow</p>
          <h2>Returns & refunds</h2>
        </div>
        <span className="workflow-badge">Original sale required</span>
      </div>

      <div className="return-mode-grid">
        {modes.map((item) => (
          <button
            type="button"
            className={mode === item.id ? "return-mode active" : "return-mode"}
            key={item.id}
            onClick={() => setMode(item.id)}
          >
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>

      <div className="return-workspace">
        <div className="return-sale-card">
          <p className="eyebrow">Example original sale</p>
          <div className="sale-reference-row">
            <div>
              <strong>Sale #TOS-1048</strong>
              <span>Today · MoMo · ₵53.00</span>
            </div>
            <button className="text-button" type="button">Find another sale</button>
          </div>
          <div className="return-line-row">
            <div>
              <strong>Malt</strong>
              <span>Sold as bottle · 2 sold · ₵18.00 each</span>
            </div>
            <label>
              Qty
              <input
                min={0.01}
                max={2}
                step={0.01}
                type="number"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="return-form-grid">
          {needsStockDecision ? (
            <label>
              Returned stock goes to
              <select value={disposition} onChange={(event) => setDisposition(event.target.value as Disposition)}>
                <option value="RESTOCK">Available stock</option>
                <option value="QUARANTINE">Quarantine / inspect</option>
                <option value="DISCARD">Discard / unusable</option>
              </select>
            </label>
          ) : (
            <div className="info-field">
              <span>Stock effect</span>
              <strong>None — refund only</strong>
            </div>
          )}

          <label>
            Refund method
            <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}>
              <option value="ORIGINAL_METHOD">Original payment method</option>
              <option value="CASH">Cash</option>
              <option value="MOMO">MoMo</option>
              <option value="BANK">Bank</option>
              <option value="CUSTOMER_CREDIT">Customer credit</option>
            </select>
          </label>

          <label className="reason-field">
            Reason
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </div>

        <div className="return-summary">
          <div>
            <span>Refund amount</span>
            <strong>₵{refundable.toFixed(2)}</strong>
          </div>
          <div>
            <span>Inventory effect</span>
            <strong>{needsStockDecision ? disposition.replace("_", " ") : "NO STOCK RETURN"}</strong>
          </div>
          <div>
            <span>Audit</span>
            <strong>Reason + actor recorded</strong>
          </div>
          <button className="primary-button" type="button" disabled={!reason.trim() || quantity <= 0 || quantity > 2}>
            Review before processing
          </button>
        </div>
      </div>
    </section>
  );
}
