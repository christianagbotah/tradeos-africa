# TradeOS VPS Self-Hosted Runner Design

Date: 2026-10-13
Status: proposed for review

## Purpose
Create a permanent, auditable GitHub-to-VPS execution path for TradeOS so staging deployment and controlled maintenance no longer depend on Desktop Commander being connected.

The first target is TradeOS staging at `/home/lightworld/webapps/tradeos-staging`. Desktop Commander remains useful for interactive troubleshooting, but it is no longer a deployment dependency.

## Success criteria
- GitHub can dispatch a controlled job to the existing Interserver VPS.
- The runner is not installed or executed as `root`.
- Pull-request code never runs directly on the VPS runner.
- Existing Webuzo, nginx, PostgreSQL and PM2 configuration is left untouched during runner registration.
- Staging deploys can update the checked-out application, install with the frozen lockfile, run repository-approved migrations/build steps, restart only the TradeOS staging processes, verify health, and fail visibly if any step fails.
- A failed deploy has a defined rollback path.
- Runner installation is independent of Desktop Commander.
- GitHub Actions provides an audit trail of every dispatch and deployment.

## Architecture
```text
Developer / ChatGPT
        |
        v
GitHub repository
        |
        +--> hosted CI / tests / visual QA
        |
        v
approved main commit
        |
        v
GitHub Actions deployment workflow
        |
        v
repo-scoped self-hosted runner on VPS
        |
        v
constrained TradeOS deployment command
        |
        +--> /home/lightworld/webapps/tradeos-staging
        +--> database migration command
        +--> tradeos-staging-api PM2 process
        +--> tradeos-staging-web PM2 process
        +--> local/public health checks
```

## Runner identity and isolation
Create a dedicated Unix account such as `tradeosrunner`.

The GitHub Actions runner lives under `/opt/github-runners/tradeos-staging` and runs as `tradeosrunner`, not `root`.

The runner is repository-scoped to `christianagbotah/tradeos-africa` and receives explicit labels: `self-hosted`, `linux`, `x64`, `tradeos-staging`.

## Security model
### No untrusted PR execution
The VPS runner is never used for `pull_request` jobs. Existing CI and Visual QA remain on GitHub-hosted workers. Initial VPS trigger policy is manual `workflow_dispatch`; automatic protected-main deployment may be added later.

### Least privilege
The runner account receives no unrestricted sudo. Installation first inspects staging ownership, PM2 ownership and existing migration/start scripts. Preferred model: a root-owned non-writable deployment wrapper exposes only approved TradeOS staging operations; `tradeosrunner` may invoke that one command through a narrow sudoers rule.

### Secrets
The short-lived runner registration token is used only during setup and never committed. Root passwords, SSH keys, database credentials, `.env.staging`, refresh tokens and API tokens remain on the VPS and never enter the repository.

## Deployment workflow
Add `.github/workflows/deploy-staging.yml`, initially manual only. The job targets `[self-hosted, linux, x64, tradeos-staging]` and invokes the constrained local deployment command rather than arbitrary privileged shell operations.

Recommended controlled deployment sequence:
1. Acquire a deployment lock.
2. Record current deployed SHA and active Web build as rollback metadata.
3. Fetch the requested ref and verify it belongs to the repository.
4. Move staging to the exact requested commit.
5. Install with `pnpm install --frozen-lockfile` when needed.
6. Run deployment-appropriate validation/build steps.
7. Run migrations through the canonical repository mechanism.
8. Build Web in an isolated/release path while current Web stays available.
9. Activate the new build atomically where practical.
10. Restart only `tradeos-staging-api` and `tradeos-staging-web` as required.
11. Verify local API and Web health.
12. Verify public `/health` and public root.
13. Print deployed SHA, process status and health summary into GitHub Actions logs.
14. Release the deployment lock.

Exact commands are derived from the repository and current VPS ownership/process configuration during implementation rather than guessed.

## Rollback
Record previous Git SHA, previous Web build/build ID where applicable, and deployment timestamp. Add a controlled rollback operation after the initial deploy path is proven. Normal automated staging migrations must be backward-compatible/additive.

## Maintenance boundary
Do not expose a generic `run any shell command` workflow. Future explicit operations may include `status`, `health-check`, `restart-web`, `restart-api`, `tail-application-log`, and `rollback-last-staging-release`.

## Installation phases
### Phase 1 — Register only
- create runner user and directory;
- download and verify the official GitHub Actions runner package/hash shown by GitHub;
- register it against this repository;
- install/start its service;
- confirm the runner appears online;
- run a harmless identity/diagnostic job only.

No application deployment occurs in Phase 1.

### Phase 2 — Constrained staging deployment
- inspect current staging and PM2 ownership;
- add the approved deploy wrapper and narrow permissions;
- add manual staging deployment workflow;
- deploy the current known-good `main` SHA;
- validate process stability and public health.

### Phase 3 — Optional automation
After several successful manual deployments, optionally deploy staging automatically after all hosted CI gates succeed for `main`.

Production deployment is explicitly out of scope.

## Failure handling
- Runner offline: hosted CI still works; deployment remains visibly queued/failed.
- Build failure: current live staging is not replaced.
- Migration failure: deployment stops before activation.
- Restart/health failure: deployment is marked failed and rollback is available/documented.
- Concurrent deployment: second deploy exits or waits on the deployment lock.

## Relationship to Desktop Commander
Desktop Commander becomes optional for interactive inspection/troubleshooting. GitHub-hosted CI plus the self-hosted staging runner form the permanent audited deployment path.

## Out of scope
- unrestricted root shell through GitHub Actions;
- running untrusted pull-request jobs on the VPS;
- production deployment automation;
- moving the VPS to another host;
- replacing Webuzo/nginx/PostgreSQL/PM2;
- storing server secrets in the repository.
