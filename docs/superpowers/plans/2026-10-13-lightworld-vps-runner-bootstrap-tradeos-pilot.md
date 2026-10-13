# Lightworld VPS Runner Bootstrap + TradeOS Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable Lightworld GitHub-to-VPS runner foundation and prove it safely with a manual TradeOS staging deployment before onboarding other repositories from `christianagbotah` and `Chrix4u`.

**Architecture:** GitHub-hosted CI remains the trust gate. A repo-scoped, non-root self-hosted runner invokes root-owned, fail-closed Lightworld deployment wrappers through a narrow sudo rule. The wrapper validates the application/environment/SHA/workspace, prepares an isolated release, runs project work as the existing application user, activates only after build/health preconditions succeed, and records rollback metadata.

**Tech Stack:** GitHub Actions, Bash, Node 22, pnpm 10.17.1, PM2, PostgreSQL, Next.js 16, Fastify, Linux systemd/GitHub Actions runner.

**Spec:** `docs/superpowers/specs/2026-10-13-lightworld-github-vps-runner-platform-design.md`

## Global Constraints

- Runner processes must not run as `root`.
- No self-hosted runner workflow may execute on `pull_request`.
- Initial deployment trigger is `workflow_dispatch` only and must fail closed unless `github.ref == 'refs/heads/main'`.
- Existing Webuzo, nginx, PostgreSQL and PM2 configuration must not be replaced during runner bootstrap.
- Root-owned deployment configuration under `/etc/lightworld-deploy` must not be writable by `lightworldrunner`.
- No generic arbitrary-root-shell workflow or unrestricted sudo entry.
- Each repository/application/environment gets a unique runner label and deployment lock.
- Secrets, `.env` files, database credentials, SSH keys and runner registration tokens stay off GitHub.
- Failed builds must not replace the currently active release.
- Duplicate/mirror repositories across `christianagbotah` and `Chrix4u` must not both receive deployment authority for the same target.
- Heavy deployment work is serialized initially to protect VPS CPU, memory and disk.
- Production deployment automation is out of scope for this plan.

## Review Focus

- A workflow dispatched from a non-`main` ref must never reach a privileged deployment command.
- A malicious or malformed app/environment/SHA/workspace argument must be rejected before any privileged filesystem or process action.
- A runner for one repository must not be able to target another application registry entry.
- Build or health failure must leave the prior PM2 release available and report the failed SHA.
- A missing/unsafe root-owned registry file, writable config, missing env file, or unknown migration state must fail closed rather than guess.

---

### Task 1: Add the repository-side platform contract and tests

**Files:**
- Create: `test/lightworld-vps-platform.test.mjs`
- Create: `ops/lightworld-vps/README.md`
- Create: `ops/lightworld-vps/lib/common.sh`
- Create: `ops/lightworld-vps/bin/lightworld-status`
- Create: `ops/lightworld-vps/bin/lightworld-deploy`
- Create: `ops/lightworld-vps/bin/lightworld-rollback`
- Modify: `package.json`

**Interfaces:**
- Produces CLI contracts:
  - `lightworld-status <app> <environment>`
  - `lightworld-deploy <app> <environment> <sha> <workspace>`
  - `lightworld-rollback <app> <environment>`
- Produces shared Bash functions in `common.sh`: `validate_identifier`, `validate_sha`, `load_app_config`, `acquire_app_lock`, `assert_workspace_identity`.

- [ ] **Step 1: Write the failing platform contract tests**

Add Node `node:test` cases that assert the three executables exist, begin with Bash + `set -euo pipefail`, source only the shared library, contain no `eval`, accept only the documented arity, reject path traversal identifiers, require a 40-hex SHA for deploy, and never expose an arbitrary command argument.

Include a test that runs `lightworld-deploy` in non-root test mode against a temporary fake registry and asserts `../other-app`, `prod;id`, a bad SHA, and a workspace whose Git origin does not match the configured repository all fail before the fake deploy action marker is written.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL because `ops/lightworld-vps/...` does not exist.

- [ ] **Step 3: Implement the minimal shared validation and command skeletons**

`common.sh` must validate app/environment with `^[A-Za-z0-9][A-Za-z0-9._-]*$`, deploy SHA with `^[0-9a-fA-F]{40}$`, load exactly `/etc/lightworld-deploy/apps.d/<app>.<environment>.conf` in production, and refuse configs that are not root-owned or are group/other writable. A test-only root override is permitted only when `LIGHTWORLD_TEST_MODE=1` and EUID is non-zero.

`assert_workspace_identity(workspace, expected_repo, expected_sha)` must require a real Git worktree, exact `HEAD == expected_sha`, and a normalized origin matching the configured `owner/repo`.

- [ ] **Step 4: Wire the root test command into `pnpm test`**

