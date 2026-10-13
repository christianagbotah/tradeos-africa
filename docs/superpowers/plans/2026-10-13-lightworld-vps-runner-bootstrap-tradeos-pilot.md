# Lightworld VPS Runner Bootstrap + TradeOS Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable Lightworld GitHub-to-VPS runner foundation and prove it safely with a manual TradeOS staging deployment before onboarding other repositories from `christianagbotah` and `Chrix4u`.

**Architecture:** GitHub-hosted CI remains the trust gate. Each deployable repository gets its own non-root Unix runner identity; the TradeOS pilot uses `lwrun_tradeos`. That runner can sudo only three root-owned TradeOS-specific shims, which hardcode the application/environment and call generic fail-closed Lightworld deployment logic. The generic layer validates the SHA/workspace/canonical repo, independently verifies that the requested SHA is the canonical `main` head, prepares an isolated release, runs project work as the existing application user, activates only after build preconditions succeed, and records rollback metadata.

**Security refinement from plan self-review:** the approved design's preferred shared `lightworldrunner` identity is strengthened here to one Unix runner identity per deployable repository. A shared Unix identity cannot honestly guarantee that a compromised workflow from repository A cannot invoke repository B's sudoable deployment command. This plan therefore enforces repository isolation at the operating-system and sudoers layers, not only in workflow labels.

**Tech Stack:** GitHub Actions, Bash, Node 22, pnpm 10.17.1, PM2, PostgreSQL, Next.js 16, Fastify, Linux systemd/GitHub Actions runner.

**Spec:** `docs/superpowers/specs/2026-10-13-lightworld-github-vps-runner-platform-design.md`

## Global Constraints

- Runner processes must not run as `root`.
- Each deployable repository must use a distinct Unix runner identity; the TradeOS pilot identity is `lwrun_tradeos`.
- Generic deployment executables are installed under `/usr/local/libexec/lightworld-deploy/` and are not directly sudoable by runner users.
- A runner user may sudo only repository/environment-specific shims that hardcode its deployment target.
- No self-hosted runner workflow may execute on `pull_request`.
- Initial deployment trigger is `workflow_dispatch` only; the workflow also checks `github.ref == 'refs/heads/main'`, but the root-owned deploy layer must independently require the SHA to equal the canonical remote `refs/heads/main` head.
- Existing Webuzo, nginx, PostgreSQL and PM2 configuration must not be replaced during runner bootstrap.
- Root-owned deployment configuration under `/etc/lightworld-deploy` must not be writable by any runner account.
- No generic arbitrary-root-shell workflow or unrestricted sudo entry.
- Each repository/application/environment gets a unique runner label and deployment lock.
- Secrets, `.env` files, database credentials, SSH keys and runner registration tokens stay off GitHub.
- Failed builds must not replace the currently active release.
- Duplicate/mirror repositories across `christianagbotah` and `Chrix4u` must not both receive deployment authority for the same target.
- Heavy deployment work is serialized initially to protect VPS CPU, memory and disk.
- Production deployment automation is out of scope for this plan.

## Review Focus

- A workflow dispatched or rewritten on a non-`main` ref must still be unable to deploy because the root-owned layer independently verifies the canonical `main` SHA.
- A malicious or malformed app/environment/SHA/workspace argument must be rejected before any privileged filesystem or process action.
- A compromised runner for one repository must have neither Unix permissions nor sudo permissions for another application's deployment shims.
- Build or health failure must leave or restore the prior PM2 release and report the failed SHA.
- A missing/unsafe root-owned registry file, writable config, missing env file, unknown migration state, or unverifiable canonical main ref must fail closed rather than guess.

---

### Task 1: Add the repository-side platform contract and tests

**Files:**
- Create: `test/lightworld-vps-platform.test.mjs`
- Create: `ops/lightworld-vps/README.md`
- Create: `ops/lightworld-vps/lib/common.sh`
- Create: `ops/lightworld-vps/libexec/lightworld-status`
- Create: `ops/lightworld-vps/libexec/lightworld-deploy`
- Create: `ops/lightworld-vps/libexec/lightworld-rollback`
- Modify: `package.json`

