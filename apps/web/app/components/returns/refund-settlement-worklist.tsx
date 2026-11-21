"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { RefundFollowupPanel } from "./refund-followup-panel";
import { RefundReconciliationPanel } from "./refund-reconciliation-panel";

type SettlementStatus = "PENDING" | "FAILED";
type SettlementFilter = "ALL" | SettlementStatus | "PENDING_24H" | "PENDING_7D" |
  "EVIDENCE_MISMATCH" | "EVIDENCE_AWAITING_REVIEW" | "EVIDENCE_NEEDS_PROVIDER" |
  "EVIDENCE_MISSING";
interface SettlementItem {
  id: string;
  returnCaseId: string;
  saleId: string;
  status: SettlementStatus;
  method: string;
  amountMinor: number;
  currencyCode: string;
  providerReference: string | null;
  customerName: string | null;
  reason: string;
  createdAt: string;
  followupCount: number;
  evidenceClaimCount: number;
  evidenceAwaitingReviewCount: number;
  evidenceDiscrepancyCount: number;
  providerFinality: "NOT_ESTABLISHED";
  escalated: boolean;
}
interface SettlementWorklist {
  evidenceSummaryByCurrency: Array<{
    currencyCode: string;
    missingCount: number; missingMinor: number;
    awaitingReviewCount: number; awaitingReviewMinor: number;
    discrepancyCount: number; discrepancyMinor: number;
    needsProviderCount: number; needsProviderMinor: number;
  }>;
  summaryByCurrency: Array<{
    currencyCode: string;
    pendingCount: number;
    pendingMinor: number;
    failedCount: number;
    failedMinor: number;
    pending24hCount: number;
    pending24hMinor: number;
    pending7dCount: number;
    pending7dMinor: number;
  }>;
  items: SettlementItem[];
  offset: number;
  hasMore: boolean;
}
const REVIEW_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const PAGE_SIZE = 10;

export function settlementAgeLabel(createdAt: string, now: number): string {
  const age = now - Date.parse(createdAt);
  if (!Number.isFinite(age) || age < 0) return "Age unavailable";
  const hours = Math.floor(age / 3_600_000);
  if (hours < 1) return "Under 1 hour";
  if (hours < 24) return hours + (hours === 1 ? " hour" : " hours");
  const days = Math.floor(hours / 24);
  return days + (days === 1 ? " day" : " days");
}

