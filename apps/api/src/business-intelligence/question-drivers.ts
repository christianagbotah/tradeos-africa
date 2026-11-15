import type {
  BusinessQuestionFact, BusinessQuestionResultItem, FinancialFlowSummary,
} from "@tradeos/contracts";

/**
 * Financial movement decomposition. These are accounting identities drawn
 * from canonical reporting, NOT an inferred behavioral or causal explanation.
 * Returns and COGS use their signed accounting contribution, so items exactly
 * reconcile to the reported net-sales or operating-profit movement.
 */
export type DriverMetric = "SALES" | "PROFIT";

export interface RecordedChangeDrivers {
  evidence: BusinessQuestionFact[];
  items: BusinessQuestionResultItem[];
  text: string;
  limitations: string[];
}

function currency(minor: number, code: string, signed = true): string {
  const v = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100);
  return (minor < 0 ? "−" : minor > 0 && signed ? "+" : "") +
    (code === "GHS" ? "₵" : code + " ") + v;
}

interface Movement {
  key: string;
  title: string;
  current: number;
  previous: number;
  contribution: number;
}

export function recordedChangeDrivers(
  current: FinancialFlowSummary,
  previous: FinancialFlowSummary,
  metric: DriverMetric,
  currencyCode: string,
): RecordedChangeDrivers {
  const difference = (a: number, b: number) => a - b;
  const grossRevenueDelta = difference(current.grossRevenueMinor, previous.grossRevenueMinor);
  const returnsDelta = difference(current.returnsRevenueMinor, previous.returnsRevenueMinor);
  const movements: Movement[] = [
    {
      key: "grossRevenue", title: "Recorded gross sales excluding tax",
      current: current.grossRevenueMinor, previous: previous.grossRevenueMinor,
      contribution: grossRevenueDelta,
    },
    {
      key: "returnsReversal", title: "Recorded sales return reversals excluding tax",
      current: current.returnsRevenueMinor, previous: previous.returnsRevenueMinor,
      contribution: -returnsDelta,
    },
  ];
  if (metric === "PROFIT") {
    movements.push(
      {
        key: "netCogs", title: "Net recorded cost of goods sold",
        current: current.netCogsMinor, previous: previous.netCogsMinor,
        contribution: -difference(current.netCogsMinor, previous.netCogsMinor),
      },
      {
        key: "expenses", title: "Posted operating expenses",
        current: current.expenseMinor, previous: previous.expenseMinor,
        contribution: -difference(current.expenseMinor, previous.expenseMinor),
      },
      {
        key: "purchaseReturnVariance", title: "Purchase return price variance",
        current: current.purchaseReturnVarianceMinor,
        previous: previous.purchaseReturnVarianceMinor,
        contribution: difference(
          current.purchaseReturnVarianceMinor,
          previous.purchaseReturnVarianceMinor,
        ),
      },
    );
  }
  const expected = metric === "SALES"
    ? difference(current.netRevenueMinor, previous.netRevenueMinor)
    : difference(current.operatingProfitMinor, previous.operatingProfitMinor);
  const calculated = movements.reduce((sum, row) => sum + row.contribution, 0);
  // Never present an accounting decomposition if the source reports disagree
  // or exceed JavaScript safe integers.
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(calculated) ||
      expected !== calculated) {
    return {
      evidence: [], items: [],
      text: "The reporting components could not be reconciled to the stated change. Review the underlying report.",
      limitations: ["No driver breakdown is displayed because its accounting totals did not reconcile."],
    };
  }
  const evidence: BusinessQuestionFact[] = movements.map((row) => ({
    key: "driver_" + row.key,
    label: row.title + " contribution to change",
    value: row.contribution,
    unit: "MINOR",
    source: "FINANCIAL_REPORT",
  }));
  const items: BusinessQuestionResultItem[] = movements
    .filter((row) => row.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) ||
      a.title.localeCompare(b.title))
    .map((row) => ({
      id: row.key,
      label: row.title,
      detail: "Current: " + currency(row.current, currencyCode, false) +
        " · Previous: " + currency(row.previous, currencyCode, false) +
        " · Effect on change: " + currency(row.contribution, currencyCode),
    }));
  return {
    evidence,
    items,
    text: items.length
      ? "The recorded accounting movements shown below reconcile exactly to the " +
        currency(expected, currencyCode) + " change."
      : "No recorded accounting movement was found between these periods.",
    limitations: [
      "An accounting movement does not prove its underlying cause, such as pricing, footfall or customer demand.",
      "These amounts use the full selected reporting periods; partial-period comparisons may not have equal durations.",
    ],
  };
}
