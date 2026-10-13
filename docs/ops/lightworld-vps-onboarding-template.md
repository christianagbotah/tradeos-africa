# Lightworld VPS Repository Onboarding Template

Use this template for one repository/application/environment at a time. Do not create a shared deployment-capable Unix runner identity across repositories.

## 1. Repository authority

- Canonical repository: `<owner/repo>`
- Duplicate/mirror repositories checked: `<list or none>`
- Canonical deployment source evidence: `<existing checkout/release/workflow/operator decision>`
- Visibility: `<public|private>`
- Default branch: `main`
- Main verification mode: `<public-ls-remote|deploy-key>`
- Private-repo verifier key path, if required: `<root-owned read-only path; never runner-readable>`

Fail closed if the repository is not proven canonical for the target. A mirror must not receive competing deployment authority.

## 2. VPS identity and isolation

- Runner Unix user: `lwrun_<app>`
- Runner shell: `/usr/sbin/nologin`
- Runner name: `lightworld-vps-<app>-<environment>`
- Unique runner labels: `self-hosted, linux, x64, lightworld-vps, <environment>, <app>-<environment>`
- Runner install directory: `/opt/github-runners/<owner>/<repo>/<environment>`
- Runner work directory: `/var/lib/lightworld-deploy/runners/<runner-user>/_work`
- Application user: `<existing non-root app user>`
- Root-owned registry: `/etc/lightworld-deploy/apps.d/<app>.<environment>.conf`
- Root-owned app-specific shims: `/usr/local/sbin/lightworld-{status,deploy,rollback}-<app>-<environment>`
- Sudo policy: exactly those shims; no generic libexec, shell, editor, package-manager or wildcard grants

Verify that the runner cannot read application env files, write the registry/shims, or invoke another application's deployment shim.

## 3. Application/runtime contract

- Existing live path: `<path>`
- Release root: `/home/<app-user>/releases/<app>-<environment>` or approved equivalent
- Stable current symlink: `<path>`
- Runtime family: `<pnpm-node|other reviewed adapter>`
- Build command(s): `<exact commands>`
- Process manager: `<pm2|systemd|other>`
- Process names: `<exact allowlisted names>`
- Local health URLs: `<space-separated URLs>`
- Public health URLs: `<space-separated URLs>`
- Environment file: `<stable path outside Git workspaces>`
- Resource class: `<light|standard|heavy>`
- Heavy deployment serialization required: `<yes|no>`

Builds must execute as the application user. Root performs only validated filesystem activation/process-control operations.

## 4. Source-integrity contract

The deployment layer must independently enforce all of the following even if the GitHub workflow is modified:

1. app/environment identifiers are fixed by an app-specific shim;
2. requested SHA is a 40-hex commit SHA;
3. workspace owner is the configured non-root runner user;
4. workspace origin equals the canonical repository;
5. workspace `HEAD` equals the requested SHA;
6. requested SHA independently equals canonical remote `refs/heads/main`;
7. release source is generated from the verified commit object (`git archive <sha>` or an equivalent immutable artifact), not mutable worktree files;
8. Git credentials, `.git`, `.env*`, runner credentials and untracked workspace files are not copied into releases.

For private repositories, canonical-main verification credentials must be root-owned and unreadable by the runner.

## 5. Database/migration policy

- Database engine: `<PostgreSQL/MySQL/etc>`
- Migration inventory mechanism: `<ledger/table/tool>`
- Migration mode: `<manual|reviewed automatic>`
- Backup command/path: `<non-secret operational reference>`
- Rollback compatibility reviewed: `<yes/no>`

Default to `MIGRATION_MODE=manual`. Automatic migrations require a trustworthy applied-migration ledger, idempotent forward behavior, a backup/restore procedure, and explicit compatibility with application rollback. Never replay every SQL file against an existing database merely because it exists in source control.

## 6. Release/rollback model