export function RefundSettlementWorklist({ refreshToken }: { refreshToken: number }) {
  const { session, role, queue } = useWorkspace();
  const allowed = REVIEW_ROLES.has(role);
  const [filter, setFilter] = useState<SettlementFilter>("ALL");
  const [offset, setOffset] = useState(0);
  const [exportCurrency, setExportCurrency] = useState("ALL");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [selectedRefundId, setSelectedRefundId] = useState<string | null>(null);
  const [selectedReconciliationId, setSelectedReconciliationId] = useState<string | null>(null);
  // Never carry a pagination cursor from a different branch/business.
  useEffect(() => {
    setOffset(0);
    setFilter("ALL");
    setExportCurrency("ALL");
    setExportError(null);
    setExportNotice(null);
    setSelectedRefundId(null);
    setSelectedReconciliationId(null);
  }, [session?.businessId, session?.branchId]);
  const path = allowed && session
    ? `/v1/refunds/settlement-queue?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&status=${filter}&limit=${PAGE_SIZE}&offset=${offset}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SettlementWorklist>(path);

  useEffect(() => {
    if (refreshToken > 0) refetch();
  }, [refreshToken, refetch]);

  async function downloadInvestigationCsv() {
    if (!session || !allowed || !queue.online || exporting) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const params = new URLSearchParams({
        businessId: session.businessId,
        branchId: session.branchId,
        status: filter,
      });
      if (exportCurrency !== "ALL") params.set("currencyCode", exportCurrency);
      const response = await getOfflineQueue().authenticatedFetch(
        "/v1/refunds/settlement-evidence-export?" + params.toString(),
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      if (!(response.headers.get("content-type") ?? "").includes("text/csv")) {
        throw new Error("Export was not returned as a CSV report.");
      }
      const blob = await response.blob();
      if (blob.size === 0) throw new Error("The export returned an empty file.");
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = "tradeos-refund-investigations-" +
          new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      }
      setExportNotice(
        "Investigation CSV prepared for download. Merchant claims do not prove provider settlement.",
      );
    } catch (error) {
      setExportError(error instanceof Error
        ? error.message : "The investigation report could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  if (!allowed) return null;
  const currencyCode = session?.currencyCode ?? "GHS";
  const rawBalances = data?.summaryByCurrency;
  // The older API returned a single mixed-currency sum. An incomplete or old
  // response must show 'unavailable', never a fabricated zero liability.
  const validBalances = Array.isArray(rawBalances) && rawBalances.every((balance) =>
    balance && typeof balance.currencyCode === "string" && balance.currencyCode.length === 3 &&
    [balance.pendingCount, balance.pendingMinor, balance.failedCount, balance.failedMinor,
      balance.pending24hCount, balance.pending24hMinor, balance.pending7dCount, balance.pending7dMinor]
      .every((value) => Number.isSafeInteger(value) && value >= 0) &&
    balance.pending7dCount <= balance.pending24hCount &&
    balance.pending24hCount <= balance.pendingCount &&
    balance.pending7dMinor <= balance.pending24hMinor &&
    balance.pending24hMinor <= balance.pendingMinor,
  );
  const currencyBalances = validBalances
    ? rawBalances.length > 0 ? rawBalances : [{
        currencyCode, pendingCount: 0, pendingMinor: 0, failedCount: 0, failedMinor: 0,
        pending24hCount: 0, pending24hMinor: 0, pending7dCount: 0, pending7dMinor: 0,
      }]
    : null;
  // Refund evidence indicators cover the ENTIRE selected branch, including
  // results outside the current page. Reject an outdated or incomplete API
  // response rather than silently showing a reassuring zero.
  const rawEvidence = data?.evidenceSummaryByCurrency;
  const evidenceBalances = validBalances &&
    Array.isArray(rawBalances) && Array.isArray(rawEvidence) &&
    rawEvidence.length === rawBalances.length &&
    rawEvidence.every((row) => {
      const liability = rawBalances.find(entry => entry.currencyCode === row.currencyCode);
      if (!liability || !/^[A-Z]{3}$/.test(row.currencyCode)) return false;
      const totalCount = liability.pendingCount + liability.failedCount;
      const totalMinor = liability.pendingMinor + liability.failedMinor;
      return [
        row.missingCount,row.missingMinor,
        row.awaitingReviewCount,row.awaitingReviewMinor,
        row.discrepancyCount,row.discrepancyMinor,
        row.needsProviderCount,row.needsProviderMinor,
      ].every(value => Number.isSafeInteger(value) && value >= 0) &&
        [row.missingCount,row.awaitingReviewCount,row.discrepancyCount,
          row.needsProviderCount].every(value => value <= totalCount) &&
        [row.missingMinor,row.awaitingReviewMinor,row.discrepancyMinor,
          row.needsProviderMinor].every(value => value <= totalMinor);
    }) ? rawEvidence : null;
  const filterOptions: readonly { value: SettlementFilter; label: string }[] = [
    { value: "ALL", label: "All unresolved" },
    { value: "PENDING", label: "Pending payout" },
    { value: "PENDING_24H", label: "Pending 24h+" },
    { value: "PENDING_7D", label: "Pending 7d+" },
    { value: "FAILED", label: "Needs review" },
    { value: "EVIDENCE_AWAITING_REVIEW", label: "Evidence to review" },
    { value: "EVIDENCE_MISMATCH", label: "Evidence discrepancies" },
    { value: "EVIDENCE_NEEDS_PROVIDER", label: "Provider proof needed" },
    { value: "EVIDENCE_MISSING", label: "No evidence submitted" },
  ];

  return (
    <section className="tos-card tos-card--padded" aria-label="Refund settlement worklist">
      <div className="tos-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 className="tos-section__title">Refund settlement worklist</h2>
          <p className="tos-section__sub">
            All outstanding payouts in this branch, including those older than the last 50 receipts.
            Read-only: pending refunds are not paid until the provider confirms settlement.
            The 24h+ and 7d+ figures are subsets of pending payouts, not additional liabilities.
            Filter overdue payouts, unreviewed evidence, discrepancies and cases
            that have been reviewed but still lack independent provider proof.
            Finance totals cover every unresolved refund in this branch, not just this page.
          </p>
        </div>
        <div className="tos-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="tos-section__sub" htmlFor="refund-export-currency">
            Export currency
          </label>
          <select id="refund-export-currency" className="tos-input"
            style={{ width: "auto", minWidth: 115, maxWidth: "100%" }}
            value={exportCurrency} disabled={exporting}
            onChange={event => setExportCurrency(event.target.value)}>
            <option value="ALL">All currencies</option>
            {currencyBalances?.map(balance => (
              <option key={balance.currencyCode} value={balance.currencyCode}>
                {balance.currencyCode === "GHS" ? "₵" : balance.currencyCode}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" loading={exporting}
            disabled={!queue.online || exporting}
            onClick={() => void downloadInvestigationCsv()}>
            Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>
      {exportError ? <p role="alert" className="tos-section__sub"
        style={{ marginTop: 10 }}>{exportError}</p> : null}
      {exportNotice ? <p role="status" className="tos-section__sub"
        style={{ marginTop: 10 }}>{exportNotice}</p> : null}
      {!queue.online ? <p className="tos-section__sub">
        Go online to export a finance investigation CSV. Export is not queued for sync.
      </p> : null}
      {currencyBalances ? currencyBalances.map((summary) => (
        <div className="tos-row" key={summary.currencyCode}
          style={{ gap: 18, flexWrap: "wrap", marginTop: 12 }}>
          <strong className="tos-section__sub">{summary.currencyCode === "GHS" ? "₵" : summary.currencyCode}</strong>
          <span>
            <strong>Pending ({summary.pendingCount})</strong>{" "}
            <MoneyValue minor={summary.pendingMinor} currencyCode={summary.currencyCode} />
          </span>
          <span>
            <strong>Needs review ({summary.failedCount})</strong>{" "}
            <MoneyValue minor={summary.failedMinor} currencyCode={summary.currencyCode} />
          </span>
          <span title="Unpaid provider refunds pending for more than 24 hours">
            <strong>Pending 24h+ ({summary.pending24hCount})</strong>{" "}
            <MoneyValue minor={summary.pending24hMinor} currencyCode={summary.currencyCode} />
          </span>
          <span title="Subset of 24h+ payouts pending for more than 7 days">
            <strong>Pending 7d+ ({summary.pending7dCount})</strong>{" "}
            <MoneyValue minor={summary.pending7dMinor} currencyCode={summary.currencyCode} />
          </span>
        </div>
      )) : data && !loading && !error ? (
        <p role="alert" className="tos-section__sub">
          Refund summaries are unavailable. Refresh to verify the amounts; missing
          payment data must not be interpreted as a confirmed zero.
        </p>
      ) : null}
      {evidenceBalances ? (
        <div aria-label="Branch-wide provider evidence attention" style={{ marginTop: 14 }}>
          <strong>Evidence attention — entire branch</strong>
          <p className="tos-section__sub">
            Outstanding refund amounts only, grouped by original currency.
            Discrepancy and awaiting-review categories can overlap: do not add
            them to payout liabilities or treat any claim as proof of settlement.
            No evidence counts only electronic refunds eligible for provider claims.
          </p>
          {evidenceBalances.map(summary => (
            <div key={summary.currencyCode} className="tos-row" style={{
              gap: 16, flexWrap: "wrap", marginTop: 8,
            }}>
              <strong className="tos-section__sub">
                {summary.currencyCode === "GHS" ? "₵" : summary.currencyCode}
              </strong>
              <span title="Electronic refunds with no submitted provider evidence">
                No evidence ({summary.missingCount}){" "}
                <MoneyValue minor={summary.missingMinor}
                  currencyCode={summary.currencyCode} />
              </span>
              <span title="Unreviewed evidence claims; some may also contain discrepancies">
                To review ({summary.awaitingReviewCount}){" "}
                <MoneyValue minor={summary.awaitingReviewMinor}
                  currencyCode={summary.currencyCode} />
              </span>
              <span title="Claim amount/currency differences or reviewer-recorded discrepancies">
                Discrepancies ({summary.discrepancyCount}){" "}
                <MoneyValue minor={summary.discrepancyMinor}
                  currencyCode={summary.currencyCode} />
              </span>
              <span title="Claims reviewed without discrepancies; still no authenticated payout">
                Provider proof needed ({summary.needsProviderCount}){" "}
                <MoneyValue minor={summary.needsProviderMinor}
                  currencyCode={summary.currencyCode} />
              </span>
            </div>
          ))}
        </div>
      ) : data && !loading && !error ? (
        <p role="alert" className="tos-section__sub">
          Branch-wide evidence totals are unavailable. Refresh before relying on
          the counts; missing evidence must not be interpreted as zero.
        </p>
      ) : null}
      <div className="tos-filter-row" aria-label="Refund review priority filters"
        style={{ marginTop: 12, marginBottom: 12 }}>
        {filterOptions.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? "primary" : "outline"}
            aria-pressed={filter === option.value}
            onClick={() => { setFilter(option.value); setOffset(0); setSelectedRefundId(null); setSelectedReconciliationId(null); }}
          >{option.label}</Button>
        ))}
      </div>
      {loading ? (
        <p className="tos-section__sub" aria-live="polite">
          Loading outstanding payouts…
        </p>
      ) : null}
      {error ? <StatePanel inline variant="error" title="Could not load outstanding refunds"
        text={error} actionLabel="Retry" onAction={() => refetch()} /> : null}
      {!loading && !error && data?.items.length === 0 ? (
        <StatePanel inline variant="empty" title="No outstanding refunds"
          text={filter === "PENDING_24H" || filter === "PENDING_7D"
            ? "No pending payouts match this ageing threshold in the selected branch."
            : filter.startsWith("EVIDENCE_")
              ? "No unresolved refunds match this evidence review filter."
              : "There are no pending or failed refund payouts for this filter."} />
      ) : null}
      {!loading && !error && data?.items.length ? (
        <ul className="tos-list-cards" aria-label="Unresolved refund payouts">
          {data.items.map((item) => (
            <li key={item.id} className="tos-returnable-card">
              <div className="tos-returnable-card__head">
                <div className="tos-returnable-card__body">
                  <strong className="tos-returnable-card__title">
                    Receipt #{item.saleId.slice(0, 8)}
                  </strong>
                  <span className="tos-returnable-card__sub">
                    {item.customerName ?? "Walk-in customer"} · {item.method}
                  </span>
                  <span className="tos-returnable-card__sub">
                    {item.status === "PENDING" ? "Awaiting provider verification" : "Payment attempt failed — investigate"}
                    {" · "}{settlementAgeLabel(item.createdAt, Date.now())}
                  </span>
                  {item.providerReference ? (
                    <span className="tos-returnable-card__sub">
                      Provider ref: {item.providerReference}
                    </span>
                  ) : null}
                  <span className="tos-returnable-card__sub">
                    {item.reason}
                  </span>
                  <Link href={`/sales/receipt/${encodeURIComponent(item.saleId)}`}>
                    View original receipt
                  </Link>
                  <div className="tos-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Button size="sm" variant="outline" aria-expanded={selectedRefundId === item.id}
                      onClick={() => setSelectedRefundId((id) => id === item.id ? null : item.id)}>
                      {selectedRefundId === item.id ? "Close follow-ups"
                        : `Follow-ups (${item.followupCount})`}
                    </Button>
                    <Button size="sm" variant="outline"
                      aria-expanded={selectedReconciliationId === item.id}
                      onClick={() => setSelectedReconciliationId((id) => id === item.id ? null : item.id)}>
                      {selectedReconciliationId === item.id ? "Close checks" : "Reconciliation checks"}
                    </Button>
                  </div>
                </div>
                <div className="tos-returnable-card__body" style={{ textAlign: "right", alignItems: "flex-end" }}>
                  <MoneyValue minor={item.amountMinor} currencyCode={item.currencyCode}
                    className="tos-returnable-card__total" />
                  <span className={`tos-badge ${item.status === "PENDING" ? "tos-badge--neutral" : "tos-badge--danger"}`}>
                    {item.status === "PENDING" ? "Pending" : "Needs review"}
                  </span>
                  {item.escalated ? <span className="tos-badge tos-badge--danger">
                    Escalated
                  </span> : null}
                  {item.providerFinality === "NOT_ESTABLISHED" &&
                    [item.evidenceClaimCount,item.evidenceAwaitingReviewCount,
                      item.evidenceDiscrepancyCount].every(n=>Number.isSafeInteger(n)&&n>=0) ? (
                    <>
                      {item.evidenceDiscrepancyCount>0 ? (
                        <span className="tos-badge tos-badge--danger">
                          Evidence discrepancy ({item.evidenceDiscrepancyCount})
                        </span>
                      ) : null}
                      {item.evidenceAwaitingReviewCount>0 ? (
                        <span className="tos-badge tos-badge--neutral">
                          Evidence to review ({item.evidenceAwaitingReviewCount})
                        </span>
                      ) : null}
                      {item.evidenceClaimCount>0 &&
                        item.evidenceAwaitingReviewCount===0 &&
                        item.evidenceDiscrepancyCount===0 ? (
                        <span className="tos-badge tos-badge--neutral">
                          Awaiting provider proof
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              {selectedRefundId === item.id && session ? (
                <RefundFollowupPanel key={item.id + ":" + session.businessId + ":" + session.branchId}
                  refundId={item.id} onRecorded={refetch} />
              ) : null}
              {selectedReconciliationId === item.id && session ? (
                <RefundReconciliationPanel
                  key={item.id + ":" + session.businessId + ":" + session.branchId}
                  refundId={item.id} onEvidenceRecorded={refetch} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data && (offset > 0 || data.hasMore) ? (
        <div className="tos-row" style={{ marginTop: 12, justifyContent: "space-between" }}>
          <Button size="sm" variant="outline" disabled={offset === 0 || loading}
            onClick={() => setOffset((previous) => Math.max(0, previous - PAGE_SIZE))}>
            Previous
          </Button>
          <span className="tos-section__sub">Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
          <Button size="sm" variant="outline" disabled={!data.hasMore || loading}
            onClick={() => setOffset((previous) => previous + PAGE_SIZE)}>
            Next
          </Button>
        </div>
      ) : null}
    </section>
  );
}
