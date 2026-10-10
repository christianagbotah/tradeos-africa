# Z.ai authenticated frontend restoration — 2026-10-10

## Why this recovery exists

PR #38 (`feat/tradeos-zai-full-frontend-replacement`) merged the Z.ai full frontend replacement first. PR #37, based on the older frontend foundation, merged immediately afterward and overwrote overlapping authenticated presentation files. Later PR #43 further changed the shell, Dashboard and POS mobile composition.

This recovery restores the overlapping authenticated presentation from the final Z.ai PR #38 branch head `99871d60fc62e113e03785f9b41ec4706fa1526b` while preserving later non-visual correctness work already on `main`.

## Restored Z.ai presentation

- Application shell and responsive navigation
- Dashboard command center
- POS workspace and product browser
- Sales workspace presentation
- Inventory workspace presentation
- Associated Dashboard / POS / shell CSS

The root layout already retained Z.ai's eight-file design-system CSS boundary, and legacy files such as `real-app.css`, `workspace-polish.css`, `pos-workspace.css`, and `interactions.css` remain absent.

## Deliberately preserved later correctness work

- PR #42 public-entry/login/register/onboarding composition
- Multi-currency metadata and exponent-aware money handling
- Optimistic-concurrency and lifecycle protections
- Offline/sync correctness
- Dialog/focus safety where it does not alter Z.ai's authenticated composition
- Backend/API/domain/accounting contracts

The restored Z.ai components were adjusted only where necessary to call the shared exponent-aware `formatMoney()` helper. Their layout/markup/CSS composition remains Z.ai's.

## Verification

- Web tests: 59 files / 316 tests passed
- Typecheck: passed
- Lint: passed
- Production build: passed
- `git diff --check`: passed
- Added `zai-authenticated-composition.test.ts` to prevent the later PR #43 shell/cart composition from silently returning

### Rendered browser QA

Authenticated demo-owner rendering was checked against the recovery branch at:

- 360px — Dashboard + Sell/POS
- 390px — Dashboard + Sell/POS
- 768px — Dashboard + Sell/POS
- 1280px — Dashboard + Sell/POS

All eight route/viewport checks reported `scrollWidth === clientWidth` with no horizontal overflow. The Z.ai shell marker, Dashboard marker, POS grid and sticky charge bar were present where expected. The later `workspace-mobile-context-trigger` and `pos-mobile-cart-sheet` overrides were absent.

Screenshots and machine-readable audit evidence are in `docs/qa/evidence/tradeos-zai-restoration/`.
