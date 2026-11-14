import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./business-question-panel.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("./question-speech.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./dashboard-command-center.tsx", import.meta.url), "utf8");

describe("Ask TradeOS push-to-talk", () => {
  it("requires an explicit microphone tap and supports the vendor-prefixed API", () => {
    expect(helper).toContain("webkitSpeechRecognition");
    expect(helper).toContain("SpeechRecognition");
    expect(panel).toContain('onClick={toggleListening}');
    expect(panel).toContain('aria-pressed={listening}');
    expect(panel).toContain('recognition.start()');
    expect(panel).toContain('recognizerRef.current.stop()');
    expect(panel).toContain('recognizerRef.current?.abort()');
  });

  it("submits a final transcript to the same authorized read-only business endpoint", () => {
    expect(panel).toContain('void submit(undefined, transcript)');
    expect(panel).toContain('/v1/intelligence/question');
    expect(panel).toContain('businessId: session.businessId, branchId: session.branchId');
    expect(panel).toContain('voiceSupported');
    expect(panel).toContain('Voice recognition is unavailable');
  });

  it("keeps the assistant visible before the KPI and briefing sections", () => {
    const quick = dashboard.indexOf("<DashboardQuickActions role={role} />");
    const ask = dashboard.indexOf("<BusinessQuestionPanel />");
    const kpi = dashboard.indexOf('className="tos-dashboard-stats');
    expect(quick).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(quick);
    expect(kpi).toBeGreaterThan(ask);
    expect(panel).toContain("<details open>");
    expect(panel).toContain('ref={answerRef}');
    expect(panel).toContain("Review the underlying records");
  });
});