**Interfaces:**
- Generic root-owned internal contracts:
  - `lightworld-status <app> <environment>`
  - `lightworld-deploy <app> <environment> <sha> <workspace>`
  - `lightworld-rollback <app> <environment>`
- Shared Bash functions: `validate_identifier`, `validate_sha`, `load_app_config`, `acquire_app_lock`, `assert_workspace_identity`, `verify_canonical_main_sha`.
- The generic commands are installed under `/usr/local/libexec/lightworld-deploy/`; runner users never receive direct sudo permission to them.

- [ ] **Step 1: Write the failing platform contract tests**

Add Node `node:test` cases that assert the three internal executables exist, begin with Bash + `set -euo pipefail`, contain no `eval`, accept only documented arity, reject path traversal identifiers, require a 40-hex SHA for deploy, and never expose an arbitrary command argument.

Run `lightworld-deploy` in non-root test mode against a temporary fake registry and assert `../other-app`, `prod;id`, a bad SHA, a workspace whose Git origin does not match the configured repository, and a SHA different from the fake canonical `main` head all fail before the fake deploy action marker is written.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL because `ops/lightworld-vps/...` does not exist.

- [ ] **Step 3: Implement minimal shared validation and canonical-main verification**

`common.sh` validates app/environment with `^[A-Za-z0-9][A-Za-z0-9._-]*$`, deploy SHA with `^[0-9a-fA-F]{40}$`, loads exactly `/etc/lightworld-deploy/apps.d/<app>.<environment>.conf` in production, and refuses configs that are not root-owned or are group/other writable. A test-only root override is permitted only when `LIGHTWORLD_TEST_MODE=1` and EUID is non-zero.

`assert_workspace_identity(workspace, expected_repo, expected_sha)` requires a real Git worktree, exact `HEAD == expected_sha`, and normalized origin matching configured `owner/repo`.

`verify_canonical_main_sha` supports `MAIN_VERIFY_MODE=public-ls-remote` for public repos and `MAIN_VERIFY_MODE=deploy-key` for later private-repo onboarding. For the TradeOS pilot it must compare the requested SHA to `git ls-remote <canonical-url> refs/heads/main`. Test mode may substitute a local bare remote only while non-root.

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
- Modify: `ops/lightworld-vps/libexec/lightworld-status`
- Modify: `ops/lightworld-vps/libexec/lightworld-deploy`
- Modify: `ops/lightworld-vps/libexec/lightworld-rollback`
- Modify: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- Registry requires: `GITHUB_REPO`, `CANONICAL_MAIN_URL`, `MAIN_VERIFY_MODE`, `APP_USER`, `RELEASE_ROOT`, `CURRENT_LINK`, `ENV_FILE`, `PROCESS_MANAGER`, `PROCESS_NAMES`, `LOCAL_HEALTH_URLS`, `PUBLIC_HEALTH_URLS`, `RUNTIME_FAMILY`, `MIGRATION_MODE`.
- Produces rollback metadata at `<RELEASE_ROOT>/.lightworld/last-successful-release` and `<RELEASE_ROOT>/.lightworld/previous-release`.

- [ ] **Step 1: Extend tests for locks, failed activation and fail-closed main verification**

Use temporary fake registry entries. Assert concurrent deploy attempts cannot both acquire the same app lock; a simulated build/health failure never permanently changes the fake `CURRENT_LINK`; and canonical-main lookup failure rejects deployment instead of falling back to workspace refs.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL on missing release/lock/rollback behavior.

- [ ] **Step 3: Implement release lifecycle without running repository code as root**

`lightworld-deploy` must load/validate registry, acquire global heavy-deploy + app locks, validate workspace origin/SHA, independently verify canonical main SHA, create `<RELEASE_ROOT>/<sha>`, copy source without `.git` credentials or secrets, chown to `APP_USER`, link only the configured server env file after verifying it is outside the Git workspace, run dependency/build commands as `APP_USER`, refuse automatic migrations while `MIGRATION_MODE=manual`, activate only after build success, restart only configured processes, verify all local then public health URLs, and update successful/previous release metadata only after health passes.

