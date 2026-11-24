# TradeOS runtime artifact: source-change trigger coverage

## Fixed gap

Previously, the runtime-artifact-pilot GitHub workflow built signed,
source-light candidates only when release tooling or Next config changed.
Regular apps/api, apps/web, apps/system-admin and packages changes could
merge to main without initiating a new signed runtime artifact. Quick Serve
and internal outbox code could exist in main with only an older SHA artifact.

Both pull_request and push to main now filter the same runtime inputs:
API, web, system-admin, workspace packages, root package/lockfile/workspace
descriptors, shared root tsconfigs and existing release scripts/tests.
This generates an exact source SHA candidate for each runtime-affecting main
push without compiling on the shared Lightworld VPS.

The signed pilot's identity is still strictly main + push + exact GitHub
commit, not a manual dispatch, PR or untrusted worktree/run.
All generated archives remain deployable:false. No automatic deploy occurs.

## Acceptance

- Node source-only contract tests verify the trigger paths in both sections.
- Build, checksum, safe extraction, API/web/admin boot smoke and provenance
  signing run on hosted ubuntu-22.04 GitHub runners, NOT the shared VPS.
- Staging stays on its immutable served release. No installs, SQL migrations,
  event backlog processing, symlink change, PM2 restart or rollout.
- Pilot artifacts expire after 3 days. They are not offsite backups.
- Promotion is separately blocked by a reviewed deployable artifact contract,
  trusted-root preflight, unresolved financial event review, independently
  verified offsite restoration, atomic switch and rollback.
- Legacy deploy-staging workflow is separate: do not invoke it until the
  signed-artifact cutover replaces its VPS compilation and verifies safeguards.
