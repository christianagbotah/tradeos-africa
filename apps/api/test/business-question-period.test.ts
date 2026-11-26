import { describe, expect, it } from "vitest";
import { classifyBusinessQuestion, periodRange } from "../src/business-intelligence/question-service.js";
import {
  isComparisonQuestion, questionComparisonPlan,
  unsupportedBranchRanking, unsupportedCalendarQuestion,
} from "../src/business-intelligence/question-periods.js";

describe("Ask TradeOS calendar-aware questions", () => {
  it("recognizes a spoken yesterday sales question", () => {
    expect(classifyBusinessQuestion("What were my total sales yesterday?")).toBe("SALES");
    expect(periodRange("What were my total sales yesterday?")).toBe("yesterday");
    expect(periodRange("How much profit did we make yesterday?")).toBe("yesterday");
  });

  it("parses complete prior weeks and months without defaulting to the current period", () => {
    expect(periodRange("How much did I sell today?")).toBe("today");
    expect(periodRange("How many sales this week?")).toBe("week");
    expect(periodRange("Sales this month?")).toBe("month");
    expect(periodRange("Total sales last week")).toBe("last_week");
    expect(periodRange("Total sales last month")).toBe("last_month");
    expect(periodRange("What were sales the day before yesterday?")).toBe("day_before_yesterday");
  });

  it("plans grounded comparisons and rejects unsupported timeframes", () => {
    expect(questionComparisonPlan("Compare today's sales with yesterday")).toEqual({
      current: "today", previous: "yesterday",
    });
    expect(questionComparisonPlan("Were sales lower this week than last week?")).toEqual({
      current: "week", previous: "last_week",
    });
    expect(questionComparisonPlan("Compare profits this month vs last month")).toEqual({
      current: "month", previous: "last_month",
    });
    expect(questionComparisonPlan("Why were sales down yesterday versus day before yesterday?")).toEqual({
      current: "yesterday", previous: "day_before_yesterday",
    });
    expect(questionComparisonPlan("What were yesterday's sales?")).toBeNull();
    expect(isComparisonQuestion("Did sales drop?")).toBe(true);
    expect(unsupportedCalendarQuestion("Total sales last Friday")).toBe(true);
    expect(unsupportedCalendarQuestion("Show my sales last 30 days")).toBe(true);
    expect(unsupportedCalendarQuestion("What sold last month?")).toBe(false);
  });

  it("does not misrepresent branch-ranking questions as selected-branch answers", () => {
    expect(unsupportedBranchRanking("Which branch sold the most this month?")).toBe(true);
    expect(unsupportedBranchRanking("Compare all branches this week")).toBe(true);
    expect(unsupportedBranchRanking("How much did my branch sell?")).toBe(false);
  });
});
