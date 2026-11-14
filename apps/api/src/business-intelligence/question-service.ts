import type {
  BusinessQuestionFact, BusinessQuestionIntent, BusinessQuestionResponse,
  FinancialSummaryReport,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { loadFinancialSummary, loadCreditAging } from "../reports.js";
import { loadInventoryIntelligence } from "./inventory-intelligence-service.js";

export class BusinessQuestionError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "BUSINESS_QUESTION_INVALID") {
    super(message);
  }
}
type OverdueRow = { id: string; name: string; amount_minor: string | number };

export function classifyBusinessQuestion(question: string): BusinessQuestionIntent {
  const normalized = question.trim().toLowerCase();
  if (/(stock|inventory|reorder|restock|replenish|running out|shortage)/.test(normalized)) return "REPLENISHMENT";
  if (/(supplier|vendor|payables|we owe|owe our)/.test(normalized)) return "SUPPLIERS_OVERDUE";
  if (/(customer|receivable|owed to us|owes us|owes me|debtors|unpaid invoice)/.test(normalized)) return "CUSTOMERS_OVERDUE";
  if (/(best sell|top sell|most sold|top product|popular product|best product)/.test(normalized)) return "TOP_ITEMS";
  if (/(profit|margin|expenses?)/.test(normalized)) return "PROFIT";
  if (/(cash|bank balance|how much money)/.test(normalized)) return "CASH";
  if (/(sale|sold|revenue|turnover)/.test(normalized)) return "SALES";
  return "UNSUPPORTED";
}
function money(amountMinor: number, currencyCode: string): string {
  const formatted = new Intl.NumberFormat("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(amountMinor / 100);
  return (currencyCode === "GHS" ? "₵" : currencyCode + " ") + formatted;
}
function periodRange(question: string): "today" | "week" | "month" {
  if (/\b(today|this morning|this afternoon)\b/i.test(question)) return "today";
  if (/\b(month|monthly)\b/i.test(question)) return "month";
  return "week";
}
function fact(key: string, label: string, value: number, unit: BusinessQuestionFact["unit"],
  source: BusinessQuestionFact["source"]): BusinessQuestionFact {
  return { key, label, value, unit, source };
}
function quality(report: FinancialSummaryReport): BusinessQuestionResponse["dataQuality"] {
  if (report.health.status === "INSUFFICIENT_DATA") return "INSUFFICIENT";
  return report.health.confidence === "LOW" ? "LIMITED" : "ESTABLISHED";
}
function safeInteger(value: string | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new BusinessQuestionError(
    "A monetary value is outside the safe reporting range.", 500, "BUSINESS_QUESTION_VALUE_OVERFLOW");
  return result;
}

/**
 * Deterministic, allow-listed read model. The question text controls only which
 * canonical reporting tool is called; it is never passed to SQL or used to
 * choose a table, field, role or tenant scope. No paid AI provider is required.
 */
export async function answerBusinessQuestion(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
  question: string,
): Promise<BusinessQuestionResponse> {
  if (typeof question !== "string" || question.trim().length < 4 || question.length > 400) {
    throw new BusinessQuestionError("Question must contain 4 to 400 characters.");
  }
  const asked = question.trim();
  const intent = classifyBusinessQuestion(asked);
  const generatedAt = new Date().toISOString();
  const base: BusinessQuestionResponse = {
    businessId, branchId, question: asked, intent, generatedAt,
    currencyCode: null, engine: "DETERMINISTIC_GROUNDED_V1",
    dataQuality: "NOT_APPLICABLE", evidence: [], items: [], sourcePage: null,
    limitations: [], answer: "",
  };
  if (intent === "UNSUPPORTED") {
    return {
      ...base,
      answer: "I can currently explain recorded sales, profit, cash balance, overdue customer or supplier balances, top-selling items and inventory replenishment reviews. Please ask about one of these topics.",
      limitations: ["Only verified TradeOS reporting topics are supported. No arbitrary database queries are executed."],
    };
  }

  if (intent === "REPLENISHMENT") {
    if (!branchId) {
      return { ...base, answer: "Select a branch to see its recorded stock and replenishment reviews.",
        sourcePage: "/inventory", limitations: ["Stock quantities and reorder scenarios are branch-specific."] };
    }
    const stock = await loadInventoryIntelligence(pool, businessId, branchId, 14);
    const important = stock.items
      .filter((item) => item.status === "OUT_OF_STOCK" || item.status === "REORDER_REVIEW")
      .sort((a, b) => (a.status === "OUT_OF_STOCK" ? 0 : 1) -
        (b.status === "OUT_OF_STOCK" ? 0 : 1) || a.name.localeCompare(b.name));
    return {
      ...base, currencyCode: stock.currencyCode,
      dataQuality: stock.summary.insufficientData > 0 || stock.truncated ? "LIMITED" : "ESTABLISHED",
      sourcePage: "/inventory",
      evidence: [
        fact("outOfStock", "Items with established sales and no available stock",
          stock.summary.outOfStock, "COUNT", "INVENTORY_REPORT"),
        fact("reorderReview", "Items below a 14-day demand scenario",
          stock.summary.reorderReview, "COUNT", "INVENTORY_REPORT"),
      ],
      items: important.slice(0, 5).map((item) => ({
        id: item.itemId, label: item.name,
        detail: item.status === "OUT_OF_STOCK"
          ? "Out of stock; check replenishment. Recorded 30-day net sold: " +
            item.netSold30Days.toLocaleString("en-GH") + " " + item.stockUnitCode
          : "Review a 14-day scenario shortfall of " +
            (item.suggestedReviewQuantity ?? 0).toLocaleString("en-GH") + " " + item.stockUnitCode,
      })),
      answer: important.length
        ? important.length + " tracked product(s) merit replenishment review from recorded sales and current branch stock. The first five are shown below."
        : "No established-data replenishment shortfalls are flagged in the evaluated branch stock. This does not guarantee there will be no shortage.",
      limitations: [
        "This is a 14-day scenario, not a supplier delivery date or a purchase order.",
        "New products with little recorded history cannot receive reliable demand estimates.",
        ...(stock.truncated ? ["The item scan was truncated; results do not cover the entire catalog."] : []),
      ],
    };
  }

  if (intent === "CUSTOMERS_OVERDUE" || intent === "SUPPLIERS_OVERDUE") {
    const aging = await loadCreditAging(pool, businessId, branchId);
    const customers = intent === "CUSTOMERS_OVERDUE";
    const side = customers ? aging.receivables : aging.payables;
    const overdueMinor = side.overdue1To30DaysMinor + side.overdue31To60DaysMinor
      + side.overdue61To90DaysMinor + side.overdueOver90DaysMinor;
    const table = customers ? "customer_credit_obligations" : "supplier_credit_obligations";
    const partyTable = customers ? "customers" : "suppliers";
    const fk = customers ? "customer_id" : "supplier_id";
    // SQL identifiers are selected exclusively from a fixed, internal allow-list.
    const response = await pool.query<OverdueRow>(
      "SELECT party.id,party.name,SUM(o.open_minor)::text AS amount_minor " +
      "FROM " + table + " o JOIN " + partyTable + " party " +
      "ON party.id=o." + fk + " AND party.business_id=o.business_id " +
      "WHERE o.business_id=$1 AND ($2::uuid IS NULL OR o.branch_id=$2) " +
      "AND o.open_minor>0 AND o.due_at<now() " +
      "GROUP BY party.id,party.name ORDER BY SUM(o.open_minor) DESC,party.name LIMIT 5",
      [businessId, branchId],
    );
    return {
      ...base,
      currencyCode: aging.currencyCode,
      sourcePage: customers ? "/customers" : "/suppliers",
      dataQuality: "ESTABLISHED",
      evidence: [
        fact(customers ? "overdueReceivablesMinor" : "overduePayablesMinor",
          customers ? "Total overdue customer balances" : "Total overdue supplier balances",
          overdueMinor,"MINOR","CREDIT_AGING"),
        fact("openObligationCount","Open credit obligations",side.obligationCount,"COUNT","CREDIT_AGING"),
      ],
      items: response.rows.map((row) => ({
        id: row.id,
        label: row.name,
        detail: money(safeInteger(row.amount_minor),aging.currencyCode) + " overdue",
      })),
      answer: overdueMinor > 0
        ? (customers ? "Customers owe " : "You owe suppliers ") +
          money(overdueMinor,aging.currencyCode) + " past the recorded due dates. The largest overdue counterparties are shown below."
        : customers ? "No overdue customer credit obligations are currently recorded."
          : "No overdue supplier credit obligations are currently recorded.",
      limitations: [
        "Only obligations posted in TradeOS are included.",
        "The named list displays up to five counterparties with overdue balances.",
      ],
    };
  }

  const range = periodRange(asked);
  const report = await loadFinancialSummary(pool,businessId,branchId,{range});
  const prefix = range === "today" ? "Today" : range === "month" ? "This month" : "This week";
  const q = quality(report);
  const limited = q !== "ESTABLISHED" ?
    ["There is limited trading history; period totals are recorded facts, not trend predictions."] : [];
  const current = { ...base, currencyCode: report.currencyCode,
    dataQuality: q, sourcePage: "/reports" as const, limitations: limited };
  switch (intent) {
    case "SALES":
      return {
        ...current,
        answer: prefix + ", " + report.flow.salesCount + " recorded sale(s) generated net revenue of " +
          money(report.flow.netRevenueMinor,report.currencyCode) + " after recorded returns.",
        evidence: [
          fact("netRevenueMinor","Net sales revenue",report.flow.netRevenueMinor,"MINOR","FINANCIAL_REPORT"),
          fact("salesCount","Recorded sales",report.flow.salesCount,"COUNT","FINANCIAL_REPORT"),
        ],
      };
    case "PROFIT":
      return {
        ...current,
        answer: prefix + ", recorded operating profit was " +
          money(report.flow.operatingProfitMinor,report.currencyCode) +
          " after cost of goods and recorded operating expenses.",
        evidence: [
          fact("operatingProfitMinor","Operating profit",report.flow.operatingProfitMinor,"MINOR","FINANCIAL_REPORT"),
          fact("expenseMinor","Recorded expenses",report.flow.expenseMinor,"MINOR","FINANCIAL_REPORT"),
          fact("grossProfitMinor","Gross profit",report.flow.grossProfitMinor,"MINOR","FINANCIAL_REPORT"),
        ],
      };
    case "CASH":
      return {
        ...current,
        answer: "The current recorded cashbook balance is " +
          money(report.position.cashBalanceMinor,report.currencyCode) +
          ". " + prefix + "'s net recorded cash movement was " +
          money(report.flow.netCashMovementMinor,report.currencyCode) + ".",
        evidence: [
          fact("cashBalanceMinor","Current cashbook balance",report.position.cashBalanceMinor,"MINOR","FINANCIAL_REPORT"),
          fact("netCashMovementMinor","Period net cash movement",report.flow.netCashMovementMinor,"MINOR","FINANCIAL_REPORT"),
        ],
        limitations: [...limited,
          "Cashbook figures reflect recorded transactions, not an independent bank or cash count."],
      };
    case "TOP_ITEMS": {
      const items = report.topItems.slice()
        .sort((a,b)=>b.netRevenueMinor-a.netRevenueMinor || a.itemName.localeCompare(b.itemName))
        .slice(0,5);
      return {
        ...current,
        items: items.map((item)=>({
          id:item.itemId,label:item.itemName,
          detail:money(item.netRevenueMinor,report.currencyCode)+" net revenue; "+ 
            (item.quantitySold-item.quantityReturned).toLocaleString("en-GH")+" net units",
        })),
        answer: items.length
          ? "These are the top products/services by recorded net revenue for " + prefix.toLowerCase() + "."
          : "There are no recorded best-selling items for this period.",
        evidence: [fact("salesCount","Recorded sales",report.flow.salesCount,"COUNT","FINANCIAL_REPORT")],
        limitations: [...limited,"Item ranking uses net revenue, not unit count."],
      };
    }
    default: return base;
  }
}
