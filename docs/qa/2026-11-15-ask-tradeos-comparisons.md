# TradeOS Africa — Voice AI reporting comparisons UAT

## Scope
Read-only Ask TradeOS questions reuse the authenticated, tenant/branch-scoped financial reporting engine. No language model generates amounts, no financial writes occur, and no paid AI provider is needed.

## Supported examples
- “What were my total sales yesterday?”
- “What were my sales last week?”
- “How much did we sell last month?”
- “Compare today's sales with yesterday.”
- “How do sales this week compare with last week?”
- “Compare our profits this month versus last month.”
- “Why were sales lower this week than last week?” (comparison only; no invented causal attribution)
- “Who owes us money?” / “Which stock needs replenishment?” (existing supported questions)

## Data boundaries and safeguards
- Every report is scoped to the authenticated business and selected branch; a question cannot inject SQL or change the scope.
- Prior periods are defined using the branch timezone; week begins Monday, last month is the previous *calendar* month, and “yesterday” is a complete local day.
- Today/this week/this month are still in progress. They must not be presented as equal-duration comparisons against a complete preceding period.
- Explanations of causes, custom calendar dates, and cross-branch rankings are not yet supported and should clearly say so.
- No speech recognition available in the browser? The question remains typeable.
- No online connection? TradeOS must refuse to generate a fresh report and should not affect offline POS operations.
- Empty or insufficient history must produce real recorded zeros and explicit data-quality limitations, never invented business performance.

## Suggested test procedure
1. Sign into the merchant portal, select an authorized business and branch and open **Dashboard → Ask TradeOS**.
2. Try yesterday, last week, last month, and week-vs-last-week questions using typing and (where supported) the microphone.
3. Check period labels, start/end dates, currency formatting (₵), sale count and evidence against the Reports page.
4. Verify the source link opens Reports and the Read aloud button is optional.
5. Switch branches and verify no answer from the prior branch remains visible.
6. Verify “Which branch performed best?” gives a supported-limits message instead of an invented ranking.
7. Verify that a question with an unsupported date returns a clear unsupported period instead of substituting this week.
8. Confirm a cash or inventory question remains read-only and does not affect sales or stock.
9. Validate a business with no recorded activity: answer should not make predictive claims.

## Deferred advanced AI
- Like-for-like same-elapsed-time comparisons, anomaly explanations based on contributing ledger evidence, and branch ranking with dedicated branch-access checks.
- Cross-topic conversational context, Twi and Ewe speech recognition with tested transcription quality, optional AI model enrichment with spend controls.
- Action proposals (reorders/discounts) behind role, approval, audit and idempotency gates.
