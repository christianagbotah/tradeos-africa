import { describe, expect, it } from "vitest";
import type { BranchFinancialRow } from "@tradeos/contracts";
import { rankFinancialBranches } from "../src/business-intelligence/branch-ranking-service.js";
import { unsupportedBranchRanking } from "../src/business-intelligence/question-periods.js";
import { classifyBusinessQuestion } from "../src/business-intelligence/question-service.js";

function branch(id: string, name: string, sales: number, profit: number): BranchFinancialRow {
  return {
    branchId: id, branchName: name, netRevenueMinor: sales,
    netCogsMinor: 0, grossProfitMinor: sales, expenseMinor: 0,
    purchaseReturnVarianceMinor: 0, operatingProfitMinor: profit,
    cashNetMinor: 0, receivablesMinor: 0, customerCreditBalanceMinor: 0,
    payablesMinor: 0, supplierCreditBalanceMinor: 0, inventoryValueMinor: 0,
    salesCount: 1, returnCount: 0,
  };
}

describe("tenant-scoped merchant branch rankings", () => {
  it("sorts sales without accidentally sorting by profit", () => {
    const rows = [branch("a","Main",10000,8000),branch("b","Market",20000,-5000)];
    expect(rankFinancialBranches(rows,"SALES").map(x=>x.branchId)).toEqual(["b","a"]);
    expect(rankFinancialBranches(rows,"PROFIT").map(x=>x.branchId)).toEqual(["a","b"]);
    expect(rows[0]?.branchId).toBe("a"); // immutable input
  });
  it("preserves stable labels for ties", () => {
    const rows = [branch("c","Zebra",5000,0), branch("b","Alpha",5000,0)];
    expect(rankFinancialBranches(rows,"SALES").map(x=>x.branchName)).toEqual(["Alpha","Zebra"]);
  });
  it("detects natural-language branch ranking requests", () => {
    for (const q of [
      "Which branch sold the most this week?",
      "Which branch made the most profit yesterday?",
      "Compare our branches this month",
      "Which branches performed best?",
    ]) expect(unsupportedBranchRanking(q)).toBe(true);
    expect(classifyBusinessQuestion("Which branch sold the most this week?")).toBe("SALES");
    expect(classifyBusinessQuestion("Which branch made the most profit yesterday?")).toBe("PROFIT");
    expect(unsupportedBranchRanking("What did my shop sell yesterday?")).toBe(false);
  });
});