On activation health failure, reactivate the previous release and return non-zero.

- [ ] **Step 4: Implement read-only status and explicit rollback**

`lightworld-status` prints configured repo, active/previous release SHA, process names and bounded health results without environment contents. `lightworld-rollback` accepts no SHA; it only switches to the recorded previous successful release, restarts configured processes and requires health success.

- [ ] **Step 5: Run tests**

Run: `node --test test/lightworld-vps-platform.test.mjs test/deployment-config.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ops/lightworld-vps test/lightworld-vps-platform.test.mjs
git commit -m "feat(ops): add isolated release and rollback controls"
```

### Task 3: Add OS-level runner isolation, host bootstrap assets and diagnostic workflow

**Files:**
- Create: `ops/lightworld-vps/install/bootstrap-host.sh`
- Create: `ops/lightworld-vps/install/install-platform-files.sh`
- Create: `ops/lightworld-vps/shims/tradeos-staging/lightworld-status-tradeos-staging`
- Create: `ops/lightworld-vps/shims/tradeos-staging/lightworld-deploy-tradeos-staging`
- Create: `ops/lightworld-vps/shims/tradeos-staging/lightworld-rollback-tradeos-staging`
- Create: `ops/lightworld-vps/sudoers/lwrun_tradeos`
- Create: `.github/workflows/vps-runner-diagnostic.yml`
- Modify: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- VPS layout: `/opt/github-runners`, `/etc/lightworld-deploy/apps.d`, `/var/lib/lightworld-deploy`, `/var/lock/lightworld-deploy`.
- TradeOS runner Unix user: `lwrun_tradeos`.
- TradeOS-specific root-owned shims hardcode `tradeos-africa staging` and forward only permitted SHA/workspace arguments to generic internal commands.
- Runner labels: `self-hosted`, `linux`, `x64`, `lightworld-vps`, `staging`, `tradeos-staging`.

- [ ] **Step 1: Add failing OS-isolation and workflow tests**

Assert the TradeOS sudoers template names only `lwrun_tradeos` and permits only the three TradeOS-specific `/usr/local/sbin/*-tradeos-staging` shims. Assert it contains no generic libexec path, `ALL=(ALL) ALL`, shell, package manager, editor, wildcard app name or wildcard executable grant.

Assert each shim hardcodes `tradeos-africa` and `staging` and cannot accept an app/environment argument.

Assert the diagnostic workflow has only `workflow_dispatch`, `permissions: contents: read`, exact runner labels, no `pull_request`, no repository checkout and no secrets dump.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL because bootstrap/shims/sudoers/workflow do not exist.

- [ ] **Step 3: Implement idempotent host bootstrap and root-owned install files**

`bootstrap-host.sh` creates platform directories but no shared runner account. It creates `lwrun_tradeos` only when explicitly invoked for the TradeOS pilot and gives that account ownership only of `/opt/github-runners/christianagbotah/tradeos-africa/staging` plus its runner work directory.

`install-platform-files.sh` installs generic commands under `/usr/local/libexec/lightworld-deploy/`, TradeOS shims under `/usr/local/sbin/`, validates `bash -n` + `visudo -cf`, and ensures libexec/registry/shims/sudoers remain root-owned and non-writable by `lwrun_tradeos`.

- [ ] **Step 4: Add diagnostic workflow**

The workflow does not checkout repository code. It runs bounded identity/disk/memory checks and `sudo -n /usr/local/sbin/lightworld-status-tradeos-staging` only.

- [ ] **Step 5: Run tests + syntax checks**

