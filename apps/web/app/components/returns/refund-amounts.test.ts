import { describe, expect, it } from "vitest";
import { sumKnownMinorAmounts } from "./refund-amounts";

describe("financial refund amount aggregation", () => {
  it("shows a verified zero when there are no receipts", () => {
    expect(sumKnownMinorAmounts([], (row: number) => row)).toBe(0);
  });

  it("correctly sums explicit zero, positive and negative minor amounts", () => {
    expect(sumKnownMinorAmounts([{ minor: 0 }, { minor: 2500 }, { minor: -200 }], (row) => row.minor)).toBe(2300);
  });

  it.each([undefined, null, Number.NaN, Infinity, "100", 0.5])(
    "marks a missing or invalid amount (%s) unavailable rather than zero",
    (invalid) => {
      expect(sumKnownMinorAmounts([{ minor: 0 }, { minor: invalid }], (row) => row.minor)).toBeNull();
    },
  );

  it("does not display potentially imprecise oversized totals", () => {
    expect(sumKnownMinorAmounts([{ minor: Number.MAX_SAFE_INTEGER }, { minor: 1 }], (row) => row.minor)).toBeNull();
  });
});
