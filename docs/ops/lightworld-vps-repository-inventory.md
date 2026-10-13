# Lightworld VPS Repository Inventory

Snapshot: 2026-10-13. This inventory records deployment authority, not merely repository ownership. A repository marked **canonical deployed** is the only source that may receive a self-hosted runner capable of deploying that application to the Lightworld VPS.

## Classification rules

- **Canonical deployed** — active VPS evidence identifies this repository as the deployment source.
- **Duplicate / mirror** — overlaps an actively deployed application but must not receive deployment authority.
- **Development-only** — active project repository with no active deployment evidence found in the current VPS inventory.
- **Reference / excluded** — tutorial, boilerplate, prototype, or retained reference not eligible for deployment-runner onboarding without a new decision.

## Canonical deployed repositories

| Repository | Visibility | VPS evidence | Deployment authority | Next onboarding priority |
| --- | --- | --- | --- | --- |
| `christianagbotah/tradeos-africa` | Public | Managed staging release at `/home/lightworld/releases/tradeos-staging/<sha>`; PM2 `tradeos-staging-api` + `tradeos-staging-web` | **Canonical deployed**; pilot runner live | Pilot complete |
| `Chrix4u/irexpro` | Public | `/home/lightworld/webapps/irexpro-staging` and current iRexPro worktrees use `https://github.com/Chrix4u/irexpro.git`; four PM2 staging processes | **Canonical deployed** | 1 |
| `Chrix4u/iassetspro` | Public | Active iAssetsPro worktrees use `https://github.com/Chrix4u/iassetspro.git`; PM2 `iassetspro`; release symlink under `/home/lightworld/releases` | **Canonical deployed** | 2 |
| `christianagbotah/schoolmanager` | Public | `/home/lightworld/webapps/schoolmanager` checkout uses this origin | **Canonical deployed** | 3 |
| `christianagbotah/ipresenterplux` | Public | `/home/lightworld/webapps/ipresenterplux` checkout uses this origin | **Canonical deployed** | 4 |
| `christianagbotah/ifleet-system` | Public | `/home/lightworld/webapps/ifleetpro` checkout uses this origin | **Canonical deployed** | 5 |
| `christianagbotah/ibetpro` | Public | `/home/lightworld/webapps/ibetpro` and active worktrees use this origin; PM2 `ibetpro` | **Canonical deployed** | 6 |
| `christianagbotah/lightworldtech-website` | Public | `/home/lightworld/webapps/lightworldtech` points to release `lightworldtech-e5929ed70514-...`; deployed SHA resolves in this repo | **Canonical deployed** | 7 |
| `christianagbotah/iedupro` | Private | `/home/lightworld/webapps/iedupro-next` uses the `christianagbotah/iedupro` SSH alias; PM2 API + web | **Canonical deployed** | After public priority set; requires private-main verifier |
| `christianagbotah/vidora` | Public | `/home/lightworld/webapps/vidora` uses this origin; web + two worker PM2 processes | **Canonical deployed** | Subsequent |
| `christianagbotah/fovi` | Public | `/home/lightworld/webapps/fovi` uses this origin; four FOVI PM2 processes | **Canonical deployed** | Subsequent / archived-product policy review first |

## Duplicate or mirror repositories — no deployment authority

| Repository | Reason | Decision |
| --- | --- | --- |
| `christianagbotah/irexpro` | Current `main` differs from `Chrix4u/irexpro`; active VPS staging and worktrees use the `Chrix4u` origin | **No runner / no deploy sudo authority.** Treat as mirror/alternate source until an explicit migration plan changes canonical ownership. |
| `christianagbotah/iassetspro` | Deployed SHA `3e3a8eff646501cdfdf0bd850054b688883df5ac` exists in both repos, but active VPS worktrees use `Chrix4u/iassetspro` and current mains have diverged | **No runner / no deploy sudo authority.** `Chrix4u/iassetspro` is canonical. |

Duplicate-source invariant: two GitHub repositories must never have deployment authority over the same VPS target.

## Development-only repositories observed

These repositories are active in GitHub but no active deployment authority was found in the current VPS Git-origin/PM2 inventory. Reclassify only after a repository-specific preflight.

| Repository | Visibility | Current classification / note |
| --- | --- | --- |
| `christianagbotah/vgroceries` | Public | Development-only — Variety Groceries project |
| `christianagbotah/eam-system` | Public | Development/reference — no active runtime evidence; current EAM runtime is iAssetsPro |
| `christianagbotah/smgh` | Public | Development-only |
| `christianagbotah/susuapp` | Public | Development-only |
| `christianagbotah/datus-international` | Private | Development-only; private-repo controls required if deployed later |

## Reference / excluded repositories

| Repository | Visibility | Reason |
| --- | --- | --- |
| `christianagbotah/v0-inventory-pos-system` | Private | Prototype/reference; do not onboard as a deployment source without explicit promotion |
| `christianagbotah/v0-xzz-maintenance-database` | Private | Prototype/reference |
| `christianagbotah/nextjs-dashboard` | Public | Learning/tutorial repository |
| `christianagbotah/nextjs-boilerplate` | Private | Boilerplate/template |
| `christianagbotah/nextjs` | Private | Generic/reference repository |

## TradeOS pilot evidence

The TradeOS pilot established the reference implementation for later repositories:

- repo-scoped runner user: `lwrun_tradeos`, shell disabled;
- runner: `lightworld-vps-tradeos-staging`, repo-scoped and non-root;
- runner labels: `self-hosted`, `linux`, `x64`, `lightworld-vps`, `staging`, `tradeos-staging`;
- runner sudo is restricted to the three TradeOS-specific status/deploy/rollback shims;
- root-owned registry lives under `/etc/lightworld-deploy/apps.d` and is not runner-writable;
- canonical remote `main` is verified independently of the Actions workspace;
- release content is generated with `git archive <verified-sha>`, never copied from mutable worktree files;
- app build runs as `lightworld`, not root;
- secrets remain outside Git and are linked from the root-selected server env path;
- activation occurs only after build success and bounded local/public readiness checks;
- PostgreSQL migration mode remains `manual` until a reliable production migration ledger exists;
- active TradeOS release after the pilot: `9e4595adc74d23767a0b86925df7d1af9c92f926` at the time of this snapshot;
- preserved pre-platform legacy release remains under `/home/lightworld/releases/tradeos-staging/legacy-*` until rollback proof and a later retention decision.

## Onboarding sequence

Create a small plan per canonical repository, in this order unless operational priority changes:

1. `Chrix4u/irexpro`
2. `Chrix4u/iassetspro`
3. `christianagbotah/schoolmanager`
4. `christianagbotah/ipresenterplux`
5. `christianagbotah/ifleet-system`
6. `christianagbotah/ibetpro`
7. `christianagbotah/lightworldtech-website`
8. private/remaining deployed apps after their repository-specific preflight

Do not reuse `lwrun_tradeos` for another repository. Every deployable repository receives its own Unix runner identity, runner labels, app-specific shims, lock, registry entry, and verification plan.
