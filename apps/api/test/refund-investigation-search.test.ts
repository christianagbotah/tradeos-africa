import { describe, expect, it } from "vitest";
import {
  normalizeRefundInvestigationSearch,
  refundInvestigationSearchPattern,
} from "../src/refund-investigation-search.js";

describe("finance refund investigation search", () => {
  it("accepts Unicode customer names, receipts and blank searches", () => {
    expect(normalizeRefundInvestigationSearch(undefined)).toBe("");
    expect(normalizeRefundInvestigationSearch("  ")).toBe("");
    expect(normalizeRefundInvestigationSearch("  Ama Ofori  ")).toBe("Ama Ofori");
    expect(normalizeRefundInvestigationSearch("  éwé  ")).toBe("éwé");
    expect(normalizeRefundInvestigationSearch("4f83a329")).toBe("4f83a329");
  });

  it("rejects malformed, oversized and control-character input", () => {
    for (const value of [null, false, [], {}, "x".repeat(101), "name\nother", "test\tcase", "\u007f"])
      expect(normalizeRefundInvestigationSearch(value)).toBeNull();
    expect(normalizeRefundInvestigationSearch("x".repeat(100))).toHaveLength(100);
  });

  it("treats SQL wildcard characters as literal punctuation", () => {
    expect(refundInvestigationSearchPattern("100%_! Verified"))
      .toBe("%100!%!_!! Verified%");
    expect(refundInvestigationSearchPattern("Ama")).toBe("%Ama%");
  });
});
