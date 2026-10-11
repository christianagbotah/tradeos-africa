"use client";

import type { ReactNode } from "react";
import { MoneyValue } from "./money-value";

export interface TransactionEvidenceLine {
  label: string;
  /** Integer minor units. */
  minor: number;
  /** Tone for the value (positive/negative/muted). */
  tone?: "default" | "muted" | "positive" | "negative";
  strong?: boolean;
}

export interface TransactionEvidenceProps {
  currencyCode: string;
  lines: readonly TransactionEvidenceLine[];
  /** Footer total (e.g. grand total). */
  totalLabel?: string;
  totalMinor?: number;
  /** Footnote (e.g. "Posted sales are immutable business evidence."). */
  footnote?: ReactNode;
  children?: ReactNode;
}

/**
 * Renders an authoritative receipt / transaction-evidence summary.
 * Used in the POS success panel, sale-detail sheet, and reconciliation views.
 * Money values are always rendered with the exponent-aware MoneyValue.
 */
export function TransactionEvidence({
  currencyCode,
  lines,
  totalLabel,
  totalMinor,
  footnote,
  children,
}: TransactionEvidenceProps) {
  return (
    <div className="tos-section">
      <div className="tos-section__head">
        <h3 className="tos-section__title">Transaction evidence</h3>
        <span className="tos-section__sub">{currencyCode}</span>
      </div>
      <div className="tos-section__body--padded">
        <dl className="tos-kv">
          {lines.map((line) => (
            <div key={line.label}>
              <dt className="tos-kv__key">{line.label}</dt>
              <dd className={`tos-kv__val${line.strong ? " tos-table__strong" : ""}`}>
                <MoneyValue
                  minor={line.minor}
                  currencyCode={currencyCode}
                  tone={line.tone ?? "default"}
                />
              </dd>
            </div>
          ))}
        </dl>
        {totalLabel !== undefined && totalMinor !== undefined ? (
          <>
            <hr className="tos-divider" style={{ margin: "var(--tos-space-3) 0" }} />
            <div className="tos-row tos-row--between">
              <span className="tos-page__eyebrow">{totalLabel}</span>
              <MoneyValue minor={totalMinor} currencyCode={currencyCode} size="lg" />
            </div>
          </>
        ) : null}
        {footnote ? <p className="tos-callout" style={{ marginTop: "var(--tos-space-3)" }}>{footnote}</p> : null}
        {children}
      </div>
    </div>
  );
}
