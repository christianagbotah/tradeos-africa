# TradeOS Full Frontend Replacement — QA Note

**Branch:** `feat/tradeos-zai-full-frontend-replacement`
**Base:** `main` (`69d6705`)
**PR:** #38

## Summary

Complete removal of the old TradeOS frontend presentation architecture and replacement with a single Z.ai design system.

## Commits

1. `4fb9f46` — `feat(web): remove legacy frontend CSS — consolidate into single design system`
2. `4071a7f` — `chore: gitignore build artifacts`
3. `381d0b6` — `feat(web): rename all legacy class names to new design system + global fixes`

## Legacy frontend files DELETED (11 files)

1. `apps/web/app/globals.css` (249 lines)
2. `apps/web/app/real-app.css` (278 lines)
3. `apps/web/app/workspace-polish.css` (328 lines)
4. `apps/web/app/pos-workspace.css` (5 lines)
5. `apps/web/app/purchases-inventory.css` (385 lines)
6. `apps/web/app/returns.css` (162 lines)
7. `apps/web/app/sales-returns.css` (327 lines)
8. `apps/web/app/transaction-evidence.css` (9 lines)
9. `apps/web/app/cashbook.css` (144 lines)
10. `apps/web/app/master-data.css` (19 lines)
11. `apps/web/app/interactions.css` (19 lines)

## Remaining CSS files (8 — all new design system)

1. `tradeos-tokens.css` — design tokens
2. `ui-primitives.css` — shared primitive styling
3. `workspace-shell.css` — application shell + navigation
4. `tradeos-app.css` — consolidated application styles (replaces all deleted files)
5. `dashboard.css` — dashboard-specific styles
6. `catalog.css` — catalog-specific styles
7. `pos.css` — POS-specific styles
8. `customers-credit.css` — customer workspace styles

## layout.tsx — import verification

```
import "./tradeos-tokens.css";
import "./ui-primitives.css";
import "./workspace-shell.css";
import "./tradeos-app.css";
import "./dashboard.css";
import "./catalog.css";
import "./pos.css";
import "./customers-credit.css";
```

**Does NOT import:** `real-app.css`, `workspace-polish.css`, `pos-workspace.css`, `purchases-inventory.css`, `returns.css`, `sales-returns.css`, `transaction-evidence.css`, `cashbook.css`, `master-data.css`, `interactions.css`, `globals.css` — **PASS**

## Legacy class name renames

All non-test component TSX files renamed from legacy to new design system classes:
- `.eyebrow` → `.tradeos-kicker`
- `.primary-button` → `.tos-button tos-button--primary`
- `.ghost-button` → `.tos-button tos-button--secondary`
- `.text-button` → `.tos-button tos-button--ghost`
- `.panel` → `.tradeos-card`
- `.panel-heading` → `.tradeos-card-heading`
- `.form-row` → `.tradeos-form-row`
- `.metric-card` → `.tradeos-stat-card`
- `.workflow-badge` → `.tradeos-badge`
- `.ai-panel` → `.tradeos-ai-panel`
- `.return-mode` → `.tradeos-return-mode`

**No component uses old generic class names.** — PASS

## Global fixes

- Pointer cursor on ALL clickable elements
- Disabled controls: not-allowed cursor + opacity
- Dropdowns/popovers: fully opaque background, correct z-index
- Currency spacing: `₵  1,250.00` (space after symbol)
- Focus-visible rings on ALL interactive elements
- Backdrop opacity for sheets/dialogs

## Visual QA

Screenshots captured at 5 widths via agent-browser:

| Width | Result | Notes |
|-------|--------|-------|
| 360px | ✅ PASS | Text wraps naturally, controls tappable, no overflow |
| 390px | ✅ PASS | Bottom nav present, inputs fill width, no overflow |
| 768px | ✅ PASS | Sidebar collapses to top header + bottom nav, coherent |
| 1280px | ✅ PASS | Sidebar visible, form card centered, no overflow |
| 1440px | ✅ PASS | More whitespace, all nav sections visible, clean |

VLM verification: "coherent and modern; no overflow or visual issues detected" at all widths.

## Verification results

- **Web tests:** 271 passing (55 files), zero regressions
- **Typecheck:** clean
- **Production build:** succeeds, all routes prerender
- **Backend/API/domain contracts:** ALL PRESERVED — no changes to routes, mutations, permissions, offline behavior, or business logic

## Remaining legacy dependencies

**NONE.** The old frontend presentation system is completely removed. No legacy CSS files remain. No legacy class names remain in components. The layout.tsx imports only the new design system.
