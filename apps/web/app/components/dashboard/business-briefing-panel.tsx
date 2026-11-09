"use client";

import { useState } from "react";
import Link from "next/link";
import type { BusinessBriefing, BusinessBriefingRange } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import styles from "./business-briefing-panel.module.css";

const ALLOWED = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const RANGES: Array<{ value: BusinessBriefingRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export function BusinessBriefingPanel() {
  const { session, role, queue } = useWorkspace();
  const [range, setRange] = useState<BusinessBriefingRange>("today");
  const allowed = role !== null && ALLOWED.has(role);
  // Do not use or show another tenant's cached data when the active context changes.
  // Offline views deliberately do not claim that a briefing is current.
  const path = session && allowed && queue.online
    ? `/v1/intelligence/briefing?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&range=${range}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<BusinessBriefing>(path);
  if (!allowed || !session) return null;

  const briefing = !loading && !error && queue.online
    && data?.businessId === session.businessId && data.branchId === session.branchId
    ? data : null;

  return (
    <section className={styles.panel} aria-labelledby="business-briefing-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BUSINESS INTELLIGENCE</p>
          <h2 id="business-briefing-heading" className={styles.title}>Your business briefing</h2>
          <p className={styles.subheading}>Insights calculated from your actual sales and financial records — not guessed by AI.</p>
        </div>
        <button type="button" className={styles.refresh} onClick={refetch} disabled={!queue.online || loading}>
          Refresh
        </button>
      </div>

      <div className={styles.ranges} role="group" aria-label="Business briefing period">
        {RANGES.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            aria-pressed={range === value}
            className={range === value ? styles.rangeActive : styles.range}
            onClick={() => setRange(value)}
            disabled={!queue.online}
          >
            {label}
          </button>
        ))}
      </div>

      {!queue.online ? (
        <div className={styles.notice} role="status">
          Briefing unavailable offline. Continue recording sales as usual; the figures will refresh once you reconnect.
        </div>
      ) : loading ? (
        <p className={styles.notice} role="status">Checking your recorded business figures…</p>
      ) : error ? (
        <div className={styles.notice} role="alert">
          Could not load your briefing: {error}
          <button type="button" className={styles.retry} onClick={refetch}>Try again</button>
        </div>
      ) : briefing ? (
        <BriefingContents briefing={briefing} />
      ) : (
        <p className={styles.notice}>No briefing available yet.</p>
      )}
    </section>
  );
}

function BriefingContents({ briefing }: { briefing: BusinessBriefing }) {
  return (
    <div className={styles.content}>
      <div className={styles.summary}>
        <div className={styles.summaryText}>
          <div className={styles.healthLine}>
            <span className={styles.dataLabel}>Data quality: {briefing.dataQuality.toLowerCase()}</span>
            <span className={styles.dataLabel}>Confidence: {briefing.health.confidence.toLowerCase()}</span>
          </div>
          <h3 className={styles.headline}>{briefing.health.headline}</h3>
          <p className={styles.explanation}>{briefing.dataQualityMessage}</p>
        </div>
        <p className={styles.timestamp}>
          Updated {new Date(briefing.generatedAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}
          {" · "}{briefing.period.timezone}
        </p>
      </div>
      <div className={styles.metricGrid}>
        <Metric label="Net sales" minor={briefing.metrics.netRevenueMinor} currency={briefing.currencyCode} />
        <Metric label="Operating profit" minor={briefing.metrics.operatingProfitMinor} currency={briefing.currencyCode} />
        <Metric label="Cash balance" minor={briefing.metrics.cashBalanceMinor} currency={briefing.currencyCode} />
        <Metric label="Customers owe" minor={briefing.metrics.receivablesMinor} currency={briefing.currencyCode} />
      </div>
      <div className={styles.bottom}>
        <div>
          <h3 className={styles.sectionTitle}>What needs attention</h3>
          {briefing.actions.length > 0 ? (
            <ul className={styles.actions}>
              {briefing.actions.map((action) => (
                <li key={action.code} className={styles.action}>
                  <div className={styles.actionHead}>
                    <span className={styles.priority}>{action.priority}</span>
                    <strong>{action.title}</strong>
                  </div>
                  <p>{action.reason}</p>
                  <Link href={action.href} className={styles.actionLink}>{action.action}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              {briefing.dataQuality === "INSUFFICIENT"
                ? "Record more transactions to unlock trustworthy recommendations."
                : "No specific action flagged by the current rules. Review your reports for the full picture."}
            </p>
          )}
        </div>
        <div className={styles.side}>
          <h3 className={styles.sectionTitle}>Reading your numbers</h3>
          <p>{briefing.metrics.salesCount.toLocaleString("en-GH")} sale(s) and {briefing.metrics.returnCount.toLocaleString("en-GH")} return(s) in the selected period.</p>
          <p>Cash movement: <MoneyValue minor={briefing.metrics.netCashMovementMinor} currencyCode={briefing.currencyCode} signed /></p>
          <p>Supplier balances: <MoneyValue minor={briefing.metrics.payablesMinor} currencyCode={briefing.currencyCode} /></p>
          {!briefing.inventorySnapshotAligned ? (
            <p className={styles.caution}>Inventory is a current snapshot, not necessarily the stock position at the report period end.</p>
          ) : null}
          <Link href="/reports" className={styles.reportLink}>View financial reports</Link>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, minor, currency }: { label: string; minor: number; currency: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={styles.metricValue}>
        <MoneyValue minor={minor} currencyCode={currency} />
      </strong>
    </div>
  );
}