Prepend `node --test test/lightworld-vps-platform.test.mjs` next to the existing deployment config test without weakening the existing test sequence.

- [ ] **Step 5: Run focused + existing deployment tests**

Run: `node --test test/lightworld-vps-platform.test.mjs test/deployment-config.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json test/lightworld-vps-platform.test.mjs ops/lightworld-vps
git commit -m "feat(ops): add Lightworld VPS deployment contract"
```

### Task 2: Implement constrained release preparation, status and rollback semantics

**Files:**
- Modify: `ops/lightworld-vps/lib/common.sh`
- Modify: `ops/lightworld-vps/bin/lightworld-status`
- Modify: `ops/lightworld-vps/bin/lightworld-deploy`
- Modify: `ops/lightworld-vps/bin/lightworld-rollback`
- Modify: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- Consumes the Task 1 CLI contracts and registry loader.
- Registry contract requires: `GITHUB_REPO`, `APP_USER`, `RELEASE_ROOT`, `CURRENT_LINK`, `ENV_FILE`, `PROCESS_MANAGER`, `PROCESS_NAMES`, `LOCAL_HEALTH_URLS`, `PUBLIC_HEALTH_URLS`, `RUNTIME_FAMILY`, `MIGRATION_MODE`.
- Produces rollback metadata at `<RELEASE_ROOT>/.lightworld/last-successful-release` and `<RELEASE_ROOT>/.lightworld/previous-release`.

- [ ] **Step 1: Extend tests for cross-project isolation, locks and failed activation**

Use temporary fake registry entries for `tradeos-africa.staging` and `other-app.staging`. Assert a command scoped to TradeOS rejects a workspace whose origin is the other repo; concurrent deploy attempts cannot both acquire the same app lock; and a simulated build/health failure never changes the fake `CURRENT_LINK`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL on missing release/lock/rollback behavior.

- [ ] **Step 3: Implement release lifecycle without running repository code as root**

`lightworld-deploy` must:
1. load and validate the registry;
2. acquire a global heavy-deploy lock plus app/environment lock;
3. validate workspace origin + SHA;
4. create `<RELEASE_ROOT>/<sha>`;
5. copy the checked-out workspace without Git credentials/secrets;
6. set ownership to `APP_USER`;
7. link the configured server env file only after verifying it exists and is not inside the Git workspace;
8. run dependency/build commands through the runtime adapter as `APP_USER`, never root;
9. refuse automatic migrations while `MIGRATION_MODE=manual`;
10. activate only after build succeeds;
11. restart only configured processes;
12. verify all local then public health URLs;
13. update successful/previous release metadata only after health passes.

On activation health failure, immediately reactivate the previous release and return non-zero.

- [ ] **Step 4: Implement read-only status and explicit rollback**

`lightworld-status` prints configured repo, active release SHA, previous release SHA, configured process names and bounded health results without printing environment contents.

`lightworld-rollback` accepts no SHA argument; it may only switch to the recorded previous successful release, restart configured processes and require health success.

- [ ] **Step 5: Run tests**

Run: `node --test test/lightworld-vps-platform.test.mjs test/deployment-config.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ops/lightworld-vps test/lightworld-vps-platform.test.mjs
git commit -m "feat(ops): add isolated release and rollback controls"
```

### Task 3: Add host bootstrap assets and the harmless runner diagnostic workflow

**Files:**
- Create: `ops/lightworld-vps/install/bootstrap-host.sh`
- Create: `ops/lightworld-vps/install/install-platform-files.sh`
- Create: `ops/lightworld-vps/sudoers/lightworldrunner`
- Create: `.github/workflows/vps-runner-diagnostic.yml`
- Modify: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- Produces VPS layout: `/opt/github-runners`, `/etc/lightworld-deploy/apps.d`, `/var/lib/lightworld-deploy`, `/var/lock/lightworld-deploy`.
- Service user: `lightworldrunner` with no interactive password and no unrestricted sudo.
- Diagnostic runner label: `tradeos-staging` plus `self-hosted`, `linux`, `x64`, `lightworld-vps`, `staging`.

- [ ] **Step 1: Add failing static security tests**

Assert the sudoers template permits only `/usr/local/sbin/lightworld-status`, `/usr/local/sbin/lightworld-deploy`, and `/usr/local/sbin/lightworld-rollback`; contains no `ALL=(ALL) ALL`, shell, package manager, editor or wildcard executable grant.

Assert the diagnostic workflow has only `workflow_dispatch`, `permissions: contents: read`, the exact runner labels, no `pull_request`, no secrets dump, and only runs identity/status diagnostics.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL because bootstrap/sudoers/workflow files do not exist.

- [ ] **Step 3: Implement idempotent host bootstrap files**

