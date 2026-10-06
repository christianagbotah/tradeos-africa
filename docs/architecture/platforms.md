# TradeOS client and control-plane architecture

## Product surfaces

TradeOS is one platform with distinct client surfaces, not separate products with duplicated business logic.

| Surface | Technology direction | Primary use |
| --- | --- | --- |
| Business web/PWA | Next.js | Browser POS, business operations, owner/admin portal |
| Windows desktop | Tauri + React | Counter/POS, peripherals, robust local operation |
| macOS desktop | Tauri + React | Counter/POS, peripherals, robust local operation |
| Android | React Native + Expo | Mobile sales, field work, owner access, camera/barcode |
| iOS | React Native + Expo | Mobile sales, field work, owner access, camera/barcode |
| System/developer admin | Separate Next.js app | SaaS control plane, subscriptions, tenants, releases, support |
| Transaction API | Fastify + PostgreSQL | Authoritative economic and synchronization operations |

## Shared rules

All business-facing clients consume the same API and shared contracts. Product, pricing, units, recipes, sales, returns, refunds, credit, purchasing, stock and accounting rules are authoritative on the server/domain layer.

A native client may provide device-specific capabilities, but may not invent different commerce rules.

## Offline model

Economic work is local-first on business clients:

1. create a stable client mutation id;
2. persist the mutation locally before reporting success to the operator;
3. continue operating without network access;
4. send queued mutations through `/v1/sync` when connectivity exists;
5. remove only `APPLIED` mutations;
6. retain `RECEIVED` mutations until the durable server result is known;
7. move `REJECTED` mutations to a review queue rather than retry forever.

Storage adapters will differ by platform while implementing the same `MutationQueueStore` contract:

- Web/PWA: IndexedDB (the current localStorage prototype is transitional).
- Windows/macOS: encrypted local SQLite/native store.
- Android/iOS: SQLite plus secure credential storage.

## Desktop native bridge

The desktop application uses Tauri so Windows and macOS share one React application while retaining native access where necessary.

Planned native adapters include:

- receipt and kitchen printers;
- barcode scanners;
- cash drawers;
- weighing scales where supported;
- local file import/export;
- background synchronization;
- automatic updates;
- optional local network device discovery.

Peripheral access is capability-gated and must not be required for core selling.

## Mobile native bridge

Android and iOS share one React Native/Expo application. Planned native capabilities include:

- camera receipt capture;
- barcode/QR scanning;
- biometric unlock;
- push notifications;
- background sync;
- local SQLite;
- share/export flows;
- optional Bluetooth peripherals where justified.

## Business administration vs platform administration

Business administrators are tenant users. They manage their own branches, staff, catalog, stock, customers, suppliers, settings and reports.

TradeOS system/developer administrators operate a separate privilege boundary. They manage the SaaS platform itself:

- tenant activation, suspension and support state;
- plans, subscriptions, trials, renewals and billing state;
- entitlements, module licensing, limits and feature flags;
- provider and country-level configuration;
- client release channels and minimum-supported versions;
- device registration/revocation and synchronization diagnostics;
- announcements and maintenance controls;
- platform operators and privileged audit;
- revenue, adoption and operational health.

System-admin credentials must never be accepted as ordinary tenant credentials by convenience. Any support access into a tenant must be explicit, time-bounded and audited.

## Release management

Every installed client reports platform, application version, installation/device id, release channel and last-seen/sync timestamps.

The control plane tracks releases independently for:

- WEB
- WINDOWS
- MACOS
- ANDROID
- IOS

Release channels begin with `INTERNAL`, `BETA` and `STABLE`, allowing staged rollouts and minimum-supported-version enforcement without forcing every tenant onto a risky new build at once.

## Current implementation status

- Web/PWA: application shell + offline mutation queue implemented.
- API: transactional sync, sales, unit-aware returns/refunds implemented.
- System admin: separate application shell created.
- Mobile: shared Android/iOS Expo application shell created.
- Desktop: shared Windows/macOS Tauri application shell created.
- Client core: shared platform capability and queue contracts created.
- Control-plane DB: plans, subscriptions, entitlements, devices, releases, feature flags and platform audit created.

The next cross-platform work is authentication/device enrollment, real tenant onboarding, shared catalog APIs, persistent platform-specific queue adapters and release CI for native artifacts.