- Build in `<release-root>/<verified-sha>` while current release continues serving.
- Activate with an atomic symlink replacement only after build success.
- Restart only the configured allowlisted process names.
- Health verification must allow a **bounded readiness window** for expected startup connection refusal while remaining fail-closed on persistent failure.
- Verify local health first, then public health.
- Record `last-successful-release` and `previous-release` only after health succeeds.
- On activation-health failure, switch back to the prior target, restart allowlisted processes, and return non-zero.
- Explicit rollback accepts no arbitrary SHA; it may only target the recorded previous successful release.

### Legacy first-cutover rule

If the existing live path is a real directory, do not let the deployer overwrite it. Rename it intact into the release root on the same filesystem, create the stable live symlink back to that preserved legacy directory, verify health without restarting, then run the first managed deployment. Keep the legacy directory until managed rollback has been proven and retention is explicitly approved.

## 7. Service-specific dependencies

Record any stateful service whose permissions or lifecycle can be affected by deployment preparation:

- service/unit: `<name>`
- data/socket path: `<path>`
- owning Unix identity: `<user:group>`
- parent-directory traversal requirements: `<ACL/mode>`
- readiness command: `<e.g. pg_isready ...>`

Do not use `install -d -o ... -g ... -m ...` on an existing shared parent directory unless changing that directory's ownership/mode is explicitly intended. Prefer creating a dedicated child directory/file or adding the minimal ACL required by the dependent service.

## 8. GitHub workflow controls

Deployment workflow requirements:

- trigger: `workflow_dispatch` only for initial onboarding;
- job guard: `github.ref == 'refs/heads/main'`;
- permissions: `contents: read` only unless a documented need adds more;
- checkout credentials: `persist-credentials: false`;
- exact unique self-hosted labels;
- repository-specific concurrency group;
- no secrets dump or broad environment logging;
- exactly one privileged operation: the app-specific deployment shim.

No `pull_request` workflow may select a deployment-capable self-hosted runner.

## 9. Preflight checklist

Before installing anything, capture non-secret evidence:

- OS/architecture and disk/memory;
- existing app user and service users;
- live path type (directory vs symlink), owner/mode and resolved target;
- current deployed Git origin/SHA where applicable;
- PM2/systemd process names, cwd and executable;
- Node/package-manager/runtime versions;
- stable env-file path (path and permissions only, never contents);
- local/public health endpoints;
- database/service readiness;
- duplicate repository sources and canonical-source decision.

Do not alter nginx/Webuzo/database/process configuration merely to fit the platform. The runner platform must integrate with the proven live topology.

## 10. Verification commands

Repository verification, adapted to the project:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

VPS verification:

```bash
id <runner-user>
sudo -l -U <runner-user>
systemctl --no-pager --full status 'actions.runner.*<app>*'
sudo -n -u root /usr/local/sbin/lightworld-status-<app>-<environment>
<database-readiness-command>
curl -fsS <local-api-health>
curl -fsS <local-web-health> >/dev/null
curl -fsS <public-health>
```

Also prove:

- runner is online and non-root;
- runner cannot read the application env file;
- generic deployment internals are not directly sudoable;
- root-owned registry/shims are not runner-writable;
- exact approved main SHA is deployed;
- process OS users/cwds resolve to the managed release;
- failed activation restores the prior target;
- once two successful managed releases exist, explicit rollback moves to recorded previous release, remains healthy, and approved main can be redeployed.

## 11. Onboarding completion record

Record:

- approved PR/SHA containing repository-side platform assets;
- runner registration date/name/version and verified download digest;
- first successful managed release SHA;
- diagnostic workflow run ID;
- deployment workflow run ID;
- rollback proof run/time;
- retained legacy/previous release path;
- any incident discovered during onboarding and its permanent regression test.

Do not mark onboarding complete until hosted CI, diagnostic runner execution, managed deployment, health verification and rollback proof have all succeeded.
