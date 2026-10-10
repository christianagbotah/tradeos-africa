# Z.ai Canonical Frontend Promotion QA — 2026-10-10

## Authority
- Presentation baseline: `origin/feat/tradeos-zai-frontend-canonical` at `062c100`.
- Current backend/domain/offline/concurrency/multi-currency behavior remains authoritative.
- Approved PR #42 public login/register/onboarding composition is preserved inside canonical `public-entry.css`.

## Structural acceptance
- `tradeos-app.css` deleted.
- No `workspace-polish.css`, `real-app.css`, or `pos-workspace.css` root imports.
- Canonical module CSS imported for Returns, Procurement, Cashbook/Treasury, Operations, Reports/AI and shared transaction evidence.
- Service-worker cache generation bumped to `tradeos-shell-v3-zai-canonical` so older UI assets are evicted on activation.

## Automated verification
- Web tests: 63 files / 343 tests passed.
- Typecheck: passed.
- Lint: passed.
- Next.js production build: passed.
- `git diff --check`: passed.
- Currency scan: no fixed two-decimal money conversion remains in runtime components.

## Rendered authenticated QA
Demo-owner session against staging API; isolated production frontend preview.

Routes audited at 360, 390, 768 and 1280 pixels:
- Dashboard
- Sell / POS
- Catalog
- Sales
- Inventory
- Purchases
- Returns
- Cashbook
- Operations
- Reports

Result: 40/40 route-width checks passed with no horizontal overflow and no legacy authenticated frontend markers.

Profile dropdown was opened and inspected in Chromium:
- background: `rgb(255, 255, 255)`
- opacity: `1`
- z-index: `50`
- position: `absolute`

Screenshots and machine audit are under `docs/qa/evidence/tradeos-zai-canonical-promotion/`.
