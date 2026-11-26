import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./business-question-panel.tsx", import.meta.url), "utf8");
const contract = readFileSync(new URL("../../../../../packages/contracts/src/business-questions.ts", import.meta.url), "utf8");

describe("Ask TradeOS conversation follow-up UI", () => {
  it("provides mobile-friendly one-tap follow-ups without requiring voice", () => {
    expect(panel).toContain("Continue the conversation");
    expect(panel).toContain('"And yesterday?"');
    expect(panel).toContain('"And last month?"');
    expect(panel).toContain('"And profit?"');
    expect(panel).toContain("void submit(undefined, followUp)");
  });

  it("limits conversation history to the selected business/branch workspace", () => {
    expect(panel).toContain("lastAnsweredRef.current = null;");
    expect(panel).toContain("lastAnsweredRef.current?.scope === before");
    expect(panel).toContain("lastAnsweredRef.current = result.intent ===");
    expect(panel).toContain("result.interpretedQuestion ?? result.question");
    expect(panel).toContain("...(previousQuestion ? { previousQuestion } : {})");
  });

  it("shows the question interpretation without inventing reported amounts", () => {
    expect(panel).toContain("Understood as:");
    expect(panel).toContain("{current.interpretedQuestion}");
    expect(contract).toContain("interpretedQuestion?: string");
    expect(contract).toContain("previousQuestion?: string");
  });
});
