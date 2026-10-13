# Lightworld GitHub VPS Runner Platform Design

Date: 2026-10-13
Status: proposed for written review
Supersedes: `2026-10-13-vps-self-hosted-runner-design.md`

## Purpose
Create one secure, auditable GitHub-to-VPS execution platform for Lightworld projects across both connected GitHub identities:

- `christianagbotah`
- `Chrix4u`

The platform removes Desktop Commander as a deployment dependency. Desktop Commander remains optional for interactive troubleshooting.

The first implementation target remains the existing Lightworld VPS. Production deployment automation is not enabled initially.

## Current GitHub scope discovered
### christianagbotah
The connected account currently exposes these repositories:

- `nextjs`
- `nextjs-dashboard`
- `nextjs-boilerplate`
- `v0-xzz-maintenance-database`
- `v0-inventory-pos-system`
- `datus-international`
- `eam-system`
- `ifleet-system`
- `smgh`
- `susuapp`
- `lightworldtech-website`
- `fovi`
- `vidora`
- `irexpro`
- `ibetpro`
- `iedupro`
- `schoolmanager`
- `ipresenterplux`
- `tradeos-africa`
- `iassetspro`
- `vgroceries`

### Chrix4u
The connected account currently exposes:

- `irexpro`
- `iassetspro`

This inventory is a discovery list, not an automatic deployment grant. Each repository is classified before runner registration as one of:

1. deployed application on the Lightworld VPS;
2. development-only repository;
3. archived/reference/legacy repository;
4. duplicate or mirror of another repository;
5. intentionally excluded.

For duplicate names across the two GitHub identities, the platform must determine the canonical deployment source before either repository can deploy.

## Success criteria
- GitHub can dispatch controlled jobs to the VPS for approved repositories under either GitHub identity.
- No runner process runs as `root`.
- No untrusted pull-request code executes on VPS runners.
- A workflow for one repository cannot deploy or mutate another repository's application.
- Existing Webuzo, nginx, PostgreSQL, PM2 and application configuration remain intact during runner onboarding.
- Each deployed application has an explicit mapping from repository to VPS path, process names, health checks and rollback location.
- Manual staging deployment works without Desktop Commander.
- GitHub Actions provides an audit trail of every runner dispatch and deployment.
- Failed builds do not replace the currently running application.
- Concurrent deployments for the same application are serialized.
- Duplicate repositories cannot both control the same deployment target unless an explicit migration/cutover plan authorizes that state.

## Recommended architecture
Use multiple repo-scoped self-hosted runner instances on the same VPS, standardized by a shared Lightworld layout and installation procedure.

```text
GitHub account: christianagbotah        GitHub account: Chrix4u
          |                                      |
          +------------------+-------------------+
                             |
                      GitHub Actions
                             |
          +------------------+-------------------+
          |                  |                   |
          v                  v                   v
   tradeos runner     irexpro runner      iassetspro runner
          |                  |                   |
          v                  v                   v
   approved wrapper    approved wrapper     approved wrapper
          |                  |                   |
          v                  v                   v
   TradeOS staging     iRexPro staging      iAssetsPro staging
```

Other approved repositories follow the same pattern.

## Why repo-scoped runners
The repositories currently span two personal GitHub accounts. Repo-scoped runners provide the strongest practical isolation now:

- registration is explicit per repository;
- runner labels identify the exact deployment target;
- a compromised workflow in one repository does not automatically inherit another repository's runner;
- migration to a future Lightworld GitHub organization remains possible later.

An organization-level runner pool is a future optimization, not the initial design.

## VPS runner layout
Use a dedicated Unix service identity, not root. Preferred base account:

`lightworldrunner`

Runner instances live below:

`/opt/github-runners/<owner>/<repo>/<environment>`

Examples:

- `/opt/github-runners/christianagbotah/tradeos-africa/staging`
- `/opt/github-runners/christianagbotah/irexpro/staging`
- `/opt/github-runners/Chrix4u/iassetspro/staging`

