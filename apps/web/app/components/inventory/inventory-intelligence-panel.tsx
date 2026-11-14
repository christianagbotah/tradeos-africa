"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { InventoryIntelligenceReport, InventoryAdvisoryItem } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import styles from "./inventory-intelligence-panel.module.css";

const ROLES = new Set(["OWNER","ADMIN","MANAGER","INVENTORY","ACCOUNTANT"]);
const IMPORTANT = new Set(["OUT_OF_STOCK","REORDER_REVIEW","SLOW_MOVING","OVERSTOCK_REVIEW"]);
const PRIORITY: Record<string, number> = {
  OUT_OF_STOCK: 1, REORDER_REVIEW: 2, OVERSTOCK_REVIEW: 3, SLOW_MOVING: 4,
};
const STATUS: Record<string, string> = {
  OUT_OF_STOCK: "Stockout risk", REORDER_REVIEW: "Replenishment review",
  SLOW_MOVING: "No recent sales", OVERSTOCK_REVIEW: "Excess stock review",
};

export function InventoryIntelligencePanel() {
  const { session, role, queue } = useWorkspace();
  const [horizonDays, setHorizonDays] = useState<7 | 14 | 30>(14);
  const allowed = ROLES.has(role);
  const path = allowed && session && queue.online
    ? "/v1/intelligence/inventory?businessId=" + encodeURIComponent(session.businessId) +
      "&branchId=" + encodeURIComponent(session.branchId) + "&horizonDays=" + horizonDays
    : null;
  const { data, loading, error, refetch } = useApiFetch<InventoryIntelligenceReport>(path);
  const report = data && session && queue.online && !error && !loading &&
    data.businessId === session.businessId && data.branchId === session.branchId &&
    data.planningHorizonDays === horizonDays ? data : null;
  const attention = useMemo(() => report?.items
    .filter((item) => IMPORTANT.has(item.status))
    .sort((a,b) => (PRIORITY[a.status] ?? 99) - (PRIORITY[b.status] ?? 99) ||
      a.name.localeCompare(b.name))
    .slice(0, 30) ?? [], [report]);

  if (!allowed || !session) return null;
  return (
    <section className={styles.panel} aria-labelledby="inventory-intelligence-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>INVENTORY INTELLIGENCE</p>
          <h2 id="inventory-intelligence-heading" className={styles.title}>Stock & replenishment insights</h2>
          <p className={styles.description}>
            Uses your actual recorded stock movements, sales and returns to identify items worth reviewing.
          </p>
        </div>
        <div className={styles.controls}>
          <label>
            Planning scenario
            <select value={horizonDays} disabled={!queue.online}
              onChange={(event) => setHorizonDays(Number(event.target.value) as 7 | 14 | 30)}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <button type="button" className={styles.refresh} disabled={!queue.online || loading}
            onClick={refetch}>Refresh</button>
        </div>
      </div>
      {!queue.online ? (
        <p className={styles.notice} role="status">Inventory intelligence is unavailable offline. Inventory operations can continue; reconnect to refresh advisory figures.</p>
      ) : error ? (
        <p className={styles.notice} role="alert">Couldn't load stock insights: {error}</p>
      ) : loading || !report ? (
        <p className={styles.notice} role="status">Calculating stock insights from recorded movements…</p>
      ) : (
        <>
          <div className={styles.stats} aria-label="Inventory advisory summary">
            <Stat label="Stockout risks" value={report.summary.outOfStock} />
            <Stat label="Reorder reviews" value={report.summary.reorderReview} />
            <Stat label="Slow-moving" value={report.summary.slowMoving} />
            <Stat label="Excess stock" value={report.summary.overstockReview} />
          </div>
          <p className={styles.timestamp}>
            Checked {new Date(report.generatedAt).toLocaleString("en-GH", { dateStyle:"medium", timeStyle:"short" })}.
            {" "}{report.evaluatedItemCount.toLocaleString("en-GH")} tracked items assessed;
            {" "}{report.summary.insufficientData.toLocaleString("en-GH")} have insufficient sales history.
          </p>
          {report.truncated ? (
            <p className={styles.caution}>The catalog exceeds the 1,000-item advisory limit. These results cover only the items evaluated, not the full inventory.</p>
          ) : null}
          {report.summary.potentialInventoryValueMinor > 0 ? (
            <p className={styles.value}>
              Current recorded value of flagged slow-moving/excess stock:{" "}
              <strong><MoneyValue minor={report.summary.potentialInventoryValueMinor}
                currencyCode={report.currencyCode}/></strong>
            </p>
          ) : null}
          {attention.length ? (
            <>
              <h3 className={styles.subheading}>Items to review</h3>
              <ul className={styles.items}>
                {attention.map((item) => (
                  <li className={styles.item} key={item.itemId}>
                    <div className={styles.itemHeading}>
                      <strong>{item.name}</strong>
                      <span>{STATUS[item.status] ?? item.status}</span>
                    </div>
                    <p>{item.explanation}</p>
                    <div className={styles.facts}>
                      <span>Available: <strong>{formatQty(item.available)} {item.stockUnitCode}</strong></span>
                      <span>Net sold in 30 days: <strong>{formatQty(item.netSold30Days)} {item.stockUnitCode}</strong></span>
                      {item.estimatedCoverDays !== null ? (
                        <span>Estimated cover: <strong>{formatQty(item.estimatedCoverDays)} days</strong></span>
                      ) : null}
                      {item.suggestedReviewQuantity !== null ? (
                        <span>Scenario shortfall: <strong>{formatQty(item.suggestedReviewQuantity)} {item.stockUnitCode}</strong></span>
                      ) : null}
                      <span>Data confidence: <strong>{item.confidence.toLowerCase()}</strong></span>
                    </div>
                  </li>
                ))}
              </ul>
              {report.items.filter((item) => IMPORTANT.has(item.status)).length > 30 ? (
                <p className={styles.timestamp}>Showing the first 30 items requiring review.</p>
              ) : null}
            </>
          ) : (
            <p className={styles.notice}>
              No stock issues are flagged from the available data. Check data-quality notes before treating this as an all-clear.
            </p>
          )}
          <p className={styles.method}>{report.methodology}</p>
          <Link className={styles.link} href="/purchases">Open purchases to review replenishment</Link>
        </>
      )}
    </section>
  );
}
function Stat({label,value}: {label:string;value:number}) {
  return <div className={styles.stat}><span>{label}</span><strong>{value.toLocaleString("en-GH")}</strong></div>;
}
function formatQty(n: number) {
  return n.toLocaleString("en-GH", { maximumFractionDigits: 3 });
}
