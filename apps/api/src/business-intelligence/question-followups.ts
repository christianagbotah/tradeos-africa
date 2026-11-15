import type { BusinessQuestionIntent } from "@tradeos/contracts";
import {
  isComparisonQuestion, questionComparisonPlan, questionPeriod,
  unsupportedBranchRanking, unsupportedCalendarQuestion,
  type QuestionPeriod,
} from "./question-periods.js";

// Follow-ups are intentionally a small, allow-listed grammar. Previous text
// supplies a topic only; every query is recomputed inside the CURRENT
// authenticated tenant/branch scope. No previous financial values are reused.
const PERIOD_SPEECH: Record<QuestionPeriod, string> = {
  today: "today", yesterday: "yesterday",
  day_before_yesterday: "the day before yesterday",
  week: "this week", last_week: "last week",
  month: "this month", last_month: "last month",
};
const PERIOD = "(today|yesterday|(?:the )?day before yesterday|two days ago|this week|last week|previous week|this month|last month|previous month)";
const ELLIPTICAL_PERIOD = new RegExp(
  "^(?:(?:and|what|how)\\s+(?:about|for)\\s+|and\\s+)?(?:(?:for|in|on)\\s+)?" +
  PERIOD + "\\s*[?.!]?$", "i",
);
const ELLIPTICAL_TOPIC = /^(?:(?:and|what|how)\s+(?:about|for)\s+|and\s+)?(sales?|profit|top (?:items?|products?))\s*[?.!]?$/i;

export interface ResolvedQuestion {
  effectiveQuestion: string;
  usedContext: boolean;
}

export function resolveBusinessFollowUp(
  question: string,
  previousQuestion: string | undefined,
  previousIntent: BusinessQuestionIntent,
): ResolvedQuestion {
  const asked = question.trim();
  const unmodified = { effectiveQuestion: asked, usedContext: false };
  if (!previousQuestion || previousQuestion.length > 400 ||
      previousIntent === "UNSUPPORTED" || unsupportedCalendarQuestion(previousQuestion)) {
    return unmodified;
  }
  const prior = previousQuestion.trim();
  const originalIsRanking = unsupportedBranchRanking(prior);
  const previousTopic = originalIsRanking ? (previousIntent === "PROFIT" ? "profit" : "sales") :
    previousIntent === "PROFIT" ? "profit" :
    previousIntent === "SALES" ? "sales" :
    previousIntent === "TOP_ITEMS" ? "top items" : null;
  if (!previousTopic) return unmodified;

  const periodMatch = asked.match(ELLIPTICAL_PERIOD);
  if (periodMatch) {
    const period = PERIOD_SPEECH[questionPeriod(periodMatch[1] ?? "")];
    const query = originalIsRanking
      ? `Which branch recorded the highest ${previousTopic} ${period}?`
      : previousTopic === "top items"
        ? `Which products sold best ${period}?`
        : previousTopic === "profit"
          ? `What was our operating profit ${period}?`
          : `What were our sales ${period}?`;
    return { effectiveQuestion: query, usedContext: true };
  }

  const topicMatch = asked.match(ELLIPTICAL_TOPIC);
  if (!topicMatch) return unmodified;
  const topic = /^profit$/i.test(topicMatch[1] ?? "") ? "profit" :
    /^sales?$/i.test(topicMatch[1] ?? "") ? "sales" : "top items";
  // "And top products?" after a branch question is ambiguous; never guess
  // whether the user wants a business-wide ranking or one branch's products.
  if (originalIsRanking && topic !== "sales" && topic !== "profit") return unmodified;
  const comparison = isComparisonQuestion(prior) && !originalIsRanking
    ? questionComparisonPlan(prior) : null;
  if (comparison && (topic === "sales" || topic === "profit")) {
    return {
      effectiveQuestion: `Compare our ${topic} ${PERIOD_SPEECH[comparison.current]} with ${PERIOD_SPEECH[comparison.previous]}?`,
      usedContext: true,
    };
  }
  const period = PERIOD_SPEECH[questionPeriod(prior)];
  const effectiveQuestion = originalIsRanking
    ? `Which branch recorded the highest ${topic} ${period}?`
    : topic === "top items"
      ? `Which products sold best ${period}?`
      : topic === "profit"
        ? `What was our operating profit ${period}?`
        : `What were our sales ${period}?`;
  return { effectiveQuestion, usedContext: true };
}