Run: `node --test test/lightworld-vps-platform.test.mjs && bash -n ops/lightworld-vps/install/*.sh ops/lightworld-vps/libexec/* ops/lightworld-vps/lib/*.sh ops/lightworld-vps/shims/tradeos-staging/*`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ops/lightworld-vps .github/workflows/vps-runner-diagnostic.yml test/lightworld-vps-platform.test.mjs
git commit -m "feat(ops): add repo-isolated VPS runner bootstrap"
```

### Task 4: Add TradeOS staging registry template and deployment workflow

**Files:**
- Create: `ops/lightworld-vps/apps/tradeos-africa.staging.conf.example`
- Create: `.github/workflows/deploy-staging.yml`
- Modify: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- Canonical repo: `christianagbotah/tradeos-africa`.
- PM2 processes: `tradeos-staging-api`, `tradeos-staging-web`.
- Application user: `lightworld`.
- Local ports: API `4036`, Web `3036`.
- Workflow calls `sudo -n /usr/local/sbin/lightworld-deploy-tradeos-staging "$GITHUB_SHA" "$GITHUB_WORKSPACE"`.

- [ ] **Step 1: Add failing profile/workflow tests**

Assert profile has canonical repo/process names/app user/runtime family, `MAIN_VERIFY_MODE=public-ls-remote`, canonical public repo URL, and `MIGRATION_MODE=manual`; no secrets.

Assert workflow has only `workflow_dispatch`, job-level `if: github.ref == 'refs/heads/main'`, `concurrency: tradeos-staging`, exact labels, `permissions: contents: read`, checkout with `persist-credentials: false`, and the single TradeOS-specific sudo deploy shim.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test test/lightworld-vps-platform.test.mjs`

Expected: FAIL on missing profile/workflow.

- [ ] **Step 3: Implement profile template + workflow**

Template pins `APP_USER=lightworld`, known process names, `RUNTIME_FAMILY=pnpm-node`, release root `/home/lightworld/releases/tradeos-staging`, canonical public GitHub URL, and local health `http://127.0.0.1:4036/health` plus `http://127.0.0.1:3036/`.

Do not guess live public API route or env-file location in Git. Those are required install-time registry values obtained from the current VPS configuration.

- [ ] **Step 4: Run repository verification**

Run: `pnpm test && pnpm typecheck && pnpm build && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ops/lightworld-vps/apps .github/workflows/deploy-staging.yml test/lightworld-vps-platform.test.mjs
git commit -m "feat(ops): add TradeOS staging runner workflow"
```

### Task 5: Bootstrap VPS and register the TradeOS repo-scoped runner

**Files on VPS:**
- Create: `/opt/github-runners/christianagbotah/tradeos-africa/staging/`
- Create: `/etc/lightworld-deploy/apps.d/tradeos-africa.staging.conf`
- Install generic internals: `/usr/local/libexec/lightworld-deploy/*`
- Install TradeOS shims: `/usr/local/sbin/lightworld-{status,deploy,rollback}-tradeos-staging`
- Install: `/etc/sudoers.d/lwrun_tradeos`

**Interfaces:**
- Consumes exact GitHub runner download URL/hash/token generated by GitHub Settings → Actions → Runners for `christianagbotah/tradeos-africa`.
- Produces an online repo-scoped runner named `lightworld-vps-tradeos-staging`, running as `lwrun_tradeos`.

- [ ] **Step 1: Capture read-only VPS preflight**

Run as root and save only non-secret output: OS/arch, `id lightworld`, PM2 process names/cwd/user fields, staging real path/ownership, Node/pnpm versions, disk/memory, and Webuzo/nginx proxy targets. Do not print env-file contents.

Expected: confirm PM2 names/ports; identify stable env-file path and public health URLs for the root-owned registry.

- [ ] **Step 2: Run host bootstrap only**

Execute `bootstrap-host.sh tradeos`, then verify `id lwrun_tradeos`, account has no interactive sudo, runner directory belongs only to `lwrun_tradeos`, and `/etc/lightworld-deploy` remains root-owned/non-writable.

- [ ] **Step 3: Install internals, TradeOS shims and real registry**

