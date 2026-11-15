import { describe, expect, it } from "vitest";
import { resolveBusinessFollowUp } from "../src/business-intelligence/question-followups.js";

describe("contextual but read-only TradeOS questions", () => {
  it("carries forward only the previous supported reporting topic", () => {
    expect(resolveBusinessFollowUp("And yesterday?", "How much did we sell this week?", "SALES"))
      .toEqual({ effectiveQuestion: "What were our sales yesterday?", usedContext: true });
    expect(resolveBusinessFollowUp("How about last month?", "What was our operating profit today?", "PROFIT"))
      .toEqual({ effectiveQuestion: "What was our operating profit last month?", usedContext: true });
    expect(resolveBusinessFollowUp("And last week?", "Which products sold best this month?", "TOP_ITEMS"))
      .toEqual({ effectiveQuestion: "Which products sold best last week?", usedContext: true });
  });

  it("carries a comparison period into a new explicit topic without inventing a causal explanation", () => {
    expect(resolveBusinessFollowUp("And profit?", "Compare our sales this week with last week?", "SALES"))
      .toEqual({ effectiveQuestion: "Compare our profit this week with last week?", usedContext: true });
    expect(resolveBusinessFollowUp("And sales?", "Compare our profit today with yesterday?", "PROFIT"))
      .toEqual({ effectiveQuestion: "Compare our sales today with yesterday?", usedContext: true });
  });

  it("preserves branch-ranking intent so the route must authorize the derived question", () => {
    expect(resolveBusinessFollowUp("And yesterday?", "Which branch sold the most this week?", "SALES"))
      .toEqual({
        effectiveQuestion: "Which branch recorded the highest sales yesterday?",
        usedContext: true,
      });
    expect(resolveBusinessFollowUp("And profit?", "Which branch sold the most this month?", "SALES"))
      .toEqual({
        effectiveQuestion: "Which branch recorded the highest profit this month?",
        usedContext: true,
      });
  });

  it("declines to infer an ambiguous topic, unsupported period or absent context", () => {
    const cases = [
      ["And yesterday?", undefined, "UNSUPPORTED"],
      ["And yesterday?", "What is the cash balance?", "CASH"],
      ["And yesterday?", "Delete all customer records", "UNSUPPORTED"],
      ["And last Friday?", "How much did we sell today?", "SALES"],
      ["And the other branch?", "How much did we sell today?", "SALES"],
      ["Which branch sold the most yesterday?", "How much did we sell today?", "SALES"],
      ["And yesterday?", "How much did we sell last Friday?", "SALES"],
    ] as const;
    for (const [question, previous, intent] of cases) {
      expect(resolveBusinessFollowUp(question, previous, intent))
        .toEqual({ effectiveQuestion: question, usedContext: false });
    }
  });
});
