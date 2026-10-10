# TradeOS Returns / Refunds / Exchanges UX — implementation plan

Base: `origin/main` at `fc3d70398afc0dc079ac253426a21948965132e5`.
Authority: `docs/superpowers/specs/2026-10-08-tradeos-transaction-operations-design.md` plus existing API/domain/offline contracts.

## Global constraints
- Frontend/business-flow recomposition only unless a verified contract gap is discovered.
- Posted sales remain immutable evidence; corrections are linked returns/refunds/exchanges.
- Preserve existing `RETURN_CREATE` / `EXCHANGE_CREATE` payload ownership and server-authoritative pricing.
- Preserve permission enforcement and offline idempotency semantics.
- Reuse shared primitives: `CommandBar`, `StatePanel`, `MobileRecordCard`, `Button`, `StatusBadge` and transaction-evidence patterns.
- No browser alert/prompt/confirm flows.
- Body text 15–16px; phone touch targets ~48px; no horizontal overflow at 360/390.
- Desktop command controls should stay same-row where space permits.
- TDD for every behavior change; full typecheck/lint/build and rendered acceptance before PR.

## Task 1 — Returns evidence workspace
Files: `return-refund-workspace.tsx`, its tests, and returns/sales CSS.
- Recompose sale selection using shared `CommandBar`, `StatePanel`, `MobileRecordCard`.
- Show receipt, customer, date, amount, refunded amount/status as immutable evidence.
- Keep correction actions explicit; do not introduce edit controls.
- Ensure mobile long-name/48px behavior.

## Task 2 — Return / refund correction sheet
Files: `return-refund-sheet.tsx`, its tests, returns CSS.
- Original posted sale visibly read-only.
- Clear modes: Return + refund, Refund only, Exchange.
- Respect remaining returnable quantity.
- Refund-only must not return stock.
- Services: stock N/A; prepared product: discard/waste; products: Available/Quarantine/Discard.
- Reason required; actor/reason/correction evidence visible.
- Provider-processing/pending/rejected copy must remain truthful.
- Preserve focus trap, Escape, outside-click and focus restoration.
- Mobile primary action remains reachable.

## Task 3 — Exchange sheet
Files: `exchange-sheet.tsx`, its tests, returns CSS; reuse POS browser/cart/model.
- Flow: items coming back → replacements → difference/settlement.
- Keep original receipt immutable and visibly linked.
- Explicit selling units.
- Difference states: Customer pays / Customer receives / No difference.
- Final price server-authoritative.
- Link replacement receipt and return correction evidence.
- Preserve offline/pending/rejected/provider-processing truth.

## Task 4 — Orchestration / permissions / deep links / offline
Files: `sales-returns.tsx` and related tests.
- Preserve `/returns?saleId=...` and `mode=exchange` behavior.
- Correction affordances only where role presentation permits; server remains authority.
- Cached list/detail usable offline.
- Mutation types/payload ownership unchanged.
- Applied mutation refresh preserved; rejected corrections use review language.

## Task 5 — Responsive and accessibility hardening
- Validate 360 / 390 / 768 / >=1280.
- Visible focus, dialog semantics/status messaging, no browser prompts.
- Run focused tests, then full web tests, typecheck, lint, build, diff check.

## Task 6 — QA and PR
- Write `docs/qa/2026-10-10-tradeos-returns-refunds-exchanges.md`.
- Produce fresh rendered evidence when browser preview is available; otherwise document the exact gap.
- Fresh independent whole-branch review.
- Open PR against `main`; do not merge before green GitHub CI.