Each runner receives explicit labels, for example:

- `self-hosted`
- `linux`
- `x64`
- `lightworld-vps`
- `staging`
- `tradeos-staging`

The final label is unique to the application/environment.

## Repository-to-application registry
Before installing multiple runners, create a server-side registry owned by root, for example:

`/etc/lightworld-deploy/apps.d/`

Each approved application has a declarative mapping containing only non-secret operational metadata:

- canonical GitHub repository;
- VPS checkout/deploy path;
- environment name;
- PM2/service names;
- deployment wrapper path;
- local health endpoints;
- public health/root endpoints;
- rollback directory;
- migration policy;
- runtime/toolchain family.

Secrets stay in existing VPS environment/configuration files and are never copied into GitHub.

## Security model
### 1. No PR execution on VPS
Self-hosted deployment workflows must never use `pull_request` as the execution trigger. Existing tests, CI and visual QA remain on GitHub-hosted workers.

Initial trigger policy is `workflow_dispatch` only. Automatic deployment from protected `main` may be added later after successful manual operation.

### 2. Least privilege
`lightworldrunner` receives no unrestricted sudo and no interactive root shell.

Privileged operations are exposed only through root-owned, non-writable wrappers such as:

- `/usr/local/sbin/lightworld-deploy tradeos-africa staging <sha>`
- `/usr/local/sbin/lightworld-status tradeos-africa staging`
- `/usr/local/sbin/lightworld-rollback tradeos-africa staging`

The wrapper validates repository, environment, requested commit and configured deployment target before acting.

### 3. Cross-project isolation
A runner registered to one repository may only invoke the wrapper for its configured application identity.

The deployment registry is not writable by the runner account.

Staging application checkouts must not be shared writable workspaces between unrelated runners.

### 4. Duplicate-repository protection
`christianagbotah/irexpro` and `Chrix4u/irexpro`, and similarly the two `iassetspro` repositories, must be inspected before runner registration.

Only one canonical repository receives deployment authority for an application target unless a deliberate migration/cutover requires temporary dual access.

### 5. Secrets
Never commit:

- runner registration tokens;
- VPS/root passwords;
- SSH private keys;
- database credentials;
- `.env` files;
- API tokens;
- application signing secrets.

Runner registration tokens are short-lived and used only during installation.

## Deployment workflow standard
Every onboarded application gets a small workflow using the same contract:

1. manual dispatch;
2. verify requested ref/commit;
3. target the repository-specific runner label;
4. call the constrained Lightworld deployment wrapper;
5. stream deployment output to GitHub Actions;
6. report deployed SHA, application status and health results.

Application-specific build details live in the server-side registry/wrapper or repository-owned deployment script, not duplicated ad hoc in every workflow.

## Controlled deployment sequence
The common wrapper performs these phases where applicable:

1. acquire an application/environment deployment lock;
2. resolve the canonical repository and target path;
3. record current deployed SHA and rollback metadata;
4. fetch the requested commit;
5. verify repository identity and commit/ref policy;
6. prepare/build without replacing the active release where practical;
7. install dependencies with the repository's locked dependency mechanism;
8. run project-specific validation required for deployment;
9. run backward-compatible migrations using the canonical project mechanism;
10. activate the release atomically where practical;
11. restart only the configured application processes;
12. verify local health;
13. verify public health/root where configured;
14. print deployment summary;
15. release deployment lock.

## Runtime diversity
The platform must support different application families without forcing them into one build command. Expected adapters include:

- Node/Next.js/PNPM applications;
- PHP/CodeIgniter applications;
- Python services;
- mixed frontend/backend monorepos;
- desktop build repositories that may use GitHub-hosted CI but have no VPS deployment.

A repository is onboarded only after its real runtime/deployment path is inspected.

## Rollback
Each deployed application/environment records:

- previous Git SHA;
- active release/build identifier where applicable;
- deployment timestamp;
- migration state/compatibility note;
- process status before and after activation.

The standard platform exposes an explicit rollback command, but rollback is enabled per application only after its activation model has been verified.

## Operational commands
The platform may expose only explicit maintenance operations, for example:

- status;
- health-check;
- deploy staging;
- restart configured process;
- rollback last staging release;
- collect bounded application log tail.

It does not expose a generic arbitrary-root-shell workflow.

## Installation phases
### Phase 0 — portfolio inventory
For both GitHub accounts:

- classify each repository;
- identify which repositories currently deploy to the VPS;
- map VPS paths and processes;
- identify duplicate/mirror repositories;
- select canonical repository per deployed app.

### Phase 1 — platform bootstrap
On the VPS:

- create `lightworldrunner` service account;
- create `/opt/github-runners` hierarchy;
- create root-owned `/etc/lightworld-deploy` registry;
- create constrained deployment/status wrapper skeleton;
- add narrow sudoers policy;
- do not touch application processes yet.

### Phase 2 — TradeOS pilot
TradeOS remains the pilot because its staging path, PM2 process names and health endpoints are already known.

- register repo-scoped TradeOS runner;
- run harmless diagnostic workflow;
- add manual staging deployment workflow;
- deploy current known-good main commit;
- verify health and rollback metadata.

### Phase 3 — active christianagbotah projects
Onboard active VPS applications one by one, prioritizing:

- `irexpro`
- `iassetspro`
- `schoolmanager`
- `ipresenterplux`
- `ifleet-system`
- `ibetpro`
- `lightworldtech-website`
- other currently hosted applications discovered during inventory.

### Phase 4 — Chrix4u repositories
Inspect `Chrix4u/irexpro` and `Chrix4u/iassetspro` against their `christianagbotah` counterparts.

If a Chrix4u repository is canonical, register its runner and workflow there. If it is a mirror/legacy source, classify it accordingly and do not give it duplicate deployment authority.

### Phase 5 — remaining repositories
Add development-only CI or deployment capability as appropriate. Repositories that do not deploy to the VPS do not receive a VPS runner merely because they exist on GitHub.

### Phase 6 — optional organization migration
If Lightworld later moves repositories into a GitHub organization, consolidate policy using organization runner groups while preserving application-level deployment isolation.

## Runner resource control
Because all runner instances share one VPS, jobs must not create uncontrolled parallel CPU/memory/disk pressure.

Initial policy:

- one deployment job per application/environment at a time;
- heavyweight builds remain on GitHub-hosted runners where practical;
- deployment runner consumes verified artifacts or performs only necessary server-specific build steps;
- avoid simultaneous heavyweight deployments across applications until VPS resource behavior is measured;
- preserve disk-space rollback limits and clean old releases deliberately.

## Failure handling
- Runner offline: GitHub-hosted CI remains available; deployment is visibly queued/failed.
- Build failure: active release stays unchanged.
- Migration failure: deployment stops before activation where possible.
- Health failure: deployment fails and rollback path is reported.
- Duplicate deployment request: application lock serializes or rejects it.
- Wrong repository/application mapping: wrapper fails closed.
- One compromised runner: registry/sudo policy prevents unrestricted access to other application targets.

## Relationship to Desktop Commander
Desktop Commander remains optional for direct interactive diagnostics. The permanent operational path becomes:

GitHub-hosted CI -> approved repository workflow -> repo-scoped VPS runner -> constrained Lightworld deployment wrapper -> application health verification.

## Out of scope
- unrestricted root shell through GitHub Actions;
- executing arbitrary user-provided shell through workflow inputs;
- running untrusted PR code on VPS runners;
- automatically deploying every repository simply because it exists;
- production deployment automation in the first rollout;
- moving applications to another hosting provider;
- replacing Webuzo/nginx/PostgreSQL/PM2;
- merging the two GitHub accounts or moving repositories automatically.
