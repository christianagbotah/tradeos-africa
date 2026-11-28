# TradeOS Africa — execution backlog

Updated 2026-11-28. This is a public, source-level tracker; keep credentials, customer data and operational evidence in authorized private systems. Checkboxes are acceptance gates, not estimates. A merged change is not a deployed or UAT-certified feature.

## Execution rules
- [ ] For each vertical slice: reconcile requirements; implement schema/API/roles and clients; add synthetic regression tests; review diff; run CI and migration rehearsal; merge; build signed, checksum-verified runtime; promote only through release gates; verify authenticated staging and record evidence.
- [ ] Keep main and runtime revisions distinct; no compilation or duplicate source workspaces on deployment hosts. Never bypass financial reconciliation, backup, or rollback gates.
- [ ] Maintain this checkpoint and linked issues; continue with the next unblocked slice.

## P0 — financial integrity and offline operation (#109, #218, #134)
- [x] Prevent unsafe failed financial queue retries (#302).
- [x] Make new sale posting and sync acknowledgement atomic, with cross-device collision and failure regression coverage (#301).
- [x] Bind web refresh/retry to original workspace, device and staff (#304).
- [x] Expose pending/rejected queue state and safe review guidance across merchant interfaces (#303).
- [x] Run combined-main CI and signed runtime candidate build for #301/#303/#304 (60815bdf; CI 46138381658, signed candidate 46138381650, runtime pilot 46138411594 all successful). Deployment/UAT remain separate gates.
- [ ] Extend atomic acknowledgement/reconciliation to returns, exchanges, credit, cashbook and other financial mutations; prove historical RECEIVED recovery without reposting.
- [ ] Define outbox consumer contracts; durable delivery/acknowledgement; tenant-scoped leasing, retries, dead-letter review, replay/idempotency and crash tests (#218).
- [ ] Verify provider reservation expiry and reconciliation, webhook signature/replay checks, settlement consistency and payment exceptions (#134).
- [ ] Test offline restart, account/branch changes, duplicate IDs, disconnected cashiers, multi-device races and no cross-tenant exposure on web, Android, iOS and desktop.

## P0 — commerce and accounting
- [ ] Audit POS, Quick Serve, receipts, A5/thermal/PDF sharing, cash/MoMo/card/credit, price tiers, discounts, tax, customer statements.
- [ ] Verify inventory bulk/unit conversion, recipes/yields, valuation, shrinkage, stock transfers and branch-level reconciliation.
- [ ] Verify suppliers, purchasing/partial receipts, returns/refunds/exchanges, damaged items and full accounting reversals; approval and audit trails.
- [ ] Reconcile ledgers, shifts, cashbook, expense, revenue, COGS, profit, taxes, reports and exports against synthetic fixtures.
- [ ] Exercise SME modes: market food, salons/barbers, hardware/cement, bars and restaurant KDS (#226).

## P1 — merchant interfaces and clients
- [ ] Review and integrate responsive redesign (#285, #282, #283 and #276–281); resolve conflicts with current synchronization changes; fresh CI and real device UAT.
- [ ] Test forms, one-row filters, loading/empty/error states, keyboard accessibility, currency formatting, CRUD refresh and clear compact native navigation.
- [ ] Validate mobile and desktop offline storage, secure session lifecycle, camera/scanner/printer/cash drawer, receipt PDF sharing and device trust.
- [ ] Produce and verify signed Android/iOS and Windows/macOS distribution packages, installation/update/rollback, and physical-device tests.

## P1 — empowerment programmes (stacked #293–298)
- [ ] Review/integrate programme tenancy, beneficiary self-consent/withdrawal, roles, cohorts, enrolment/capacity and audit (#293).
- [ ] Apprenticeship pathways, mentor placement, progress and completion (#294).
- [ ] Startup equipment register, approval, allocation, handover and lifecycle reconciliation (#295).
- [ ] Financial literacy content, private assessments and progress (#296).
- [ ] Participant-owned business onboarding/linking and privacy-limited activation reporting (#297).
- [ ] Aggregate outcomes with small-cell suppression, role controls and withdrawal handling (#298).
- [ ] Reconcile stacked branches against main; review migration/provisioning and consent notices; fresh combined CI, upgrade rehearsal and synthetic role/isolation UAT.
- [ ] Verify native/desktop parity, accessibility, data retention/export, consent revocation, provisioning controls and no unauthorized merchant data access before real activation.

## P1 — SaaS, integrations, AI and administration
- [ ] Tenant/branch onboarding, staff roles/least privilege, profile, password reset, subscription billing and entitlements; admin audit and lifecycle.
- [ ] Provider-neutral payment/SMS/email configuration, encrypted credential handling, verified sender, sandbox connections and webhook reconciliation; Hubtel, Paystack, Flutterwave where supported (#136, #143).
- [ ] Supplier document delivery with private attachments and consent, queue retries and audit (#145, #143).
- [ ] Tenant-facing AI intelligence, daily briefings, explicit authorization of automation and usage/cost boundaries (#108, #92).
- [ ] Validate security, dependency scanning, accessibility, data export/retention, monitoring and recovery.

## P0 — release certification (#109, #204)
- [ ] Review signed artifact provenance/checksums, migration upgrade/rollback rehearsal, backup restoration and health checks.
- [ ] Resolve financial promotion gate through verified dispatch and reconciliation; never mark outbox events delivered without consumer acknowledgement.
- [ ] Promote approved runtime only; compare active revision, health, authenticated role and end-to-end UAT against intended release.
- [ ] Pilot with synthetic data and consenting test businesses in representative modes; track defects; sign off release evidence.

## Persistent checkpoint — 2026-11-28
Merged #301 (424a1d3), #304 (4efdabee), #303 (b201b6fe), after passing domain, desktop-native, visual QA and runtime artifact pilot checks on their PR revisions. Combined-main checks and deployment remain unverified. Third-party automated review was skipped by its provider; source diff review and CI are not a replacement for independent release sign-off.

Next: verify combined-main workflows; review stacked programme integration against current main and consent/provisioning requirements; continue outbox consumer/acknowledgement implementation (#218) and remaining financial mutation safety. Do not promote while reconciliation gates fail. Preserve unresolved work; no destructive cleanup without proving recoverability and inactivity.

### Checkpoint — 2026-11-28, second development pass
- #305 consolidated programme stack passed domain, native, visual, runtime and migration checks at dbc49a3f. Expanded consent/withdrawal disclosure in f005d767; fresh checks required; no real programme provisioning or activation.
- #306 implements atomic new return/refund acknowledgement, shared cross-device alias collision guard and malformed payload validation with synthetic database regression coverage (5efdcb80). Draft pending fresh CI.
- #307 introduces an explicit business-scoped transactional local outbox delivery primitive, with row locking and synthetic durable destination tests (5ec2f02f). Draft pending CI. No production consumer or automatic scheduling; do not mark events delivered until genuine destination contract and verified acknowledgement are implemented.
- #285 refreshed merchant native/shared UI integration against current financial safety changes (5714084c); fresh checks and physical device acceptance remain required.
- Rechecked staging availability and financial outbox readiness using a read-only aggregate query: gate remains blocked. No production data changed; detailed operational counts are not stored in this public tracker.

Next: finish fresh CI and review of #305–307/#285; define actual registered outbox consumers and implement durable backoff, poison review, operator metrics and acknowledgement-loss coverage; continue atomic exchange/purchase/credit posting. Keep the financial gate enforced and verify exact-main runtime candidate after integration.
