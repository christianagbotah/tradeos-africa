/**
 * Conservative calendar-period and comparison parser for read-only TradeOS
 * financial questions. No AI model or user-provided SQL is involved.
 * Each calendar range is resolved by the canonical report engine using the
 * selected business/branch timezone, including daylight-saving transitions.
 */
export type QuestionPeriod =
  | "today" | "yesterday" | "day_before_yesterday"
  | "week" | "last_week" | "month" | "last_month";

export const PERIOD_NAMES: Record<QuestionPeriod, string> = {
  today: "Today so far",
  yesterday: "Yesterday",
  day_before_yesterday: "Day before yesterday",
  week: "This week so far",
  last_week: "Last week",
  month: "This month so far",
  last_month: "Last month",
};

export function questionPeriod(question: string): QuestionPeriod {
  const q = question.toLowerCase();
  if (/\b(day before yesterday|two days ago)\b/.test(q)) return "day_before_yesterday";
  if (/\b(last|previous)\s+month\b/.test(q)) return "last_month";
  if (/\b(last|previous)\s+week\b/.test(q)) return "last_week";
  if (/\byesterday\b/.test(q)) return "yesterday";
  if (/\b(today|this morning|this afternoon)\b/.test(q)) return "today";
  if (/\b(month|monthly)\b/.test(q)) return "month";
  return "week";
}

/** Do not silently return this week for dates that the parser cannot honor. */
export function unsupportedCalendarQuestion(question: string): boolean {
  return /\b(last|previous)\s+(year|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(question)
    || /\b(last|past)\s+\d+\s+(days?|weeks?|months?|years?)\b/i.test(question)
    || /\b(on|since|before|after|during)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/i.test(question);
}

/** Branch-ranking questions need a separate authorization model and endpoint. */
export function unsupportedBranchRanking(question: string): boolean {
  return /\b(compare|rank|best|most|least|top|highest|lowest|performing)\b[^?.]*\bbranch(?:es)?\b/i.test(question)
    || /\bwhich\s+branch(?:es)?\b/i.test(question)
    || /\bbranch(?:es)?\s+(performed|sold|made)\s+(best|most|least)\b/i.test(question);
}

export function isComparisonQuestion(question: string): boolean {
  return /\b(compare|comparison|versus|vs\.?|difference|changes?|increas(?:e|ed)|decreas(?:e|ed)|declin(?:e|ed)|dropped|drop|fallen|fall|rising|rose|lower|higher|down|up)\b/i.test(question);
}

export type QuestionComparisonPlan = {
  current: QuestionPeriod;
  previous: QuestionPeriod;
};

export function questionComparisonPlan(question: string): QuestionComparisonPlan | null {
  if (!isComparisonQuestion(question)) return null;
  const q = question.toLowerCase();
  if (/\b(day before yesterday|two days ago)\b/.test(q)) {
    return { current: "yesterday", previous: "day_before_yesterday" };
  }
  if (/\b(last|previous)\s+month\b/.test(q) || /\bmonths?\b/.test(q)) {
    return { current: "month", previous: "last_month" };
  }
  if (/\b(last|previous)\s+week\b/.test(q) || /\bweeks?\b/.test(q)) {
    return { current: "week", previous: "last_week" };
  }
  if (/\byesterday\b/.test(q)) {
    return { current: "today", previous: "yesterday" };
  }
  if (/\btoday\b/.test(q)) {
    return { current: "today", previous: "yesterday" };
  }
  // A comparison without an explicit timeframe defaults to this week vs last week.
  return { current: "week", previous: "last_week" };
}
