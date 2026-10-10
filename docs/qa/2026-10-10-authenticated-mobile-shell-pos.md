# Authenticated mobile shell, Dashboard, and POS QA — 2026-10-10

Branch: `feat/authenticated-mobile-shell-pos`
Base: `7f4ffa9c611f7c4a813ecf9a5c8be3310b058933`

## Scope

Bounded presentation correction on top of the Z.ai frontend baseline. No API, domain, permission, accounting, pricing, or offline mutation contract changes.

- Mobile shell: compact business/branch context trigger and role-aware bottom navigation.
- Dashboard: operational quick actions precede summary/AI content so the phone first viewport is action-first.
- POS: desktop two-pane flow preserved; phone adds an accessible cart-review sheet before payment while retaining direct Charge.

## Rendered browser evidence

Fresh authenticated captures were produced from the current branch against the staging API using Playwright/Chromium. Evidence is in `docs/qa/evidence/tradeos-authenticated-mobile-shell-pos/`.

Rendered Dashboard widths: 360, 390, 768, and 1280 px. Rendered POS widths: 360, 390, and 1280 px, with cart-dialog captures at 360 and 390 px. The audit records no horizontal overflow at any rendered route/width.

The POS cart screenshots used one temporary service named `Visual QA Service` in the public demo tenant solely to exercise the cart interaction. It was deleted after capture; deletion returned HTTP 204 and a follow-up catalog read found zero matching items.

## Interaction checks

- Mobile business/branch context opens the existing More sheet.
- Bottom navigation remains role-derived from the existing navigation contract.
- Mobile cart sheet is an accessible modal dialog with Escape close, focus restoration, and a tab trap.
- Bottom navigation is hidden while the cart dialog is open so the `Continue to payment` control remains reachable.
- The phone-only cart trigger is hidden at 768–1099 px, where the inline cart remains available; this prevents opening a hidden phone sheet at tablet widths.
- Initial dialog focus moves to the first cart control so Shift+Tab remains trapped inside the modal.
- If removing a line unmounts the focused control, focus is recovered to the first surviving cart control and the tab trap also catches focus that has fallen outside the modal.
- If the cart becomes empty, closing the cart returns focus to product search because the disabled Open cart trigger cannot receive focus.
- Desktop cart remains visible/sticky at desktop widths.
- Sale mutation payload remains server-authoritative and does not add client unit prices.

## Data integrity

No sale was posted during visual QA. The temporary catalog fixture was removed after screenshots. The staging demo tenant remains otherwise unchanged by this QA pass.