`bootstrap-host.sh` creates the service account and directories with explicit owners/modes but does not download/register a GitHub runner and does not touch PM2/Webuzo/nginx/PostgreSQL.

`install-platform-files.sh` copies root-owned wrappers/library/sudoers, validates with `bash -n` and `visudo -cf`, and refuses to install from a dirty or unexpected source path unless `--source` is explicit.

- [ ] **Step 4: Add the diagnostic workflow**

The workflow must not checkout repository code. It runs `id`, bounded disk/memory checks, and `sudo -n /usr/local/sbin/lightworld-status tradeos-africa staging` only after the TradeOS registry is installed.

- [ ] **Step 5: Run tests + shell syntax checks**

Run: `node --test test/lightworld-vps-platform.test.mjs && bash -n ops/lightworld-vps/install/*.sh ops/lightworld-vps/bin/* ops/lightworld-vps/lib/*.sh`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ops/lightworld-vps .github/workflows/vps-runner-diagnostic.yml test/lightworld-vps-platform.test.mjs
git commit -m "feat(ops): add secure VPS runner bootstrap"
```

### Task 4: Add the TradeOS staging registry template and deployment workflow

**Files:**
- Create: `ops/lightworld-vps/apps/tradeos-africa.staging.conf.example`
- Create: `.github/workflows/deploy-staging.yml`
- Modify: `test/lightworld-vps-platform.test.mjs`
- Modify: `docs/superpowers/specs/2026-10-13-lightworld-github-vps-runner-platform-design.md` only to mark the approved spec status if still labelled proposed.

**Interfaces:**
- Canonical repo: `christianagbotah/tradeos-africa`.
- Existing PM2 process names: `tradeos-staging-api`, `tradeos-staging-web`.
- Existing application user: `lightworld`.
- Existing local ports: API `4036`, Web `3036`.
- Workflow passes `github.sha` and `${{ github.workspace }}` to `lightworld-deploy` after `actions/checkout@v4` with `persist-credentials: false`.

- [ ] **Step 1: Add failing workflow/profile tests**

Assert the profile contains the canonical repo/process names/app user/runtime family, keeps `MIGRATION_MODE=manual` for the first pilot, and does not contain a secret value.

Assert `deploy-staging.yml` has only `workflow_dispatch`, job-level `if: github.ref == 'refs/heads/main'`, `concurrency: tradeos-staging`, exact runner labels, `permissions: contents: read`, checkout with `persist-credentials: false`, and a single privileged action: `sudo -n /usr/local/sbin/lightworld-deploy tradeos-africa staging "$GITHUB_SHA" "$GITHUB_WORKSPACE"`.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL on missing profile/workflow.

- [ ] **Step 3: Implement the profile template and workflow**

The template pins `APP_USER=lightworld`, process names above, `RUNTIME_FAMILY=pnpm-node`, release root `/home/lightworld/releases/tradeos-staging`, and known local health checks `http://127.0.0.1:4036/health` plus `http://127.0.0.1:3036/`.

Do not guess the live public API route or env-file location in Git. Those are mandatory install-time registry values read from the current VPS configuration before the real root-owned profile is created.

- [ ] **Step 4: Run repository verification**

Run: `pnpm test && pnpm typecheck && pnpm build && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ops/lightworld-vps/apps .github/workflows/deploy-staging.yml test/lightworld-vps-platform.test.mjs docs/superpowers/specs/2026-10-13-lightworld-github-vps-runner-platform-design.md
git commit -m "feat(ops): add TradeOS staging runner workflow"
```

### Task 5: Bootstrap the VPS and register the TradeOS repo-scoped runner

**Files on VPS:**
- Create: `/opt/github-runners/christianagbotah/tradeos-africa/staging/`
- Create: `/etc/lightworld-deploy/apps.d/tradeos-africa.staging.conf`
- Install: `/usr/local/sbin/lightworld-{status,deploy,rollback}`
- Install: `/usr/local/lib/lightworld-deploy/common.sh`
- Install: `/etc/sudoers.d/lightworldrunner`

**Interfaces:**
- Consumes the exact GitHub runner download URL/hash/token generated by GitHub Settings → Actions → Runners for `christianagbotah/tradeos-africa`.
- Produces an online repo-scoped runner named `lightworld-vps-tradeos-staging` with the approved labels.

- [ ] **Step 1: Capture a read-only VPS preflight**

Run as root and save only non-secret output: OS/arch, `id lightworld`, `pm2 ls`, `pm2 prettylist` process names/cwd/user fields, `readlink -f /home/lightworld/webapps/tradeos-staging`, directory ownership/modes, Node/pnpm versions, disk/memory, and Webuzo/nginx proxy targets. Do not print `.env.staging` contents.

