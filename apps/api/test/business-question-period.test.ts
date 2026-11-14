import { describe, expect, it } from "vitest";
import { classifyBusinessQuestion, periodRange } from "../src/business-intelligence/question-service.js";

describe("Ask TradeOS calendar-aware questions", () => {
  it("recognizes a spoken yesterday sales question", () => {
    expect(classifyBusinessQuestion("What were my total sales yesterday?")).toBe("SALES");
    expect(periodRange("What were my total sales yesterday?")).toBe("yesterday");
    expect(periodRange("How much profit did we make yesterday?")).toBe("yesterday");
  });

  it("recognizes other supported periods without mislabeling them", () => {
    expect(periodRange("How much did I sell today?")).toBe("today");
    expect(periodRange("How many sales this week?")).toBe("week");
    expect(periodRange("Sales this month?")).toBe("month");
  });
});
