# Z.ai reference-screen parity — final acceptance

## Visual authority

The saved Z.ai reference screenshots under `docs/qa/evidence/tradeos-frontend-final/` are the visual acceptance authority for the authenticated TradeOS shell, Dashboard and POS. The repository history contained the required reference composition on `fix/zai-reference-screen-parity`; this work restores that composition on top of current business/domain correctness.

## Restored reference grammar

- dark-green TradeOS sidebar with gold active navigation
- business/branch and business-pack card in the desktop sidebar
- global search across the authenticated shell
- compact mobile business header and global search
- role-aware mobile bottom navigation
- Dashboard action rail, business-pack guidance, AI Actions for Today, KPI grid and lower evidence panels
- product-first POS with search/category controls directly below the shell, desktop customer/cart rail and mobile product-first layout
- deterministic inline SVG icons rather than platform/font-dependent glyphs
- visually hidden POS route heading rather than an extra page-title block absent from the Z.ai reference

## Correctness retained

- server-authoritative pricing and permissions
- offline mutation/idempotency behavior
- multi-currency exponent-aware formatting and parsing
- shared money inputs with visible currency/amount spacing
- immutable transaction evidence and correction workflows
- current session, business/branch and cache-safety protections

## Automated verification

- Web tests: 61 files / 331 tests passed
- Monorepo typecheck: passed
- Monorepo lint: passed
- Production web build: passed
- `git diff --check`: passed
- Service-worker cache generation: `tradeos-shell-v5-zai-reference-parity`

## Rendered browser acceptance

Production-build rendering used the real demo-owner session against the staging API. All 11 authenticated routes were checked at 360, 390, 768 and 1280 px: 44 route/viewport checks total.

Result: **44 checks / 0 failures**.

The audit verifies:
- no horizontal overflow
- Z.ai global search present across authenticated routes
- Dashboard AI/action grammar present
- POS product search present and no visually exposed extra POS page heading
- dark-green sidebar and gold active navigation on desktop
- pointer cursor on visible interactive controls
- opaque native select surfaces
- no sub-48px visible button/select/summary controls through 768 px
- no malformed visible shared money inputs

Evidence is stored under `docs/qa/evidence/zai-reference-parity-final/`.