Expected: confirm the PM2 names and ports already represented by repository deployment tests; identify the actual stable env-file path and public health URLs for the root-owned registry.

- [ ] **Step 2: Run the host bootstrap only**

Execute `bootstrap-host.sh`, then verify:

```bash
id lightworldrunner
getent passwd lightworldrunner
stat -c '%U %G %a %n' /opt/github-runners /etc/lightworld-deploy /etc/lightworld-deploy/apps.d
```

Expected: non-root service user; registry root-owned and not runner-writable.

- [ ] **Step 3: Install wrappers + real TradeOS registry**

Copy the approved files, fill only the non-secret deployment metadata learned in Step 1, run `visudo -cf /etc/sudoers.d/lightworldrunner`, then verify `sudo -l -U lightworldrunner` shows only the three approved wrapper commands.

- [ ] **Step 4: Register the GitHub runner using GitHub's current generated commands**

Download the runner package and verify the SHA-256 exactly as GitHub displays. Run `./config.sh` as `lightworldrunner`, never root, using the short-lived repo registration token; labels: `lightworld-vps,staging,tradeos-staging`; runner name: `lightworld-vps-tradeos-staging`.

Install/start the runner service using GitHub's `svc.sh` under the configured runner identity.

- [ ] **Step 5: Verify diagnostic workflow before any deployment**

Dispatch `VPS Runner Diagnostic` from `main` and require green output for user identity, resource checks and `lightworld-status`.

Expected: no application restart, migration or build occurs.

### Task 6: Execute the TradeOS staging pilot and prove rollback

**Files:**
- Update: `docs/ops/lightworld-vps-repository-inventory.md`
- Create: `docs/ops/lightworld-vps-onboarding-template.md`

**Interfaces:**
- Consumes the online runner and deploy workflow.
- Produces a proven Lightworld deployment contract reusable for later repository-specific plans.

- [ ] **Step 1: Record pre-deployment state**

Capture current public root response, local API `/health`, local Web root, PM2 status, currently deployed Git SHA and database migration inventory. Back up the current application config/environment metadata without committing secrets.

- [ ] **Step 2: Keep migrations fail-closed for the first pilot**

Because TradeOS currently stores ordered SQL migrations without a production migration ledger, leave `MIGRATION_MODE=manual`. If the selected `main` SHA contains unapplied migrations relative to staging, stop the deployment and create a separate migration-baseline task before proceeding. Do not automatically replay all SQL files against an existing database.

- [ ] **Step 3: Dispatch the staging deployment from `main`**

Require hosted CI green for the exact SHA, then manually dispatch `Deploy Staging`. Verify the runner checks out the exact SHA, prepares the isolated release, builds as `lightworld`, activates only after success, restarts only `tradeos-staging-api` and `tradeos-staging-web`, and passes local + public health checks.

- [ ] **Step 4: Prove rollback without introducing a broken release**

Use the explicit rollback command to move to the recorded previous successful release, verify both local/public health, then deploy the approved main SHA again. This tests the rollback mechanism without intentionally corrupting staging.

- [ ] **Step 5: Build the portfolio inventory and onboarding template**

The inventory must list every repository discovered under both GitHub identities and classify each as deployed, development-only, archived/reference, duplicate/mirror, or excluded. For `irexpro` and `iassetspro`, explicitly compare `christianagbotah/*` with `Chrix4u/*` and record only one canonical deployment source per application.

The onboarding template requires: canonical repo, runtime family, VPS path, app user, process manager/process names, env path, local/public health, build command, migration policy, release/rollback model, runner label, resource class and verification commands.

- [ ] **Step 6: Run final platform verification**

Repository:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

VPS:

```bash
sudo -u lightworldrunner -H id
sudo -l -U lightworldrunner
systemctl --no-pager --full status 'actions.runner.*tradeos*'
sudo -n /usr/local/sbin/lightworld-status tradeos-africa staging
pm2 ls
curl -fsS http://127.0.0.1:4036/health
curl -fsS http://127.0.0.1:3036/ >/dev/null
```

Expected: repository green; runner online/non-root; narrow sudo; TradeOS healthy; deployed SHA reported.

- [ ] **Step 7: Commit operational docs**

```bash
git add docs/ops
git commit -m "docs: record Lightworld runner pilot and onboarding contract"
```

## Follow-up execution sequence after this plan

After the TradeOS pilot is proven, create small repository-specific onboarding plans from the template instead of one giant cross-project implementation. Priority order from the approved spec: `irexpro`, `iassetspro`, `schoolmanager`, `ipresenterplux`, `ifleet-system`, `ibetpro`, `lightworldtech-website`, then other deployed apps discovered during inventory. `Chrix4u/irexpro` and `Chrix4u/iassetspro` receive runners only if the inventory determines they are the canonical deployment repositories.
