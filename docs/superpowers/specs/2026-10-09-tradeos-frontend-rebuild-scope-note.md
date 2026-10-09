# TradeOS Frontend Rebuild Scope Note

The architecture in `2026-10-09-tradeos-frontend-rebuild-design.md` is an umbrella design for the full TradeOS frontend family.

The **first implementation plan must cover only Phase 1 (Foundation) and Phase 2 (Reference screens)**:

- shared design tokens and typography
- core frontend primitives
- responsive application shell
- desktop and mobile navigation foundations
- loading/empty/error/success/offline states
- Dashboard
- Sell / POS
- Catalog
- Sales history/detail
- Inventory
- one representative master-data screen

Phase 3 (remaining business modules) and Phase 4 (desktop/mobile/system-admin cross-platform alignment) are follow-on implementation slices. They must not be bundled into the first frontend rebuild PR.

This keeps the redesign reviewable and prevents a single uncontrolled rewrite while still preserving the umbrella architecture as the common design contract.