Fill only non-secret metadata learned in Step 1. Run `visudo -cf /etc/sudoers.d/lwrun_tradeos`. Verify `sudo -l -U lwrun_tradeos` lists only the three TradeOS-specific shims and no generic libexec command.

- [ ] **Step 4: Register GitHub runner using GitHub's current generated commands**

Download package and verify SHA-256 exactly as GitHub displays. Run `./config.sh` as `lwrun_tradeos`, never root, with short-lived repo token; labels `lightworld-vps,staging,tradeos-staging`; runner name `lightworld-vps-tradeos-staging`. Install/start runner service under `lwrun_tradeos`.

- [ ] **Step 5: Verify diagnostic workflow before deployment**

Dispatch `VPS Runner Diagnostic` from `main` and require green identity/resource/status output. No app restart, migration or build may occur.

### Task 6: Execute TradeOS staging pilot and prove rollback

**Files:**
- Create: `docs/ops/lightworld-vps-repository-inventory.md`
- Create: `docs/ops/lightworld-vps-onboarding-template.md`

**Interfaces:**
- Consumes online runner + deploy workflow.
- Produces a proven deployment contract for repository-specific onboarding plans.

- [ ] **Step 1: Record pre-deployment state**

Capture public root, local API `/health`, local Web root, PM2 status, deployed Git SHA and migration inventory. Back up current operational config without committing secrets.

- [ ] **Step 2: Keep migrations fail-closed for first pilot**

TradeOS currently stores ordered SQL migrations without a production migration ledger, so leave `MIGRATION_MODE=manual`. If selected `main` contains unapplied migrations relative to staging, stop and create a separate migration-baseline task. Never replay all SQL files against an existing DB automatically.

- [ ] **Step 3: Dispatch staging deployment from `main`**

Require hosted CI green for exact SHA, manually dispatch `Deploy Staging`, and verify root-owned canonical-main verification independently confirms that SHA. Verify isolated release/build as `lightworld`, activation only after build success, restart only two TradeOS PM2 processes, and local/public health success.

- [ ] **Step 4: Prove rollback without deliberately breaking staging**

Use explicit rollback shim to move to recorded previous successful release, verify health, then deploy approved `main` SHA again.

- [ ] **Step 5: Build portfolio inventory + onboarding template**

List every discovered repo from both GitHub identities and classify as deployed, development-only, archived/reference, duplicate/mirror or excluded. Compare duplicate `irexpro` and `iassetspro` repos across accounts and record exactly one canonical deployment source per app.

Template fields: canonical repo, Unix runner user, private/public main verification mode, optional root-owned read-only deploy-key path for private repos, runtime family, VPS path, app user, process manager/names, env path, local/public health, build command, migration policy, release/rollback model, runner label, resource class and verification commands.

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
sudo -u lwrun_tradeos -H id
sudo -l -U lwrun_tradeos
systemctl --no-pager --full status 'actions.runner.*tradeos*'
sudo -n -u root /usr/local/sbin/lightworld-status-tradeos-staging
pm2 ls
curl -fsS http://127.0.0.1:4036/health
curl -fsS http://127.0.0.1:3036/ >/dev/null
```

Expected: repo green; runner online/non-root; sudo limited to TradeOS shims; TradeOS healthy; deployed SHA reported.

- [ ] **Step 7: Commit operational docs**

```bash
git add docs/ops
git commit -m "docs: record Lightworld runner pilot and onboarding contract"
```

## Follow-up execution sequence after this plan

After the TradeOS pilot is proven, create small repository-specific onboarding plans from the template instead of one giant cross-project implementation. Priority order: `irexpro`, `iassetspro`, `schoolmanager`, `ipresenterplux`, `ifleet-system`, `ibetpro`, `lightworldtech-website`, then other deployed apps found during inventory. `Chrix4u/irexpro` and `Chrix4u/iassetspro` receive runners only if inventory determines they are canonical deployment repositories. Every onboarded repo gets its own Unix runner user and app-specific sudo shims; private repos use root-owned read-only main-verification credentials rather than trusting the runner workspace alone.
