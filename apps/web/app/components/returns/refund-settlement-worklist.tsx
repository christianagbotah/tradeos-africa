"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";

type SettlementStatus = "PENDING" | "FAILED";
type SettlementFilter = "ALL" | SettlementStatus;
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
}
interface SettlementWorklist {
  summaryByCurrency: Array<{
    currencyCode: string;
    pendingCount: number;
    pendingMinor: number;
    failedCount: number;
    failedMinor: number;
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
  const { session, role } = useWorkspace();
  const allowed = REVIEW_ROLES.has(role);
  const [filter, setFilter] = useState<SettlementFilter>("ALL");
  const [offset, setOffset] = useState(0);
  // Never carry a pagination cursor from a different branch/business.
  useEffect(() => { setOffset(0); }, [session?.businessId, session?.branchId]);
  const path = allowed && session
    ? `/v1/refunds/settlement-queue?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&status=${filter}&limit=${PAGE_SIZE}&offset=${offset}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<SettlementWorklist>(path);

  useEffect(() => {
    if (refreshToken > 0) refetch();
  }, [refreshToken, refetch]);

  if (!allowed) return null;
  const currencyCode = session?.currencyCode ?? "GHS";
  const rawBalances = data?.summaryByCurrency;
  // The older API returned a single mixed-currency sum. An incomplete or old
  // response must show 'unavailable', never a fabricated zero liability.
  const validBalances = Array.isArray(rawBalances) && rawBalances.every((balance) =>
    balance && typeof balance.currencyCode === "string" && balance.currencyCode.length === 3 &&
    [balance.pendingCount, balance.pendingMinor, balance.failedCount, balance.failedMinor]
      .every((value) => Number.isSafeInteger(value) && value >= 0),
  );
  const currencyBalances = validBalances
    ? rawBalances.length > 0 ? rawBalances : [{
        currencyCode, pendingCount: 0, pendingMinor: 0, failedCount: 0, failedMinor: 0,
      }]
    : null;
  const filterOptions: readonly { value: SettlementFilter; label: string }[] = [
    { value: "ALL", label: "All unresolved" },
    { value: "PENDING", label: "Pending payout" },
    { value: "FAILED", label: "Needs review" },
  ];

  return (
    <section className="tos-card tos-card--padded" aria-label="Refund settlement worklist">
      <div className="tos-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 className="tos-section__title">Refund settlement worklist</h2>
          <p className="tos-section__sub">
            All outstanding payouts in this branch, including those older than the last 50 receipts.
            Read-only: pending refunds are not paid until the provider confirms settlement.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>
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
        </div>
      )) : data && !loading && !error ? (
        <p role="alert" className="tos-section__sub">
          Refund summaries are unavailable. Refresh to verify the amounts; missing
          payment data must not be interpreted as a confirmed zero.
        </p>
      ) : null}
      <div className="tos-filter-row" style={{ marginTop: 12, marginBottom: 12 }}>
        {filterOptions.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={filter === option.value ? "primary" : "outline"}
            aria-pressed={filter === option.value}
            onClick={() => { setFilter(option.value); setOffset(0); }}
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
          text="There are no pending or failed refund payouts for this filter." />
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
                </div>
                <div className="tos-returnable-card__body" style={{ textAlign: "right", alignItems: "flex-end" }}>
                  <MoneyValue minor={item.amountMinor} currencyCode={item.currencyCode}
                    className="tos-returnable-card__total" />
                  <span className={`tos-badge ${item.status === "PENDING" ? "tos-badge--neutral" : "tos-badge--danger"}`}>
                    {item.status === "PENDING" ? "Pending" : "Needs review"}
                  </span>
                </div>
              </div>
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
